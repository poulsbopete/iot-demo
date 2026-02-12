import { NextResponse } from "next/server";
import { getMetricsSummary } from "@/lib/elastic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-15m";
  const to = searchParams.get("to") ?? "now";
  try {
    const summary = await getMetricsSummary(from, to);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
