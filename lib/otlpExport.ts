/**
 * Export simulated metrics to Elastic via OTLP HTTP.
 * Uses OpenTelemetry SDK in a serverless-friendly way: create meter provider + export one batch per invocation.
 */

import { Resource } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type { MetricBatch } from "./types";

const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT ?? process.env.ELASTIC_ENDPOINT ?? "";
const OTLP_HEADERS = process.env.OTLP_HEADERS ?? "";

/** Build the OTLP metrics export URL (for ingest). Ingest host → /v1/metrics; .es. host → /_otlp/v1/metrics. */
export function getOTLPMetricsExportUrl(): string {
  const url = OTLP_ENDPOINT.replace(/\/+$/, "");
  const endpoint = url.startsWith("http") ? url : `https://${url}`;
  const hasPath = endpoint.includes("/_otlp") || endpoint.includes("/v1/metrics") || endpoint.split("/").length > 3;
  if (hasPath) return endpoint;
  return endpoint.includes(".ingest.")
    ? `${endpoint}/v1/metrics`
    : `${endpoint}/_otlp/v1/metrics`;
}

function parseHeaders(headerStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  headerStr.split(",").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      out[k] = v;
    }
  });
  return out;
}

/**
 * Export one MetricBatch to Elastic OTLP endpoint.
 * Maps our MetricPoint[] into OTel gauges/counters and flushes.
 */
export async function exportBatchToOTLP(batch: MetricBatch): Promise<{ ok: boolean; error?: string }> {
  if (!OTLP_ENDPOINT) {
    return { ok: false, error: "OTLP_ENDPOINT not set" };
  }

  const exportUrl = getOTLPMetricsExportUrl();
  const headers = parseHeaders(OTLP_HEADERS);

  const exporter = new OTLPMetricExporter({
    url: exportUrl,
    headers: Object.keys(headers).length ? headers : undefined,
  });

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 999999,
    exportTimeoutMillis: 5000,
  });
  const resource = new Resource({ "service.name": "ecolab-iot-demo" });
  const meterProvider = new MeterProvider({ resource, readers: [reader] });
  const meter = meterProvider.getMeter("ecolab-iot-demo", "1.0.0");

  try {
    const gaugeCache = new Map<string, ReturnType<typeof meter.createObservableGauge>>();
    const counterCache = new Map<string, ReturnType<typeof meter.createCounter>>();

    for (const m of batch.metrics) {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.attributes)) {
        if (typeof v === "string") attrs[k] = v;
        else attrs[k] = String(v);
      }
      const key = `${m.name}-${JSON.stringify(attrs)}`;

      if (m.name === "sanitation.cycle_count") {
        let counter = counterCache.get(key);
        if (!counter) {
          counter = meter.createCounter(m.name, { description: "Cycle count" });
          counterCache.set(key, counter);
        }
        counter.add(m.value, attrs);
      } else {
        let gauge = gaugeCache.get(key);
        if (!gauge) {
          gauge = meter.createObservableGauge(m.name, { description: m.name });
          gaugeCache.set(key, gauge);
        }
        gauge.addCallback((result) => {
          result.observe(m.value, attrs);
        });
      }
    }

    await meterProvider.forceFlush();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Check OTLP connectivity (minimal probe). */
export function checkOTLPConfig(): { ok: boolean; error?: string } {
  if (!OTLP_ENDPOINT) return { ok: false, error: "OTLP_ENDPOINT not set" };
  return { ok: true };
}
