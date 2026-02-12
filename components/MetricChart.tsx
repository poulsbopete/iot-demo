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
      <div className={cn("rounded-lg border border-ecolab-gray-light bg-white p-6 flex items-center justify-center min-h-[200px] shadow-sm", className)}>
        <span className="text-ecolab-gray">Loading chart…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm", className)}>
        <p className="text-amber-800 text-sm">{error}</p>
      </div>
    );
  }

  const displayTitle = title ?? `${metric}${site ? ` (${site})` : ""}`;
  const isEmpty = !data || data.length === 0;

  return (
    <div className={cn("rounded-lg border border-ecolab-gray-light bg-white p-4 shadow-sm", className)}>
      <h4 className="text-sm font-medium text-ecolab-navy mb-2">{displayTitle}</h4>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center min-h-[220px] text-center px-4">
          <p className="text-ecolab-gray text-sm">No data in the last 30 minutes.</p>
          <p className="text-ecolab-gray text-xs mt-1">Use &quot;Step (send metrics)&quot; or &quot;Auto-run&quot; to send OTLP metrics, then refresh.</p>
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8ECEE" />
          <XAxis
            dataKey="time"
            tick={{ fill: "#5C6B73", fontSize: 10 }}
            tickFormatter={(v) => {
              try {
                const d = new Date(v);
                return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              } catch {
                return v;
              }
            }}
          />
          <YAxis tick={{ fill: "#5C6B73", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#fff", border: "1px solid #E8ECEE", borderRadius: "6px" }}
            labelFormatter={(v) => new Date(v).toLocaleString()}
          />
          <Legend />
          <Line type="monotone" dataKey="value" stroke="#0098CC" strokeWidth={2} name="value" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      )}
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
        <label className="text-xs text-ecolab-gray mr-2">Metric</label>
        <select
          value={selectedMetric}
          onChange={(e) => onMetricChange(e.target.value)}
          className="rounded border border-gray-300 bg-white text-gray-900 text-sm px-2 py-1"
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-ecolab-gray mr-2">Site</label>
        <select
          value={selectedSite ?? ""}
          onChange={(e) => onSiteChange(e.target.value || null)}
          className="rounded border border-gray-300 bg-white text-gray-900 text-sm px-2 py-1"
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
