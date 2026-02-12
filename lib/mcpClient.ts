/**
 * MCP client: calls external MCP_SERVER_URL or uses internal tool router.
 * Tools: elastic.esql_query, elastic.search, elastic.get_timeseries, elastic.detect_anomalies
 */

import * as elastic from "./elastic";
import type { MCPToolCall, MCPToolResult } from "./types";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "";
const ELASTIC_AGENT_ID = process.env.ELASTIC_AGENT_ID ?? "elastic-ai-agent";

/** Derive Kibana base URL from MCP_SERVER_URL (e.g. .../api/agent_builder/mcp -> ...). */
function getKibanaBaseFromMCP(): string {
  const u = MCP_SERVER_URL.replace(/\/+$/, "");
  return u.replace(/\/api\/agent_builder\/mcp\/?$/i, "") || u;
}

/** Default Converse API timeout (ms). Fail fast so the UI doesn't hang. */
const CONVERSE_TIMEOUT_MS = 12_000;

/**
 * Send the user's question to the Elastic Agent Builder Converse API (same agent as Agent Chat).
 * The agent runs reasoning and tools (e.g. platform.core.search, synthetics.alerts) and returns the reply.
 * Uses a timeout so the call doesn't hang; pass timeoutMs to override.
 */
export async function callElasticAgentConverse(
  question: string,
  options?: { timeoutMs?: number }
): Promise<{ message: string; error?: string }> {
  const base = getKibanaBaseFromMCP();
  const apiKey = process.env.ELASTIC_API_KEY ?? "";
  if (!base || !apiKey) {
    return { message: "", error: "MCP_SERVER_URL and ELASTIC_API_KEY are required for Elastic Agent Converse." };
  }
  const timeoutMs = options?.timeoutMs ?? CONVERSE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/agent_builder/converse`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "kbn-xsrf": "true",
        Authorization: `ApiKey ${apiKey}`,
      },
      body: JSON.stringify({
        input: question,
        agent_id: ELASTIC_AGENT_ID,
      }),
    });
    clearTimeout(timeoutId);
    const data = (await res.json()) as {
      response?: { message?: string };
      steps?: unknown[];
      conversation_id?: string;
      message?: string;
    };
    if (!res.ok) {
      const err = data.message ?? (data as { error?: string }).error ?? res.statusText;
      return { message: "", error: String(err) };
    }
    const message = data.response?.message ?? "";
    return { message: message || "No response from agent." };
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === "AbortError";
    return {
      message: "",
      error: isAbort
        ? "Request timed out. Try a simpler question or try again."
        : e instanceof Error ? e.message : String(e),
    };
  }
}

/** True when MCP_SERVER_URL points at Elastic Agent Builder (Kibana). */
export function isElasticAgentBuilderMCP(): boolean {
  return /\/api\/agent_builder\/mcp\/?$/i.test(MCP_SERVER_URL.replace(/\/+$/, ""));
}

export const INTERNAL_TOOLS = [
  "elastic.esql_query",
  "elastic.search",
  "elastic.get_timeseries",
  "elastic.detect_anomalies",
] as const;

/** Execute one tool via internal implementation. */
export async function executeInternalTool(
  name: string,
  args: Record<string, unknown>
): Promise<MCPToolResult> {
  try {
    if (name === "elastic.get_timeseries") {
      const metric = String(args.metric ?? "");
      const site = args.site != null ? String(args.site) : null;
      const from = String(args.from ?? "now-30m");
      const to = String(args.to ?? "now");
      const interval = String(args.interval ?? "1m");
      const data = await elastic.getTimeseries(metric, site, from, to, interval);
      return { tool: name, content: JSON.stringify(data, null, 2) };
    }
    if (name === "elastic.detect_anomalies") {
      const from = String(args.from ?? "now-30m");
      const to = String(args.to ?? "now");
      const data = await elastic.getAnomalies(from, to);
      return { tool: name, content: JSON.stringify(data, null, 2) };
    }
    if (name === "elastic.search") {
      const index = String(args.index ?? "metrics-*");
      const body = (args.body ?? {}) as Record<string, unknown>;
      const base = process.env.ELASTIC_ENDPOINT?.replace(/\/+$/, "") ?? "";
      const res = await fetch(`${base}/${index}/_search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ApiKey ${process.env.ELASTIC_API_KEY ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { tool: name, content: JSON.stringify(data, null, 2) };
    }
    if (name === "elastic.esql_query") {
      const query = String(args.query ?? "");
      const base = process.env.ELASTIC_ENDPOINT?.replace(/\/+$/, "") ?? "";
      const res = await fetch(`${base}/_query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ApiKey ${process.env.ELASTIC_API_KEY ?? ""}`,
        },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      return { tool: name, content: JSON.stringify(data, null, 2) };
    }
    return { tool: name, content: "", error: `Unknown tool: ${name}` };
  } catch (e) {
    return {
      tool: name,
      content: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Call external MCP server with JSON-RPC style tool invocation. */
export async function callExternalMCP(
  toolCalls: MCPToolCall[]
): Promise<MCPToolResult[]> {
  const url = MCP_SERVER_URL.replace(/\/+$/, "");
  const results: MCPToolResult[] = [];
  for (const call of toolCalls) {
    try {
      const res = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: call.name, arguments: call.arguments },
          id: 1,
        }),
      });
      const data = (await res.json()) as { result?: { content?: unknown[] }; error?: { message: string } };
      if (data.error) {
        results.push({ tool: call.name, content: "", error: data.error.message });
      } else {
        const content = (data.result?.content ?? []) as Array<{ type?: string; text?: string }>;
        const text = content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("\n");
        results.push({ tool: call.name, content: text || JSON.stringify(data.result) });
      }
    } catch (e) {
      results.push({
        tool: call.name,
        content: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/** Route: use external MCP if URL set, else internal tools. */
export async function invokeTools(toolCalls: MCPToolCall[]): Promise<MCPToolResult[]> {
  if (MCP_SERVER_URL) {
    return callExternalMCP(toolCalls);
  }
  const results: MCPToolResult[] = [];
  for (const call of toolCalls) {
    const r = await executeInternalTool(call.name, (call.arguments ?? {}) as Record<string, unknown>);
    results.push(r);
  }
  return results;
}

const CANNED_IDS = [
  "overdosing",
  "pump_failures",
  "sanitizer_by_site",
  "abnormal_device",
  "status_summary",
] as const;

/** Match freeform question to a canned questionId so we can run the same MCP/tool flow. */
export function matchFreeformToCannedQuestion(question: string): string | null {
  const q = question.toLowerCase().trim().replace(/\s+/g, " ");
  if (!q) return null;
  const checks: { id: (typeof CANNED_IDS)[number]; keywords: string[] }[] = [
    { id: "overdosing", keywords: ["overdos", "chemical", "dosing"] },
    { id: "pump_failures", keywords: ["pump", "failure", "failures", "failed"] },
    { id: "sanitizer_by_site", keywords: ["sanitizer", "sanitiser", "ppm", "by site"] },
    { id: "abnormal_device", keywords: ["abnormal", "device", "behaving", "anomal"] },
    { id: "status_summary", keywords: ["status", "summary", "plain", "english", "overview"] },
  ];
  for (const { id, keywords } of checks) {
    if (keywords.some((k) => q.includes(k))) return id;
  }
  return null;
}

/** Canned question → tool calls. */
export function cannedQuestionToTools(questionId: string): MCPToolCall[] {
  const from = "now-30m";
  const to = "now";
  switch (questionId) {
    case "overdosing":
      return [
        {
          name: "elastic.get_timeseries",
          arguments: { metric: "chemical.dosing_rate_lpm", from, to, interval: "5m" },
        },
        {
          name: "elastic.detect_anomalies",
          arguments: { from, to },
        },
      ];
    case "pump_failures":
      return [
        {
          name: "elastic.search",
          arguments: {
            index: "metrics-*",
            body: {
              size: 50,
              query: {
                bool: {
                  must: [
                    { range: { "@timestamp": { gte: "now-24h", lte: "now" } } },
                    { term: { "metric.name": "device.status" } },
                    { term: { "metric.value": 0 } },
                  ],
                },
              },
              sort: [{ "@timestamp": "desc" }],
            },
          },
        },
      ];
    case "sanitizer_by_site":
      return [
        {
          name: "elastic.get_timeseries",
          arguments: {
            metric: "sanitation.sanitizer_ppm",
            from: "now-15m",
            to: "now",
            interval: "1m",
          },
        },
      ];
    case "abnormal_device":
      return [
        { name: "elastic.detect_anomalies", arguments: { from, to } },
      ];
    case "status_summary":
      return [
        { name: "elastic.detect_anomalies", arguments: { from, to } },
        {
          name: "elastic.get_timeseries",
          arguments: {
            metric: "device.status",
            from,
            to,
            interval: "5m",
          },
        },
      ];
    default:
      return [];
  }
}
