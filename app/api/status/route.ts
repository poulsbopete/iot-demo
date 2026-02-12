import { NextResponse } from "next/server";
import { checkElasticConnection } from "@/lib/elastic";
import { checkOTLPConfig } from "@/lib/otlpExport";

export async function GET() {
  const [elastic, otlp] = await Promise.all([
    checkElasticConnection(),
    Promise.resolve(checkOTLPConfig()),
  ]);
  return NextResponse.json({
    elastic,
    otlp,
  });
}
