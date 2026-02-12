import { NextResponse } from "next/server";
import { generateMetricBatch } from "@/lib/simulator";
import { exportBatchToOTLP, getOTLPMetricsExportUrl } from "@/lib/otlpExport";

/**
 * GET /api/debug/otlp-test
 * Sends a small batch of metrics to the configured OTLP endpoint and returns success/failure.
 * Uses OTLP_ENDPOINT and OTLP_HEADERS from env (e.g. .env.local). No secrets in response.
 */
export async function GET() {
  const endpoint = process.env.OTLP_ENDPOINT ?? process.env.ELASTIC_ENDPOINT ?? "";
  const hasHeaders = Boolean(process.env.OTLP_HEADERS?.trim());

  if (!endpoint) {
    return NextResponse.json({
      ok: false,
      error: "OTLP_ENDPOINT is not set",
      endpoint: null,
      message: "Set OTLP_ENDPOINT in .env.local (e.g. https://your-deployment.ingest.region.aws.elastic.cloud)",
    });
  }

  const fullUrl = getOTLPMetricsExportUrl();
  const masked = fullUrl.replace(/^https?:\/\//, "").replace(/([^/]+)(\/.*)?/, (_, host, path) => `${host}${path ?? ""}`);

  if (!hasHeaders) {
    return NextResponse.json({
      ok: false,
      error: "OTLP_HEADERS is not set",
      endpoint: masked,
      message: "Set OTLP_HEADERS in .env.local (e.g. Authorization=ApiKey YOUR_KEY)",
    });
  }

  try {
    const batch = generateMetricBatch({ seed: 12345, stepIndex: 0 });
    const result = await exportBatchToOTLP(batch);

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        endpoint: masked,
        path: fullUrl.includes("/v1/metrics") && !fullUrl.includes("_otlp") ? "/v1/metrics (ingest)" : "/_otlp/v1/metrics",
        message: `Successfully sent ${batch.metrics.length} metrics to OTLP endpoint.`,
        metricCount: batch.metrics.length,
      });
    }

    return NextResponse.json({
      ok: false,
      error: result.error ?? "Export failed",
      endpoint: masked,
      message: "OTLP export returned an error. Check endpoint URL and API key (ingest role).",
    });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: errorMessage,
      endpoint: masked,
      message: "Exception during OTLP export. Check endpoint is reachable and credentials are valid.",
    });
  }
}
