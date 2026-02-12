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

interface DataCheck {
  count: number;
  message: string;
  from: string;
  to: string;
  fieldNames?: string[];
  queryHost?: string;
  otlpHost?: string;
}

export default function Home() {
  const [metric, setMetric] = useState("chemical.dosing_rate_lpm");
  const [site, setSite] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [lastStepResult, setLastStepResult] = useState<string | null>(null);
  const [dataCheck, setDataCheck] = useState<DataCheck | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/debug/data-check?from=now-1h&to=now&sample=1");
        const data = await res.json();
        if (!cancelled && !data.error) {
          setDataCheck({
            count: data.count ?? 0,
            message: data.message ?? "",
            from: data.from ?? "",
            to: data.to ?? "",
            fieldNames: data.fieldNames,
            queryHost: data.queryHost,
            otlpHost: data.otlpHost,
          });
        }
      } catch {
        if (!cancelled) setDataCheck(null);
      }
    }
    check();
    const t = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ecolab-blue/20 bg-ecolab-blue px-6 py-4 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-bold text-white tracking-tight">
          Ecolab IoT Command Center
        </h1>
        <ConnectivityStatus />
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-6">
        {/* Left: site/device selector + demo control */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border border-ecolab-gray-light bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-ecolab-navy mb-3">Sites & Metrics</h3>
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
            <p className="text-xs text-ecolab-gray">{lastStepResult}</p>
          )}
          {dataCheck !== null && (
            <div className="text-xs text-ecolab-gray space-y-1">
              <p>
                <span className="font-medium">Data in Elastic:</span>{" "}
                {dataCheck.count > 0 ? (
                  <span className="text-ecolab-green-dark">{dataCheck.count} docs (last 1h)</span>
                ) : (
                  <span>
                    No docs in last 1h. Query: <code className="bg-gray-100 px-0.5 rounded">{dataCheck.queryHost ?? "—"}</code>
                    {" · "}
                    OTLP: <code className="bg-gray-100 px-0.5 rounded">{dataCheck.otlpHost ?? "—"}</code>
                    {" — use the same deployment for both (ingest URL for OTLP, .es. for query)."}
                  </span>
                )}
              </p>
              {dataCheck.count > 0 && dataCheck.fieldNames && dataCheck.fieldNames.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer hover:text-ecolab-navy">Sample doc fields</summary>
                  <pre className="mt-1 p-2 bg-gray-100 rounded text-[10px] overflow-auto max-h-24">
                    {dataCheck.fieldNames.join(", ")}
                  </pre>
                </details>
              )}
            </div>
          )}
        </aside>

        {/* Center: charts + alerts */}
        <main className="lg:col-span-6 space-y-4">
          <section>
            <h2 className="text-sm font-semibold text-ecolab-navy mb-2">Ecolab Cases</h2>
            <AlertBanners />
          </section>
          <section>
            <h2 className="text-sm font-semibold text-ecolab-navy mb-2">Live Time-Series</h2>
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
