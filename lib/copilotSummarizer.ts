/**
 * Summarize MCP tool results for the Copilot panel.
 * If OPENAI_API_KEY is set, optionally call OpenAI; otherwise use rule-based summary.
 */

import type { MCPToolResult } from "./types";

export async function summarizeToolResults(
  question: string,
  toolResults: MCPToolResult[]
): Promise<string> {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  if (hasOpenAI) {
    try {
      return await summarizeWithOpenAI(question, toolResults);
    } catch {
      // fallback to rule-based
    }
  }
  return summarizeRuleBased(question, toolResults);
}

async function summarizeWithOpenAI(
  question: string,
  toolResults: MCPToolResult[]
): Promise<string> {
  const payload = toolResults.map((r) => ({
    tool: r.tool,
    content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
    error: r.error,
  }));
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an AI Ops assistant for an IoT command center. Summarize the tool results in plain English, focusing on anomalies, failures, and key metrics. Be concise.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nTool results:\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      max_tokens: 500,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content ?? "No summary generated.";
}

function summarizeRuleBased(question: string, toolResults: MCPToolResult[]): string {
  const lines: string[] = [];
  for (const r of toolResults) {
    if (r.error) {
      lines.push(`[${r.tool}] Error: ${r.error}`);
      continue;
    }
    const raw = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    if (r.tool === "elastic.detect_anomalies") {
      try {
        const arr = JSON.parse(raw) as Array<{ type: string; site: string; device: string; description: string; severity: string }>;
        if (Array.isArray(arr)) {
          if (arr.length === 0) lines.push("No anomalies detected in the time range.");
          else {
            lines.push(`Found ${arr.length} anomaly(ies):`);
            arr.slice(0, 10).forEach((a) => {
              lines.push(`- [${a.severity}] ${a.site} / ${a.device}: ${a.description}`);
            });
          }
        } else lines.push(raw.slice(0, 500));
      } catch {
        lines.push(raw.slice(0, 500));
      }
      continue;
    }
    if (r.tool === "elastic.get_timeseries") {
      try {
        const arr = JSON.parse(raw) as Array<{ time: string; value: number }>;
        if (Array.isArray(arr) && arr.length > 0) {
          const last = arr[arr.length - 1];
          const avg = arr.reduce((s, x) => s + x.value, 0) / arr.length;
          lines.push(`Timeseries: ${arr.length} points; latest value: ${last?.value ?? "N/A"}; avg: ${avg.toFixed(2)}`);
        } else lines.push("No timeseries data in range.");
      } catch {
        lines.push(raw.slice(0, 500));
      }
      continue;
    }
    if (r.tool === "elastic.search") {
      try {
        const obj = JSON.parse(raw) as { hits?: { total?: { value?: number }; hits?: unknown[] } };
        const total = obj.hits?.total?.value ?? obj.hits?.hits?.length ?? 0;
        lines.push(`Search returned ${total} hit(s).`);
        if (obj.hits?.hits?.length) {
          (obj.hits.hits as Array<{ _source?: Record<string, unknown> }>).slice(0, 3).forEach((h, i) => {
            lines.push(`  Hit ${i + 1}: ${JSON.stringify(h._source ?? {}).slice(0, 120)}...`);
          });
        }
      } catch {
        lines.push(raw.slice(0, 500));
      }
      continue;
    }
    lines.push(`[${r.tool}]: ${raw.slice(0, 400)}${raw.length > 400 ? "..." : ""}`);
  }
  return lines.join("\n\n") || "No results to summarize.";
}
