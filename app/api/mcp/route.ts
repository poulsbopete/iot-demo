import { NextResponse } from "next/server";
import { invokeTools, cannedQuestionToTools } from "@/lib/mcpClient";
import { summarizeToolResults } from "@/lib/copilotSummarizer";
import type { MCPToolCall } from "@/lib/types";

const CANNED_IDS = [
  "overdosing",
  "pump_failures",
  "sanitizer_by_site",
  "abnormal_device",
  "status_summary",
] as const;

/**
 * POST body: { questionId?: string, question?: string, toolCalls?: MCPToolCall[] }
 * - If questionId is one of the canned IDs, run canned tools and summarize.
 * - If toolCalls is provided, run those and summarize.
 * - If question is freeform, we could map to tools or return "use canned questions" for demo.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      questionId?: string;
      question?: string;
      toolCalls?: MCPToolCall[];
    };

    let toolCalls: MCPToolCall[] = [];
    let question = body.question ?? "";

    if (body.questionId && CANNED_IDS.includes(body.questionId as (typeof CANNED_IDS)[number])) {
      toolCalls = cannedQuestionToTools(body.questionId);
      const labels: Record<string, string> = {
        overdosing: "Which site is overdosing chemicals in the last 30 minutes?",
        pump_failures: "Any pump failures today?",
        sanitizer_by_site: "Show sanitizer ppm by site last 15 minutes.",
        abnormal_device: "Which device is behaving abnormally?",
        status_summary: "Give me a plain-English status summary.",
      };
      question = labels[body.questionId] ?? question;
    } else if (Array.isArray(body.toolCalls) && body.toolCalls.length > 0) {
      toolCalls = body.toolCalls;
      question = body.question || "Custom tool invocation";
    }

    if (toolCalls.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: "Ask a canned question (questionId) or provide toolCalls. No tools were run.",
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
