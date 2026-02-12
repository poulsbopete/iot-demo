import { NextResponse } from "next/server";
import { generateMetricBatch } from "@/lib/simulator";
import { exportBatchToOTLP } from "@/lib/otlpExport";
import type { AnomalyType } from "@/lib/types";

/** In-memory step index for demo (resets per serverless instance). */
let stepIndex = 0;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const injectAnomaly = body.injectAnomaly as AnomalyType | undefined;
    const seed = body.seed ?? Number(process.env.DEMO_SEED ?? 42);

    const batch = generateMetricBatch({
      seed,
      stepIndex,
      injectAnomaly,
    });
    stepIndex += 1;

    const exportResult = await exportBatchToOTLP(batch);

    return NextResponse.json({
      ok: true,
      stepIndex: batch.stepIndex,
      metricCount: batch.metrics.length,
      anomaliesInjected: batch.anomaliesInjected ?? [],
      export: exportResult,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
