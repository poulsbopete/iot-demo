"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface EcolabCaseItem {
  id: string;
  title: string;
  description: string;
  status: string;
  severity?: string;
  tags: string[];
  createdAt: string;
  totalAlerts: number;
  totalComments: number;
  url: string;
}

export function AlertBanners() {
  const [cases, setCases] = useState<EcolabCaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchCases() {
      try {
        const res = await fetch("/api/cases?limit=10");
        const data = await res.json();
        if (!cancelled) {
          if (data.error) setError(data.error);
          else setCases(Array.isArray(data.cases) ? data.cases : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCases();
    const t = setInterval(fetchCases, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-ecolab-gray-light bg-white px-4 py-2 text-sm text-ecolab-gray shadow-sm">
        Loading Ecolab cases…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-sm">
        Cases unavailable: {error}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="rounded-lg border border-ecolab-gray-light bg-white px-4 py-2 text-sm text-ecolab-gray shadow-sm">
        No Ecolab cases found. Cases created by the RCA workflow (tags: IoT, Ecolab, Demo) will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <a
          key={c.id}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block rounded-lg border px-4 py-2 text-sm shadow-sm transition hover:opacity-90",
            c.status === "open" && "border-amber-300 bg-amber-50 text-amber-900",
            c.status === "in-progress" && "border-ecolab-teal/40 bg-ecolab-teal/5 text-ecolab-navy",
            (c.status === "closed" || !["open", "in-progress"].includes(c.status)) &&
              "border-ecolab-gray-light bg-white text-ecolab-gray"
          )}
        >
          <div className="font-medium">{c.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs opacity-90">
            <span className="capitalize">{c.status.replace(/-/g, " ")}</span>
            {c.tags.length > 0 && (
              <span className="text-ecolab-gray">· {c.tags.slice(0, 5).join(", ")}</span>
            )}
            {(c.totalAlerts > 0 || c.totalComments > 0) && (
              <span>
                {c.totalAlerts > 0 && `${c.totalAlerts} alert${c.totalAlerts !== 1 ? "s" : ""}`}
                {c.totalAlerts > 0 && c.totalComments > 0 && " · "}
                {c.totalComments > 0 && `${c.totalComments} comment${c.totalComments !== 1 ? "s" : ""}`}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}
