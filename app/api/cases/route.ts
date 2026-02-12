import { NextResponse } from "next/server";
import { getEcolabCases } from "@/lib/cases";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10) || 10, 50);
  const { cases, error } = await getEcolabCases(limit);
  if (error) {
    return NextResponse.json({ cases: [], error }, { status: 500 });
  }
  return NextResponse.json({ cases });
}
