import { NextResponse } from "next/server";
import { getMetricsDocCount } from "@/lib/elastic";

/** GET /api/debug/data-check?from=now-1h&to=now - raw doc count in metrics-* to confirm data landed. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-1h";
  const to = searchParams.get("to") ?? "now";
  try {
    const result = await getMetricsDocCount(from, to);
    return NextResponse.json({
      ...result,
      message:
        result.count > 0
          ? `${result.count} metric document(s) in Elastic (${result.index})`
          : `No metric documents in Elastic for ${from} to ${to}. Send metrics via Step/Auto-run and ensure OTLP export is configured.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), count: 0 },
      { status: 500 }
    );
  }
}
