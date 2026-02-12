import { NextResponse } from "next/server";

/**
 * Start simulation: in this step-based design we don't run a background loop.
 * Client should poll /api/simulate/step every DEMO_INTERVAL_MS.
 * This route just acknowledges and returns polling hint.
 */
export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Simulation is step-based. Poll /api/simulate/step every DEMO_INTERVAL_MS (default 5000ms).",
  });
}
