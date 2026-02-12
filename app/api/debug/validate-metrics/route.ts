import { NextResponse } from "next/server";
import { getMetricsDocCount, getMetricsSample } from "@/lib/elastic";

/**
 * GET /api/debug/validate-metrics?from=now-24h&to=now
 * Validates that metrics exist in Elastic: count, index, and a sample document (field names + truncated source).
 * Use this to confirm data landed from OTLP.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-24h";
  const to = searchParams.get("to") ?? "now";

  const report: {
    valid: boolean;
    message: string;
    count: number;
    index: string;
    from: string;
    to: string;
    fieldNames?: string[];
    samplePreview?: Record<string, unknown>;
    error?: string;
  } = {
    valid: false,
    message: "",
    count: 0,
    index: "",
    from,
    to,
  };

  try {
    const countResult = await getMetricsDocCount(from, to);
    report.count = countResult.count;
    report.index = countResult.index;
    report.from = countResult.from;
    report.to = countResult.to;

    if (countResult.count === 0) {
      report.message =
        "No metric documents found. Ensure (1) OTLP_ENDPOINT sends to the same project as ELASTIC_ENDPOINT, (2) you've sent metrics via Step/Auto-run, (3) ELASTIC_API_KEY has read access to metrics-*.";
      return NextResponse.json(report);
    }

    report.valid = true;
    report.message = `Found ${countResult.count} metric document(s) in ${countResult.index}.`;

    const { sample } = await getMetricsSample(from, to);
    if (sample && typeof sample === "object") {
      report.fieldNames = Object.keys(sample).sort();
      report.samplePreview = {};
      for (const [k, v] of Object.entries(sample)) {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          report.samplePreview[k] = "(object)";
        } else if (Array.isArray(v)) {
          report.samplePreview[k] = `(array[${v.length}])`;
        } else {
          report.samplePreview[k] = v;
        }
      }
    }
    return NextResponse.json(report);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.message = "Validation failed.";
    return NextResponse.json(report, { status: 500 });
  }
}
