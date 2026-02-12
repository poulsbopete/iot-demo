/**
 * MCP client: calls external MCP_SERVER_URL or uses internal tool router.
 * Tools: elastic.esql_query, elastic.search, elastic.get_timeseries, elastic.detect_anomalies
 */

import * as elastic from "./elastic";
import type { MCPToolCall, MCPToolResult } from "./types";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "";

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
