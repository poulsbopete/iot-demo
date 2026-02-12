import { NextResponse } from "next/server";
import { getTimeseries } from "@/lib/elastic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const metric = searchParams.get("metric") ?? "chemical.dosing_rate_lpm";
  const site = searchParams.get("site") ?? null;
  const from = searchParams.get("from") ?? "now-30m";
  const to = searchParams.get("to") ?? "now";
  const interval = searchParams.get("interval") ?? "1m";
  try {
    const data = await getTimeseries(metric, site, from, to, interval);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
