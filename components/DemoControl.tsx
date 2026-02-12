"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type AnomalyOption = "none" | "underdosing" | "pump_failure" | "tank_leak" | "thermal_high" | "thermal_low";

export function DemoControl({
  onStep,
  onBurst,
  onInjectAnomaly,
  autoRunning,
  onAutoRunToggle,
  disabled,
}: {
  onStep: () => void;
  onBurst: () => void;
  onInjectAnomaly: (anomaly: string) => void;
  autoRunning: boolean;
  onAutoRunToggle: () => void;
  disabled?: boolean;
}) {
  const [anomaly, setAnomaly] = useState<AnomalyOption>("none");
  const [loading, setLoading] = useState<"step" | "burst" | null>(null);

  async function handleStep() {
    setLoading("step");
    try {
      await onStep();
    } finally {
      setLoading(null);
    }
  }

  async function handleBurst() {
    setLoading("burst");
    try {
      await onBurst();
    } finally {
      setLoading(null);
    }
  }

  function handleInject() {
    if (anomaly !== "none") {
      onInjectAnomaly(anomaly);
      setAnomaly("none");
    }
  }

  return (
    <div className="rounded-lg border border-ecolab-gray-light bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-ecolab-navy mb-3">Demo Control</h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleStep}
          disabled={disabled || loading !== null}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-ecolab-blue hover:bg-ecolab-blue-dark text-white disabled:opacity-50"
          )}
        >
          {loading === "step" ? "Sending…" : "Step (send metrics)"}
        </button>
        <button
          onClick={onAutoRunToggle}
          disabled={disabled}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium border",
            autoRunning
              ? "border-ecolab-green bg-ecolab-green/10 text-ecolab-green-dark"
              : "border-gray-300 bg-gray-50 text-ecolab-gray hover:bg-gray-100"
          )}
        >
          {autoRunning ? "Stop auto-run" : "Auto-run (polling)"}
        </button>
        <button
          onClick={handleBurst}
          disabled={disabled || loading !== null}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-ecolab-gray text-white hover:bg-ecolab-navy disabled:opacity-50"
          )}
        >
          {loading === "burst" ? "Sending…" : "Burst 60s"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-ecolab-gray">Inject anomaly:</label>
        <select
          value={anomaly}
          onChange={(e) => setAnomaly(e.target.value as AnomalyOption)}
          className="rounded border border-gray-300 bg-white text-gray-900 text-xs px-2 py-1"
        >
          <option value="none">None</option>
          <option value="underdosing">Underdosing</option>
          <option value="pump_failure">Pump failure</option>
          <option value="tank_leak">Tank leak</option>
          <option value="thermal_high">Thermal high</option>
          <option value="thermal_low">Thermal low</option>
        </select>
        <button
          onClick={handleInject}
          disabled={disabled || anomaly === "none"}
          className="rounded-md px-2 py-1 text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50"
        >
          Inject
        </button>
      </div>
    </div>
  );
}
