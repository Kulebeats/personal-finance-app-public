/**
 * R17 17f: deterministic evaluation set. Each case in eval/r17-eval.cases.ts
 * replays recorded provider responses through the REAL Claude and Gemini
 * adapters (only the SDK classes are replaced) and the real AIService and
 * orchestrator. No network, no key: the keys below are inert test strings and
 * the network guard in server/testing blocks any socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeStep, GeminiStep } from "./eval/r17-eval.recordings";
import { EVAL_CASES, type EvalCase, type EvalCategory } from "./eval/r17-eval.cases";

const rec = vi.hoisted(() => ({
  claude: [] as unknown[],
  geminiAnalysis: [] as unknown[],
  geminiAnswer: [] as unknown[],
  claudeBodies: [] as Array<Record<string, unknown>>,
  geminiOutbound: [] as unknown[],
  geminiAnswerPrompts: [] as unknown[],
  toolReads: [] as string[],
  onRead: null as null | ((tool: string) => void),
  history: [] as Array<{ role: "user" | "assistant"; content: string }>,
  auditLog: vi.fn().mockResolvedValue(undefined),
  recordExchange: vi.fn().mockResolvedValue("conversation-eval"),
}));

/** Pop the next recorded outcome: a value to resolve, or an Error to throw. */
async function next(queue: unknown[], label: string): Promise<unknown> {
  if (queue.length === 0) throw new Error(`eval: no recorded ${label} response left`);
  const item = queue.shift();
  if (item instanceof Error) throw item;
  return item;
}

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    messages = {
      create: async (body: Record<string, unknown>) => {
        rec.claudeBodies.push(body);
        return next(rec.claude, "Claude");
      },
    };
  }
  return { ...actual, default: FakeAnthropic };
});

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  class FakeGoogleGenerativeAI {
    getGenerativeModel() {
      return {
        startChat: (params: unknown) => ({
          sendMessage: async (message: string) => {
            rec.geminiOutbound.push({ params, message });
            return next(rec.geminiAnalysis, "Gemini analysis");
          },
        }),
        generateContent: async (request: unknown) => {
          rec.geminiOutbound.push(request);
          rec.geminiAnswerPrompts.push(request);
          return next(rec.geminiAnswer, "Gemini answer");
        },
      };
    }
  }
  return { ...actual, GoogleGenerativeAI: FakeGoogleGenerativeAI };
});

vi.mock("../../../utils/logger", () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { log: rec.auditLog, getIpAddress: vi.fn() } }));
vi.mock("../../../db", () => ({ db: { query: { households: { findFirst: vi.fn().mockResolvedValue({ currency: "ZMW" }) } } } }));
vi.mock("../ai.cache", () => ({
  aiCache: { isCacheable: vi.fn(() => false), generateKey: vi.fn(() => "key"), getAsync: vi.fn(async () => null), setAsync: vi.fn() },
}));
vi.mock("../ai.conversation.service", () => ({
  AIConversationService: class {
    recordExchange = rec.recordExchange;
    async get() {
      return { messages: rec.history };
    }
  },
}));
vi.mock("../ai.analytics.service", async () => {
  const { Money: M } = await import("../../../core/money");
  const { HOUSEHOLD: H, CURRENCY: C } = await import("./eval/r17-eval.recordings");
  const money = (value: string) => M.from(value, C);
  const read = <T>(tool: string, value: T): T => {
    rec.toolReads.push(tool);
    rec.onRead?.(tool);
    return value;
  };
  return {
    AIAnalyticsService: class {
      async getSpendingByCategory() {
        return read("get_spending_by_category", H.spending.map((row) => ({ ...row, amount: money(row.amount) })));
      }
      async getBudgetStatus() {
        return read("get_budget_status", H.budgets.map((row) => ({
          ...row, budgeted: money(row.budgeted), spent: money(row.spent), remaining: money(row.remaining),
        })));
      }
      async getAccountBalances() {
        return read("get_account_balances", H.accounts.map((row) => ({ ...row, balance: money(row.balance) })));
      }
      async getMerchantSpending() {
        return read("get_merchant_spending", H.merchants.map((row) => ({
          ...row, totalSpent: money(row.totalSpent), avgTransactionAmount: money(row.avgTransactionAmount),
        })));
      }
      async getUpcomingRecurring() {
        return read("get_upcoming_recurring", H.recurring.map((row) => ({ ...row, amount: money(row.amount) })));
      }
      async getMonthlySummary() {
        const s = H.monthlySummary;
        return read("get_monthly_summary", { ...s, income: money(s.income), expenses: money(s.expenses), netSavings: money(s.netSavings) });
      }
      async getGoalAssignments() {
        return read("get_goal_assignments", H.goalAssignments.map((row) => ({ ...row, target: money(row.target), current: money(row.current) })));
      }
      async getCashFlow() {
        read("get_cash_flow", null);
        throw new Error("eval: cash flow read failed");
      }
      async getRecentTransactions() {
        return read("get_recent_transactions", []);
      }
    },
  };
});

import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { GoogleGenerativeAIFetchError, GoogleGenerativeAIResponseError } from "@google/generative-ai";
import { AIService } from "../ai.service";

function claudeOutcome(step: ClaudeStep): unknown {
  const message = (content: unknown[], stopReason = "end_turn") => ({
    id: "msg_eval", type: "message", role: "assistant", model: "eval-claude-model", stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content, _request_id: "req_eval",
  });
  switch (step.kind) {
    case "tool_use":
      return message(
        [
          ...(step.text ? [{ type: "text", text: step.text }] : []),
          ...step.tools.map((tool, index) => ({ type: "tool_use", id: `toolu_${index}`, name: tool.name, input: tool.input })),
        ],
        "tool_use",
      );
    case "text":
      return message([{ type: "text", text: step.text }]);
    case "refusal":
      return message([], "refusal");
    case "api_error":
      return APIError.generate(step.status, { type: "error", error: { type: step.type, message: "eval" } }, "eval", new Headers());
    case "connection_error":
      return new APIConnectionError({ message: "eval connection reset" });
  }
}

function geminiOutcome(step: GeminiStep): unknown {
  const usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 20 };
  const unreadable = () => {
    throw new GoogleGenerativeAIResponseError("Text not available. Response was blocked");
  };
  switch (step.kind) {
    case "function_call":
      return { response: { candidates: [{ finishReason: "STOP", content: { parts: step.tools.map((t) => ({ functionCall: t })) } }], usageMetadata, text: () => "" } };
    case "text":
      return { response: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: step.text }] } }], usageMetadata, text: () => step.text } };
    case "prompt_blocked":
      return { response: { promptFeedback: { blockReason: step.reason }, candidates: [], usageMetadata, text: unreadable } };
    case "finish":
      return { response: { candidates: [{ finishReason: step.reason, content: { parts: [] } }], usageMetadata, text: unreadable } };
    case "fetch_error":
      return new GoogleGenerativeAIFetchError("eval", step.status);
  }
}

function arrange(evalCase: EvalCase, controller: AbortController): void {
  const claudeOn = evalCase.configured?.claude ?? true;
  const geminiOn = evalCase.configured?.gemini ?? true;
  vi.stubEnv("ANTHROPIC_API_KEY", claudeOn ? "eval-inert-not-a-key" : "");
  vi.stubEnv("ANTHROPIC_MODEL", claudeOn ? "eval-claude-model" : "");
  vi.stubEnv("GEMINI_API_KEY", geminiOn ? "eval-inert-not-a-key" : "");
  vi.stubEnv("GEMINI_MODEL", geminiOn ? "eval-gemini-model" : "");
  rec.claude.push(...(evalCase.claude ?? []).map(claudeOutcome));
  rec.geminiAnalysis.push(...(evalCase.gemini?.analysis ?? []).map(geminiOutcome));
  rec.geminiAnswer.push(...(evalCase.gemini?.answer ?? []).map(geminiOutcome));
  rec.history = evalCase.history ?? [];
  rec.onRead = evalCase.abortDuringTool
    ? (tool) => {
        if (tool === evalCase.abortDuringTool) controller.abort();
      }
    : null;
}

/** Answer-stage prompts: Claude calls without tools, and Gemini generateContent. */
function answerPrompts(): string {
  return JSON.stringify([...rec.claudeBodies.filter((body) => body.tools === undefined), ...rec.geminiAnswerPrompts]);
}

describe("R17 evaluation set (recorded responses, both adapters, no network)", () => {
  beforeEach(() => {
    for (const queue of [rec.claude, rec.geminiAnalysis, rec.geminiAnswer, rec.claudeBodies, rec.geminiOutbound, rec.geminiAnswerPrompts, rec.toolReads]) {
      queue.length = 0;
    }
    rec.auditLog.mockClear();
    rec.recordExchange.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("has 20-30 cases covering every required category, with unique ids", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(30);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    const required: EvalCategory[] = ["tools_and_amounts", "privacy", "refusal", "missing_data", "provider_failure", "cancellation"];
    for (const category of required) expect(EVAL_CASES.some((c) => c.category === category)).toBe(true);
    expect(EVAL_CASES.some((c) => c.expect.mode === "claude")).toBe(true);
    expect(EVAL_CASES.some((c) => c.expect.mode === "gemini")).toBe(true);
  });

  it.each(EVAL_CASES.map((c) => [c.id, c] as const))("%s", async (_id, evalCase) => {
    const controller = new AbortController();
    arrange(evalCase, controller);
    const want = evalCase.expect;

    const result = await new AIService().processQuery({
      userId: "user-eval",
      householdId: "household-eval",
      actor: { householdId: "household-eval", userId: "user-eval", role: "owner" },
      message: evalCase.message,
      conversationId: evalCase.history ? "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b" : undefined,
      signal: controller.signal,
    });

    expect(result.answerMode).toBe(want.mode);
    expect(result.reply.trim().length).toBeGreaterThan(0);
    if (want.analysisProvider !== undefined) expect(result.providers.analysis).toBe(want.analysisProvider);
    if (want.answerProvider !== undefined) expect(result.providers.answer).toBe(want.answerProvider);
    if (want.toolReads) expect(rec.toolReads).toEqual(want.toolReads);
    for (const text of want.replyIncludes ?? []) expect(result.reply).toContain(text);
    for (const text of want.replyExcludes ?? []) expect(result.reply).not.toContain(text);
    for (const text of want.answerPromptIncludes ?? []) expect(answerPrompts()).toContain(text);
    const outbound = JSON.stringify([rec.claudeBodies, rec.geminiOutbound]);
    for (const text of want.outboundExcludes ?? []) expect(outbound).not.toContain(text);
    for (const text of want.outboundIncludes ?? []) expect(outbound).toContain(text);
    if (want.claudeCalls !== undefined) expect(rec.claudeBodies).toHaveLength(want.claudeCalls);
    if (want.geminiCalls !== undefined) expect(rec.geminiOutbound).toHaveLength(want.geminiCalls);
    if (want.persisted !== undefined) expect(rec.recordExchange).toHaveBeenCalledTimes(want.persisted ? 1 : 0);
    // Every recorded response a case declares must have been used: no dead fixtures.
    expect([rec.claude.length, rec.geminiAnalysis.length, rec.geminiAnswer.length]).toEqual(
      evalCase.abortDuringTool ? [rec.claude.length, 0, 0] : [0, 0, 0],
    );
    // Rule 4.2: every query is audited exactly once.
    expect(rec.auditLog).toHaveBeenCalledTimes(1);
  });
});
