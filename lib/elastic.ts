/**
 * Elastic Serverless client: REST API queries and index discovery.
 * Uses ES|QL where feasible; falls back to _search aggregations.
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

/** GET /api/metrics/summary - high-level summary. */
export async function getMetricsSummary(
  from: string,
  to: string
): Promise<MetricsSummary> {
  const index = await discoverMetricsIndices();
  const query = {
    size: 0,
    query: {
      range: {
        "@timestamp": { gte: from, lte: to },
      },
    },
    aggs: {
      by_site: {
        terms: { field: "labels.site.name", size: 20 },
        aggs: {
          doc_count: { value_count: { field: "@timestamp" } },
        },
      },
    },
  };

  const res = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(query),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Elasticsearch error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    aggregations?: {
      by_site?: { buckets?: { key: string; doc_count: number }[] };
    };
  };
  const buckets = data.aggregations?.by_site?.buckets ?? [];
  const sites: Record<string, { deviceCount: number; metricCount: number }> = {};
  let totalMetrics = 0;
  for (const b of buckets) {
    const key = String(b.key);
    sites[key] = { deviceCount: 1, metricCount: b.doc_count };
    totalMetrics += b.doc_count;
  }

  return { from, to, sites, totalMetrics };
}

/** GET /api/metrics/timeseries - chart data. */
export async function getTimeseries(
  metric: string,
  site: string | null,
  from: string,
  to: string,
  interval: string = "1m"
): Promise<TimeSeriesBucket[]> {
  const index = await discoverMetricsIndices();
  const must: Record<string, unknown>[] = [
    { range: { "@timestamp": { gte: from, lte: to } } },
    { term: { "metric.name": metric } },
  ];
  if (site) {
    must.push({ term: { "labels.site.name": site } });
  }

  const query = {
    size: 0,
    query: { bool: { must } },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          min_doc_count: 1,
        },
        aggs: {
          value: { avg: { field: "metric.value" } },
        },
      },
    },
  };

  const res = await fetch(`${getBaseUrl()}/${index}/_search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(query),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Elasticsearch error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    aggregations?: {
      over_time?: {
        buckets?: { key_as_string: string; value: { value: number } }[];
      };
    };
  };
  const buckets = data.aggregations?.over_time?.buckets ?? [];
  return buckets.map((b) => ({
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

/** Check Elastic connectivity. */
export async function checkElasticConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!ELASTIC_ENDPOINT || !ELASTIC_API_KEY) {
    return { ok: false, error: "Missing ELASTIC_ENDPOINT or ELASTIC_API_KEY" };
  }
  try {
    const res = await fetch(`${getBaseUrl()}/_cluster/health`, {
      headers: getHeaders(),
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
