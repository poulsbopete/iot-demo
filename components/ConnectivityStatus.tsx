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
      <div className="flex items-center gap-2 text-sm text-white/80">
        <span className="h-2 w-2 rounded-full bg-white/60 animate-pulse" />
        Checking connectivity…
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm text-white">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status?.elastic.ok ? "bg-ecolab-green" : "bg-red-300"
          )}
        />
        <span className={status?.elastic.ok ? "text-white" : "text-red-100"}>
          Elastic {status?.elastic.ok ? "OK" : status?.elastic.error ?? "Error"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status?.otlp.ok ? "bg-ecolab-green" : "bg-amber-200"
          )}
        />
        <span className={status?.otlp.ok ? "text-white" : "text-amber-100"}>
          OTLP {status?.otlp.ok ? "OK" : status?.otlp.error ?? "Not configured"}
        </span>
      </div>
    </div>
  );
}
