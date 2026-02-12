import { NextResponse } from "next/server";
import { getMetricsSample } from "@/lib/elastic";

/** GET /api/debug/metrics-sample?from=now-24h&to=now - one sample doc to see field structure. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-24h";
  const to = searchParams.get("to") ?? "now";
  try {
    const { sample, index } = await getMetricsSample(from, to);
    if (!sample) {
      return NextResponse.json({
        message: "No documents in range - send metrics first.",
        index,
        sample: null,
        fieldNames: [],
      });
    }
    const fieldNames = Object.keys(sample).sort();
    return NextResponse.json({
      index,
      sample,
      fieldNames,
      message: "Use fieldNames to see how metrics are stored; charts query metrics.<name> or metric.name/value.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
