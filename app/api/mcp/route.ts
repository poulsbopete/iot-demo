import { NextResponse } from "next/server";
import {
  invokeTools,
  cannedQuestionToTools,
  matchFreeformToCannedQuestion,
  callElasticAgentConverse,
  isElasticAgentBuilderMCP,
} from "@/lib/mcpClient";
import { getEcolabCases } from "@/lib/cases";
import { summarizeToolResults } from "@/lib/copilotSummarizer";
import type { MCPToolCall } from "@/lib/types";

/** True if the question is about failures, alerts, or cases (so we inject open cases context). */
function isFailureOrCaseQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /pump|failure|failures|failed|alert|alerts|case|cases|incident|outage|shutdown|error|issue/.test(q)
  );
}

/** Fetch open Ecolab cases and format as context for the agent. */
async function buildCasesContextForConverse(): Promise<string> {
  const { cases, error } = await getEcolabCases(20);
  if (error || !cases.length) return "";
  const lines = cases
    .filter((c) => c.status === "open" || c.status === "in-progress")
    .slice(0, 10)
    .map(
      (c) =>
        `- "${c.title}" (status: ${c.status}${c.totalAlerts ? `, ${c.totalAlerts} alert(s)` : ""}) — ${c.url}`
    );
  if (lines.length === 0) return "";
  return `Context: The user has the following open or in-progress Observability cases. Use them when answering; do not say there are no incidents if these cases exist.\n${lines.join("\n")}\n\nUser question: `;
}

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
 * - When OPENAI_API_KEY is set: use internal Elastic tools + OpenAI to summarize (no Converse, no timeout).
 * - Else when MCP points at Elastic Agent Builder: use Converse API (may timeout).
 * - Otherwise: canned question → internal tools → rule-based summary.
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

    // Prefer OpenAI + Elastic when OPENAI_API_KEY is set (avoids Converse timeouts)
    const useOpenAIElastic = Boolean(process.env.OPENAI_API_KEY);
    const useConverse =
      questionForConverse &&
      isElasticAgentBuilderMCP() &&
      !useOpenAIElastic;

    if (useConverse) {
      let input = questionForConverse;
      if (isFailureOrCaseQuestion(questionForConverse)) {
        const prefix = await buildCasesContextForConverse();
        if (prefix) input = prefix + questionForConverse;
      }
      const { message, error } = await callElasticAgentConverse(input);
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
        summary: "No matching question. Select one of the canned questions.",
        toolResults: [],
      });
    }

    const toolResults = await invokeTools(toolCalls);

    // Inject open Ecolab cases for failure-related questions so the summary includes them
    if (isFailureOrCaseQuestion(question)) {
      const { cases } = await getEcolabCases(20);
      const openCases = cases.filter((c) => c.status === "open" || c.status === "in-progress");
      if (openCases.length > 0) {
        toolResults.push({
          tool: "ecolab.open_cases",
          content: JSON.stringify(
            openCases.slice(0, 10).map((c) => ({
              title: c.title,
              status: c.status,
              totalAlerts: c.totalAlerts,
              url: c.url,
            })),
            null,
            2
          ),
        });
      }
    }

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
