import { NextResponse } from "next/server";
import { getMetricsDocCount, getMetricsSample } from "@/lib/elastic";

/** Mask a URL to show host for same-project check (no secrets). */
function maskEndpoint(url: string): string {
  if (!url || typeof url !== "string") return "(not set)";
  const u = url.replace(/\/+$/, "").trim();
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    const host = parsed.hostname;
    if (host.length <= 30) return host;
    return `${host.slice(0, 18)}…${host.slice(-10)}`;
  } catch {
    return u.slice(0, 40) + (u.length > 40 ? "…" : "");
  }
}

/** GET /api/debug/data-check?from=now-1h&to=now&sample=1 - raw doc count and optional sample field names. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-1h";
  const to = searchParams.get("to") ?? "now";
  const includeSample = searchParams.get("sample") === "1";
  const queryHost = maskEndpoint(process.env.ELASTIC_ENDPOINT ?? "");
  const otlpHost = maskEndpoint(process.env.OTLP_ENDPOINT ?? process.env.ELASTIC_ENDPOINT ?? "");
  try {
    const result = await getMetricsDocCount(from, to);
    let fieldNames: string[] = [];
    if (includeSample && result.count > 0) {
      const { sample } = await getMetricsSample(from, to);
      if (sample) fieldNames = Object.keys(sample).sort();
    }
    return NextResponse.json({
      ...result,
      queryHost,
      otlpHost,
      fieldNames: fieldNames.length > 0 ? fieldNames : undefined,
      message:
        result.count > 0
          ? `${result.count} metric document(s) in Elastic (${result.index})`
          : `No metric documents in Elastic for ${from} to ${to}. Send metrics via Step/Auto-run and ensure OTLP export is configured.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), count: 0, queryHost, otlpHost },
      { status: 500 }
    );
  }
}
