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

/** Alternative: dots → underscores (some OTLP mappings do this). */
function metricToFieldUnderscore(metricName: string): string {
  return `metrics.${metricName.replace(/\./g, "_")}`;
}

/** Dimension field for site/device (OTLP uses attributes.* or resource.attributes.*). */
const SITE_FIELD = "attributes.site.name";
const SITE_FIELD_LEGACY = "labels.site.name";
const DEVICE_FIELD = "attributes.device.id";
const DEVICE_FIELD_LEGACY = "labels.device.id";

/** Discover metrics data stream pattern. Prefer metrics-generic.otel-default (Managed OTLP default). */
export async function discoverMetricsIndices(): Promise<string> {
  if (!ELASTIC_ENDPOINT || !ELASTIC_API_KEY) {
    return "metrics-*";
  }
  try {
    const res = await fetch(`${getBaseUrl()}/_data_stream`, {
      headers: getHeaders(),
    });
    if (!res.ok) return "metrics-generic.otel-default";
    const data = (await res.json()) as { data_streams?: { name: string }[] };
    const streams = data.data_streams ?? [];
    const metricsStreams = streams
      .filter((s) => s.name.startsWith("metrics-"))
      .map((s) => s.name);
    if (metricsStreams.length > 0) {
      const preferred = metricsStreams.find((s) => s === "metrics-generic.otel-default");
      return preferred ?? (metricsStreams.length === 1 ? metricsStreams[0]! : "metrics-*");
    }
  } catch {
    // ignore
  }
  return "metrics-generic.otel-default";
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

/** Run timeseries agg for a given value field; returns buckets or empty. */
function parseTimeseriesBuckets(result: { ok: true; data: unknown } | { ok: false }): TimeSeriesBucket[] {
  if (!result.ok) return [];
  const data = result.data as {
    aggregations?: {
      over_time?: { buckets?: { key_as_string: string; value: { value: number } }[] };
    };
  };
  const buckets = data.aggregations?.over_time?.buckets ?? [];
  return buckets.map((b) => ({
    time: b.key_as_string,
    value: b.value?.value ?? 0,
  }));
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
  const buildMust = (valueField: string): Record<string, unknown>[] => {
    const must: Record<string, unknown>[] = [
      { range: { "@timestamp": { gte: from, lte: to } } },
      { exists: { field: valueField } },
    ];
    if (site) {
      must.push({
        bool: {
          should: [
            { term: { [SITE_FIELD]: site } },
            { term: { "resource.attributes.site.name": site } },
          ],
          minimum_should_match: 1,
        },
      });
    }
    return must;
  };
  const buildQuery = (valueField: string) => ({
    size: 0,
    query: { bool: { must: buildMust(valueField) } },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          min_doc_count: 1,
        },
        aggs: { value: { avg: { field: valueField } } },
      },
    },
  });

  // 1) OTLP TSDS with dots: metrics.chemical.dosing_rate_lpm
  const fieldDots = metricToField(metric);
  let result = await search(index, buildQuery(fieldDots));
  let buckets = parseTimeseriesBuckets(result);
  if (buckets.length > 0) return buckets;

  // 2) OTLP TSDS with underscores: metrics.chemical_dosing_rate_lpm
  const fieldUnderscore = metricToFieldUnderscore(metric);
  result = await search(index, buildQuery(fieldUnderscore));
  buckets = parseTimeseriesBuckets(result);
  if (buckets.length > 0) return buckets;

  // 3) No site filter (in case dimension field names differ)
  const queryNoSite = {
    size: 0,
    query: {
      bool: {
        must: [
          { range: { "@timestamp": { gte: from, lte: to } } },
          { exists: { field: fieldDots } },
        ],
      },
    },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          min_doc_count: 1,
        },
        aggs: { value: { avg: { field: fieldDots } } },
      },
    },
  };
  result = await search(index, queryNoSite);
  buckets = parseTimeseriesBuckets(result);
  if (buckets.length > 0) return buckets;

  // 4) Legacy schema (metric.name + metric.value)
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
  const legacyBuckets = parseTimeseriesBuckets(resultLegacy);
  if (legacyBuckets.length > 0) return legacyBuckets;

  // 5) Discover from sample: find a numeric field whose name matches the metric
  const { sample } = await getMetricsSample(from, to);
  if (sample && typeof sample === "object") {
    const flatKeys = new Set<string>();
    const collectKeys = (obj: unknown, prefix: string): void => {
      if (obj == null) return;
      if (typeof obj === "number" || typeof obj === "boolean") {
        if (prefix) flatKeys.add(prefix);
        return;
      }
      if (typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          const next = prefix ? `${prefix}.${k}` : k;
          if (typeof v === "number") flatKeys.add(next);
          else collectKeys(v, next);
        }
      }
    };
    collectKeys(sample, "");
    const metricSlug = metric.replace(/\./g, "_");
    const candidate = Array.from(flatKeys).find(
      (key) =>
        key === metric ||
        key === fieldDots ||
        key === fieldUnderscore ||
        key.endsWith(`.${metric}`) ||
        key.endsWith(`.${metricSlug}`) ||
        key.includes(metric) ||
        key.includes(metricSlug)
    );
    if (candidate) {
      result = await search(index, buildQuery(candidate));
      buckets = parseTimeseriesBuckets(result);
      if (buckets.length > 0) return buckets;
    }
  }

  return [];
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

/** Get one sample document from metrics-* to discover actual field structure. Prefer docs from our app (ecolab-iot-demo). */
export async function getMetricsSample(
  from: string = "now-24h",
  to: string = "now"
): Promise<{ sample: Record<string, unknown> | null; index: string }> {
  const index = await discoverMetricsIndices();
  const baseQuery = { range: { "@timestamp": { gte: from, lte: to } } };
  // Prefer sample from our app (scope/meter name or resource.service.name)
  const ourAppQuery = {
    bool: {
      must: [baseQuery],
      should: [
        { term: { "resource.attributes.service.name": "ecolab-iot-demo" } },
        { term: { "service.name": "ecolab-iot-demo" } },
        { term: { "scope.name": "ecolab-iot-demo" } },
      ],
      minimum_should_match: 0,
    },
  };
  let result = await search(index, {
    size: 1,
    query: ourAppQuery,
    sort: [{ "@timestamp": "desc" }],
    _source: true,
  });
  if (!result.ok) return { sample: null, index };
  let data = result.data as { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
  let hit = data.hits?.hits?.[0];
  if (!hit?._source) {
    result = await search(index, {
      size: 1,
      query: { bool: { must: [baseQuery] } },
      sort: [{ "@timestamp": "desc" }],
      _source: true,
    });
    if (!result.ok) return { sample: null, index };
    data = result.data as { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
    hit = data.hits?.hits?.[0];
  }
  return { sample: hit?._source ?? null, index };
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
  const data = result.data as { hits?: { total?: number | { value?: number } } };
  const total = data.hits?.total;
  const count =
    typeof total === "number" ? total : (total && typeof total === "object" ? total.value : 0) ?? 0;
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
