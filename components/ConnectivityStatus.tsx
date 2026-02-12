"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface Status {
  elastic: { ok: boolean; error?: string };
  otlp: { ok: boolean; error?: string };
}

export function ConnectivityStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ elastic: { ok: false, error: "Network error" }, otlp: { ok: false, error: "Network error" } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStatus();
    const t = setInterval(fetchStatus, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        Checking connectivity…
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status?.elastic.ok ? "bg-emerald-500" : "bg-red-500"
          )}
        />
        <span className={status?.elastic.ok ? "text-slate-300" : "text-red-400"}>
          Elastic {status?.elastic.ok ? "OK" : status?.elastic.error ?? "Error"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status?.otlp.ok ? "bg-emerald-500" : "bg-amber-500"
          )}
        />
        <span className={status?.otlp.ok ? "text-slate-300" : "text-amber-400"}>
          OTLP {status?.otlp.ok ? "OK" : status?.otlp.error ?? "Not configured"}
        </span>
      </div>
    </div>
  );
}
