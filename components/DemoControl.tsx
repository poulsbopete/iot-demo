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
  hasTraffic = false,
}: {
  onStep: () => void;
  onBurst: () => void;
  onInjectAnomaly: (anomaly: string) => void;
  autoRunning: boolean;
  onAutoRunToggle: () => void;
  disabled?: boolean;
  /** When true, the IoT dots animation runs (only when there is recent/active traffic). */
  hasTraffic?: boolean;
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
      {/* Ecolab IoT animation: conveys testing an IoT endpoint */}
      <div className="mb-3 pb-3 border-b border-ecolab-gray-light">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5" aria-hidden>
            {[
              { bg: "bg-ecolab-blue", delay: "" },
              { bg: "bg-ecolab-blue", delay: "animate-iot-pulse-delay-1" },
              { bg: "bg-ecolab-green", delay: "animate-iot-pulse-delay-2" },
              { bg: "bg-ecolab-blue", delay: "animate-iot-pulse-delay-3" },
              { bg: "bg-ecolab-green", delay: "animate-iot-pulse-delay-4" },
            ].map(({ bg, delay }, i) => (
              <span
                key={i}
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  bg,
                  hasTraffic ? "animate-iot-pulse" : "opacity-60",
                  hasTraffic && delay
                )}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-ecolab-navy">Ecolab IoT</span>
          <svg
            className="w-4 h-4 text-ecolab-blue flex-shrink-0 ml-auto"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83M19.07 4.93l-2.83 2.83m-8.48 8.48l-2.83 2.83" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <p className="text-[10px] text-ecolab-gray mt-1 ml-7">Testing IoT endpoint</p>
      </div>
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
