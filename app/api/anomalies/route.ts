import { NextResponse } from "next/server";
import { getAnomalies } from "@/lib/elastic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "now-30m";
  const to = searchParams.get("to") ?? "now";
  try {
    const data = await getAnomalies(from, to);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
