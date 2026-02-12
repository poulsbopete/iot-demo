"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/cn";

interface TimeSeriesBucket {
  time: string;
  value: number;
}

const METRIC_OPTIONS = [
  "chemical.dosing_rate_lpm",
  "chemical.tank_level_pct",
  "chemical.conductivity_uS",
  "sanitation.sanitizer_ppm",
  "sanitation.water_temp_c",
  "water.flow_rate_lpm",
  "device.status",
] as const;

const SITE_OPTIONS = ["Hospital", "Restaurant", "FoodPlant"] as const;

export function MetricChart({
  metric,
  site,
  title,
  className,
}: {
  metric: string;
  site: string | null;
  title?: string;
  className?: string;
}) {
  const [data, setData] = useState<TimeSeriesBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          metric,
          from: "now-30m",
          to: "now",
          interval: "1m",
        });
        if (site) params.set("site", site);
        const res = await fetch(`/api/metrics/timeseries?${params}`);
        const json = await res.json();
        if (!cancelled) {
          if (json.error) setError(json.error);
          else setData(Array.isArray(json) ? json : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
  }, [metric, site]);

  if (loading) {
    return (
      <div className={cn("rounded-lg border border-slate-700 bg-slate-900/50 p-6 flex items-center justify-center min-h-[200px]", className)}>
        <span className="text-slate-400">Loading chart…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-lg border border-amber-700 bg-amber-900/20 p-4", className)}>
        <p className="text-amber-300 text-sm">{error}</p>
      </div>
    );
  }

  const displayTitle = title ?? `${metric}${site ? ` (${site})` : ""}`;

  return (
    <div className={cn("rounded-lg border border-slate-700 bg-slate-900/50 p-4", className)}>
      <h4 className="text-sm font-medium text-slate-300 mb-2">{displayTitle}</h4>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="time"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            tickFormatter={(v) => {
              try {
                const d = new Date(v);
                return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              } catch {
                return v;
              }
            }}
          />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }}
            labelFormatter={(v) => new Date(v).toLocaleString()}
          />
          <Legend />
          <Line type="monotone" dataKey="value" stroke="#00c896" strokeWidth={2} name="value" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricChartSelector({
  selectedMetric,
  selectedSite,
  onMetricChange,
  onSiteChange,
}: {
  selectedMetric: string;
  selectedSite: string | null;
  onMetricChange: (m: string) => void;
  onSiteChange: (s: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4 items-center">
      <div>
        <label className="text-xs text-slate-400 mr-2">Metric</label>
        <select
          value={selectedMetric}
          onChange={(e) => onMetricChange(e.target.value)}
          className="rounded border border-slate-600 bg-slate-800 text-slate-200 text-sm px-2 py-1"
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-400 mr-2">Site</label>
        <select
          value={selectedSite ?? ""}
          onChange={(e) => onSiteChange(e.target.value || null)}
          className="rounded border border-slate-600 bg-slate-800 text-slate-200 text-sm px-2 py-1"
        >
          <option value="">All sites</option>
          {SITE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
