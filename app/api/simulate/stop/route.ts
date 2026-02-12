import { NextResponse } from "next/server";

/** Stop simulation: no persistent state to clear; step index resets per instance. */
export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Step-based simulation has no persistent runner. Stop polling /api/simulate/step to end.",
  });
}
