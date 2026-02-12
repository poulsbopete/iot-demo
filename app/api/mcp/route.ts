import { NextResponse } from "next/server";
import {
  invokeTools,
  cannedQuestionToTools,
  matchFreeformToCannedQuestion,
  callElasticAgentConverse,
  isElasticAgentBuilderMCP,
} from "@/lib/mcpClient";
import { summarizeToolResults } from "@/lib/copilotSummarizer";
import type { MCPToolCall } from "@/lib/types";

const CANNED_IDS = [
  "overdosing",
  "pump_failures",
  "sanitizer_by_site",
  "abnormal_device",
  "status_summary",
] as const;

const CANNED_LABELS: Record<string, string> = {
  overdosing: "Which site is overdosing chemicals in the last 30 minutes?",
  pump_failures: "Any pump failures today?",
  sanitizer_by_site: "Show sanitizer ppm by site last 15 minutes.",
  abnormal_device: "Which device is behaving abnormally?",
  status_summary: "Give me a plain-English status summary.",
};

/**
 * POST body: { questionId?: string, question?: string, toolCalls?: MCPToolCall[] }
 * - When MCP_SERVER_URL points at Elastic Agent Builder (/api/agent_builder/mcp), use the
 *   Elastic Agent Converse API so the same agent as Agent Chat runs (reasoning + tools).
 * - Otherwise: canned question → tools, freeform → match to canned → tools, or explicit toolCalls.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      questionId?: string;
      question?: string;
      toolCalls?: MCPToolCall[];
    };

    const questionForConverse =
      body.question?.trim() ||
      (body.questionId && CANNED_IDS.includes(body.questionId as (typeof CANNED_IDS)[number])
        ? CANNED_LABELS[body.questionId]
        : "");

    // Use Elastic Serverless Agent (Converse API) when MCP URL is the Elastic Agent Builder endpoint
    if (questionForConverse && isElasticAgentBuilderMCP()) {
      const { message, error } = await callElasticAgentConverse(questionForConverse);
      if (error) {
        return NextResponse.json({ ok: false, error }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        summary: message,
        source: "elastic_agent_converse",
      });
    }

    let toolCalls: MCPToolCall[] = [];
    let question = body.question ?? "";
    if (body.questionId && CANNED_IDS.includes(body.questionId as (typeof CANNED_IDS)[number])) {
      toolCalls = cannedQuestionToTools(body.questionId);
      question = CANNED_LABELS[body.questionId] ?? question;
    } else if (body.question?.trim()) {
      const matchedId = matchFreeformToCannedQuestion(body.question.trim());
      if (matchedId) {
        toolCalls = cannedQuestionToTools(matchedId);
        question = CANNED_LABELS[matchedId] ?? body.question.trim();
      }
    }

    if (toolCalls.length === 0 && Array.isArray(body.toolCalls) && body.toolCalls.length > 0) {
      toolCalls = body.toolCalls;
      question = body.question || "Custom tool invocation";
    }

    if (toolCalls.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: "No matching question. Try a canned question or ask something like: pump failures, sanitizer by site, status summary, or abnormal device.",
        toolResults: [],
      });
    }

    const toolResults = await invokeTools(toolCalls);
    const summary = await summarizeToolResults(question, toolResults);

    return NextResponse.json({
      ok: true,
      summary,
      toolResults: toolResults.map((r) => ({
        tool: r.tool,
        content: typeof r.content === "string" ? r.content.slice(0, 2000) : r.content,
        error: r.error,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
