/**
 * Elastic Serverless client: REST API queries and index discovery.
 * Supports both OTLP TSDS schema (metrics.*, attributes.*) and legacy (metric.name, metric.value, labels.*).
 */

import type { TimeSeriesBucket, MetricsSummary, AnomalyRecord } from "./types";

const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT ?? "";
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY ?? "";

function getHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${ELASTIC_API_KEY}`,
  };
}

function getBaseUrl(): string {
  const base = ELASTIC_ENDPOINT.replace(/\/+$/, "");
  return base;
}

/** OTLP TSDS: metric name → Elastic field (e.g. chemical.dosing_rate_lpm → metrics.chemical.dosing_rate_lpm). */
function metricToField(metricName: string): string {
  return `metrics.${metricName}`;
}

/** Dimension field for site/device (OTLP uses attributes.* or resource.attributes.*). */
const SITE_FIELD = "attributes.site.name";
const SITE_FIELD_LEGACY = "labels.site.name";
const DEVICE_FIELD = "attributes.device.id";
const DEVICE_FIELD_LEGACY = "labels.device.id";

/** Discover metrics data stream pattern (e.g. metrics-*). */
export async function discoverMetricsIndices(): Promise<string> {
  if (!ELASTIC_ENDPOINT || !ELASTIC_API_KEY) {
    return "metrics-*";
  }
  try {
    const res = await fetch(`${getBaseUrl()}/_data_stream`, {
      headers: getHeaders(),
    });
    if (!res.ok) return "metrics-*";
    const data = (await res.json()) as { data_streams?: { name: string }[] };
    const streams = data.data_streams ?? [];
    const metricsStreams = streams
      .filter((s) => s.name.startsWith("metrics-"))
      .map((s) => s.name);
    if (metricsStreams.length > 0) {
      return metricsStreams.length === 1 ? metricsStreams[0]! : "metrics-*";
    }
  } catch {
    // ignore
  }
  return "metrics-*";
}

/** Run search and return parsed JSON; on 400/404 return null so callers can return empty data. */
async function search(
  index: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, body: text };
  }
}

/** GET /api/metrics/summary - high-level summary. */
export async function getMetricsSummary(
  from: string,
  to: string
): Promise<MetricsSummary> {
  const index = await discoverMetricsIndices();
  const empty: MetricsSummary = { from, to, sites: {}, totalMetrics: 0 };

  // Try OTLP TSDS dimension first (attributes.site.name), then legacy (labels.site.name)
  for (const siteField of [SITE_FIELD, SITE_FIELD_LEGACY]) {
    const query = {
      size: 0,
      query: { range: { "@timestamp": { gte: from, lte: to } } },
      aggs: {
        by_site: {
          terms: { field: siteField, size: 20 },
          aggs: { doc_count: { value_count: { field: "@timestamp" } } },
        },
      },
    };
    const result = await search(index, query);
    if (!result.ok) {
      if (result.status === 400 || result.status === 404) continue;
      throw new Error(`Elasticsearch error: ${result.status} ${result.body}`);
    }
    const data = result.data as {
      aggregations?: { by_site?: { buckets?: { key: string; doc_count: number }[] } };
    };
    const buckets = data.aggregations?.by_site?.buckets ?? [];
    if (buckets.length > 0) {
      const sites: Record<string, { deviceCount: number; metricCount: number }> = {};
      let totalMetrics = 0;
      for (const b of buckets) {
        const key = String(b.key);
        sites[key] = { deviceCount: 1, metricCount: b.doc_count };
        totalMetrics += b.doc_count;
      }
      return { from, to, sites, totalMetrics };
    }
  }
  return empty;
}

/** GET /api/metrics/timeseries - chart data. Tries OTLP TSDS (metrics.*) then legacy (metric.name/value). */
export async function getTimeseries(
  metric: string,
  site: string | null,
  from: string,
  to: string,
  interval: string = "1m"
): Promise<TimeSeriesBucket[]> {
  const index = await discoverMetricsIndices();
  const valueFieldTsds = metricToField(metric);

  // Try OTLP TSDS: aggregate the metric field directly (e.g. metrics.chemical.dosing_rate_lpm)
  const mustTsds: Record<string, unknown>[] = [
    { range: { "@timestamp": { gte: from, lte: to } } },
    { exists: { field: valueFieldTsds } },
  ];
  if (site) {
    // OTLP may store dimensions in attributes.* or resource.attributes.*
    mustTsds.push({
      bool: {
        should: [
          { term: { [SITE_FIELD]: site } },
          { term: { "resource.attributes.site.name": site } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  const queryTsds = {
    size: 0,
    query: { bool: { must: mustTsds } },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          min_doc_count: 1,
        },
        aggs: {
          value: { avg: { field: valueFieldTsds } },
        },
      },
    },
  };

  const resultTsds = await search(index, queryTsds);
  if (resultTsds.ok) {
    const data = resultTsds.data as {
      aggregations?: {
        over_time?: { buckets?: { key_as_string: string; value: { value: number } }[] };
      };
    };
    const buckets = data.aggregations?.over_time?.buckets ?? [];
    if (buckets.length > 0) {
      return buckets.map((b) => ({
        time: b.key_as_string,
        value: b.value?.value ?? 0,
      }));
    }
  }

  // Fallback: legacy schema (metric.name + metric.value)
  const mustLegacy: Record<string, unknown>[] = [
    { range: { "@timestamp": { gte: from, lte: to } } },
    { term: { "metric.name": metric } },
  ];
  if (site) mustLegacy.push({ term: { [SITE_FIELD_LEGACY]: site } });
  const queryLegacy = {
    size: 0,
    query: { bool: { must: mustLegacy } },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          min_doc_count: 1,
        },
        aggs: { value: { avg: { field: "metric.value" } } },
      },
    },
  };
  const resultLegacy = await search(index, queryLegacy);
  if (!resultLegacy.ok) {
    if (resultLegacy.status === 400 || resultLegacy.status === 404) return [];
    throw new Error(`Elasticsearch error: ${resultLegacy.status} ${resultLegacy.body}`);
  }
  const dataLegacy = resultLegacy.data as {
    aggregations?: {
      over_time?: { buckets?: { key_as_string: string; value: { value: number } }[] };
    };
  };
  const bucketsLegacy = dataLegacy.aggregations?.over_time?.buckets ?? [];
  return bucketsLegacy.map((b) => ({
    time: b.key_as_string,
    value: b.value?.value ?? 0,
  }));
}

/** GET /api/anomalies - simple rule-based anomalies from metrics. */
export async function getAnomalies(
  from: string,
  to: string
): Promise<AnomalyRecord[]> {
  const index = await discoverMetricsIndices();
  const anomalies: AnomalyRecord[] = [];

  // Low sanitizer (underdosing)
  const lowSanitizer = {
    size: 10,
    query: {
      bool: {
        must: [
          { range: { "@timestamp": { gte: from, lte: to } } },
          { term: { "metric.name": "sanitation.sanitizer_ppm" } },
          { range: { "metric.value": { lt: 25 } } },
        ],
      },
    },
    sort: [{ "@timestamp": "desc" }],
    _source: ["@timestamp", "labels.site.name", "labels.device.id", "metric.value"],
  };
  const resSan = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(lowSanitizer),
  });
  if (resSan.ok) {
    const d = (await resSan.json()) as { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
    for (const h of d.hits?.hits ?? []) {
      const src = h._source as { "@timestamp"?: string; labels?: Record<string, string>; "metric.value"?: number } | undefined;
      if (src) {
        anomalies.push({
          time: String(src["@timestamp"] ?? ""),
          site: src.labels?.["site.name"] ?? "unknown",
          device: src.labels?.["device.id"] ?? "unknown",
          type: "underdosing",
          description: `Low sanitizer ppm: ${src["metric.value"] ?? 0}`,
          severity: "medium",
        });
      }
    }
  }

  // Pump failure (device.status = 0)
  const pumpFailure = {
    size: 20,
    query: {
      bool: {
        must: [
          { range: { "@timestamp": { gte: from, lte: to } } },
          { term: { "metric.name": "device.status" } },
          { term: { "metric.value": 0 } },
        ],
      },
    },
    sort: [{ "@timestamp": "desc" }],
    _source: ["@timestamp", "labels.site.name", "labels.device.id"],
  };
  const resStatus = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(pumpFailure),
  });
  if (resStatus.ok) {
    const d = (await resStatus.json()) as { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
    for (const h of d.hits?.hits ?? []) {
      const src = h._source as { "@timestamp"?: string; labels?: Record<string, string> } | undefined;
      if (src) {
        anomalies.push({
          time: String(src["@timestamp"] ?? ""),
          site: src.labels?.["site.name"] ?? "unknown",
          device: src.labels?.["device.id"] ?? "unknown",
          type: "pump_failure",
          description: "Device status offline",
          severity: "high",
        });
      }
    }
  }

  // Thermal: water temp out of range
  const thermalHigh = {
    size: 10,
    query: {
      bool: {
        must: [
          { range: { "@timestamp": { gte: from, lte: to } } },
          { term: { "metric.name": "sanitation.water_temp_c" } },
          { range: { "metric.value": { gte: 80 } } },
        ],
      },
    },
    sort: [{ "@timestamp": "desc" }],
    _source: ["@timestamp", "labels.site.name", "labels.device.id", "metric.value"],
  };
  const resThermal = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(thermalHigh),
  });
  if (resThermal.ok) {
    const d = (await resThermal.json()) as { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
    for (const h of d.hits?.hits ?? []) {
      const src = h._source as { "@timestamp"?: string; labels?: Record<string, string>; "metric.value"?: number } | undefined;
      if (src) {
        anomalies.push({
          time: String(src["@timestamp"] ?? ""),
          site: src.labels?.["site.name"] ?? "unknown",
          device: src.labels?.["device.id"] ?? "unknown",
          type: "thermal_high",
          description: `High water temp: ${src["metric.value"] ?? 0}°C`,
          severity: "high",
        });
      }
    }
  }

  return anomalies;
}

/** Count raw documents in metrics-* in time range (no dimension filter). Use to confirm data landed. */
export async function getMetricsDocCount(
  from: string = "now-1h",
  to: string = "now"
): Promise<{ count: number; index: string; from: string; to: string }> {
  const index = await discoverMetricsIndices();
  const result = await search(index, {
    size: 0,
    query: { range: { "@timestamp": { gte: from, lte: to } } },
    track_total_hits: true,
  });
  if (!result.ok) {
    return { count: 0, index, from, to };
  }
  const data = result.data as { hits?: { total?: { value?: number }; total?: number } };
  const total = data.hits?.total;
  const count =
    typeof total === "number" ? total : (total as { value?: number })?.value ?? 0;
  return { count, index, from, to };
}

/** Check Elastic connectivity. Uses a minimal search (/_cluster/health is not available in Serverless). */
export async function checkElasticConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!ELASTIC_ENDPOINT || !ELASTIC_API_KEY) {
    return { ok: false, error: "Missing ELASTIC_ENDPOINT or ELASTIC_API_KEY" };
  }
  try {
    const res = await fetch(`${getBaseUrl()}/metrics-*/_search`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ size: 0 }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
