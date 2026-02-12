"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

const CANNED_QUESTIONS = [
  { id: "overdosing", label: "Which site is overdosing chemicals in the last 30 minutes?" },
  { id: "pump_failures", label: "Any pump failures today?" },
  { id: "sanitizer_by_site", label: "Show sanitizer ppm by site last 15 minutes." },
  { id: "abnormal_device", label: "Which device is behaving abnormally?" },
  { id: "status_summary", label: "Give me a plain-English status summary." },
] as const;

export function CopilotPanel() {
  const [questionId, setQuestionId] = useState<string>("");
  const [freeform, setFreeform] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(overrideQuestionId?: string, customQuestion?: string) {
    const qId = overrideQuestionId ?? questionId;
    const q = customQuestion ?? (qId ? CANNED_QUESTIONS.find((c) => c.id === qId)?.label : "");
    if (!qId && !customQuestion?.trim()) {
      setError("Select a question or type a custom one.");
      return;
    }
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          customQuestion?.trim()
            ? { question: customQuestion.trim(), toolCalls: [] }
            : { questionId: qId, question: q }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setSummary(data.summary ?? "No summary returned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-ecolab-gray-light bg-white p-4 flex flex-col h-full min-h-[320px] shadow-sm">
      <h3 className="text-sm font-semibold text-ecolab-navy mb-3">AI Ops Copilot</h3>
      <div className="space-y-2 flex-1 flex flex-col min-h-0">
        <p className="text-xs text-ecolab-gray">Canned questions:</p>
        <div className="flex flex-col gap-1.5">
          {CANNED_QUESTIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setQuestionId(c.id);
                ask(c.id);
              }}
              disabled={loading}
              className={cn(
                "text-left text-xs rounded-md px-3 py-2 border transition-colors",
                "border-gray-300 bg-gray-50 text-ecolab-navy hover:bg-ecolab-blue/5 hover:border-ecolab-blue/30 disabled:opacity-50"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="pt-2">
          <label className="text-xs text-ecolab-gray block mb-1">Freeform (e.g. “any pump failures?” — runs MCP/tools when matched)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(undefined, freeform)}
              placeholder="Type and press Enter…"
              className="flex-1 rounded border border-gray-300 bg-white text-gray-900 text-sm px-3 py-1.5 placeholder-gray-400"
            />
            <button
              onClick={() => ask(undefined, freeform)}
              disabled={loading}
              className="rounded-md px-3 py-1.5 text-sm font-medium bg-ecolab-green text-white hover:bg-ecolab-green-dark disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </div>
        <div className="mt-2 flex-1 min-h-0 overflow-auto rounded border border-ecolab-gray-light bg-gray-50 p-3">
          {loading && <p className="text-ecolab-gray text-sm">Querying tools and summarizing…</p>}
          {error && <p className="text-amber-700 text-sm">{error}</p>}
          {summary && !loading && (
            <pre className="text-xs text-ecolab-gray whitespace-pre-wrap font-sans">{summary}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
