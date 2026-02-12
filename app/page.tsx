"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { DemoControl } from "@/components/DemoControl";
import { AlertBanners } from "@/components/AlertBanners";
import { MetricChart, MetricChartSelector } from "@/components/MetricChart";
import { CopilotPanel } from "@/components/CopilotPanel";

const DEMO_INTERVAL_MS =
  typeof process.env.NEXT_PUBLIC_DEMO_INTERVAL_MS !== "undefined"
    ? Number(process.env.NEXT_PUBLIC_DEMO_INTERVAL_MS) || 5000
    : 5000;

export default function Home() {
  const [metric, setMetric] = useState("chemical.dosing_rate_lpm");
  const [site, setSite] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [lastStepResult, setLastStepResult] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runStep = useCallback(async (injectAnomaly?: string) => {
    try {
      const res = await fetch("/api/simulate/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(injectAnomaly ? { injectAnomaly } : {}),
      });
      const data = await res.json();
      if (data.ok) {
        setLastStepResult(`Sent ${data.metricCount} metrics${data.anomaliesInjected?.length ? ` (anomalies: ${data.anomaliesInjected.join(", ")})` : ""}`);
      } else {
        setLastStepResult(`Error: ${data.error ?? "Unknown"}`);
      }
    } catch (e) {
      setLastStepResult(`Error: ${e instanceof Error ? e.message : "Network"}`);
    }
  }, []);

  const runBurst = useCallback(async () => {
    const steps = 12; // 60s at 5s interval
    for (let i = 0; i < steps; i++) {
      await runStep();
    }
    setLastStepResult(`Burst complete: ${steps} steps sent.`);
  }, [runStep]);

  const injectAnomaly = useCallback((anomaly: string) => {
    runStep(anomaly);
  }, [runStep]);

  useEffect(() => {
    if (autoRunning) {
      runStep();
      intervalRef.current = setInterval(() => runStep(), DEMO_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRunning, runStep]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white tracking-tight">
          Ecolab IoT Command Center
        </h1>
        <ConnectivityStatus />
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-6">
        {/* Left: site/device selector + demo control */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Sites & Metrics</h3>
            <MetricChartSelector
              selectedMetric={metric}
              selectedSite={site}
              onMetricChange={setMetric}
              onSiteChange={setSite}
            />
          </div>
          <DemoControl
            onStep={() => runStep()}
            onBurst={runBurst}
            onInjectAnomaly={injectAnomaly}
            autoRunning={autoRunning}
            onAutoRunToggle={() => setAutoRunning((v) => !v)}
          />
          {lastStepResult && (
            <p className="text-xs text-slate-400">{lastStepResult}</p>
          )}
        </aside>

        {/* Center: charts + alerts */}
        <main className="lg:col-span-6 space-y-4">
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Alert Banners</h2>
            <AlertBanners />
          </section>
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Live Time-Series</h2>
            <div className="space-y-4">
              <MetricChart metric={metric} site={site} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricChart metric="chemical.tank_level_pct" site={site} title="Tank level %" />
                <MetricChart metric="sanitation.sanitizer_ppm" site={site} title="Sanitizer ppm" />
              </div>
            </div>
          </section>
        </main>

        {/* Right: Copilot */}
        <aside className="lg:col-span-3">
          <CopilotPanel />
        </aside>
      </div>
    </div>
  );
}
