"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface AnomalyRecord {
  time: string;
  site: string;
  device: string;
  type: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export function AlertBanners() {
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnomalies() {
      try {
        const res = await fetch("/api/anomalies?from=now-30m&to=now");
        const data = await res.json();
        if (!cancelled) {
          if (data.error) setError(data.error);
          else setAnomalies(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAnomalies();
    const t = setInterval(fetchAnomalies, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2 text-sm text-slate-400">
        Loading alerts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/20 px-4 py-2 text-sm text-amber-300">
        Alerts unavailable: {error}
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2 text-sm text-slate-400">
        No anomalies in the last 30 minutes.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {anomalies.slice(0, 5).map((a, i) => (
        <div
          key={`${a.time}-${a.device}-${i}`}
          className={cn(
            "rounded-lg border px-4 py-2 text-sm",
            a.severity === "high" && "border-red-700 bg-red-900/20 text-red-200",
            a.severity === "medium" && "border-amber-700 bg-amber-900/20 text-amber-200",
            a.severity === "low" && "border-slate-600 bg-slate-800/50 text-slate-300"
          )}
        >
          <span className="font-medium">{a.type}</span> — {a.site} / {a.device}: {a.description}
        </div>
      ))}
    </div>
  );
}
