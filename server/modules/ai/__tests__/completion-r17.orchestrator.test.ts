/**
 * R17.1 (17b): stage-aware orchestration matrix (B1 oracle). Fake adapters
 * stand in for both providers; tools and local mode are injected stubs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CANCELLED_REPLY,
  NO_DATA_REPLY,
  ProviderOrchestrator,
  REFUSAL_REPLY,
  type ChatRunInput,
} from "../ai.provider-orchestrator";
import {
  ProviderError,
  type AIProviderAdapter,
  type AIProviderId,
  type AnalysisResult,
  type AnswerResult,
  type ProviderFailureCategory,
} from "../ai.provider.types";
import type { RequestTimingConfig } from "../ai.provider-config";

type AnalyzeFn = AIProviderAdapter["analyzeQuery"];
type AnswerFn = AIProviderAdapter["generateResponse"];

function fakeAdapter(id: AIProviderId, configured = true) {
  const analyzeQuery = vi.fn<AnalyzeFn>(async (): Promise<AnalysisResult> => ({
    toolCalls: [{ name: "get_spending_by_category", args: { period: "30d" } }],
    tokenCount: 100,
    provider: id,
    model: `${id}-model`,
    usage: { known: true, inputTokens: 80, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null },
  }));
  const generateResponse = vi.fn<AnswerFn>(async (): Promise<AnswerResult> => ({
    response: `${id} explains: you spent ZMW 1234.50 on Groceries.`,
    tokenCount: 200,
    provider: id,
    model: `${id}-model`,
  }));
  const adapter: AIProviderAdapter = {
    id,
    configuredModel: () => (configured ? `${id}-model` : null),
    configurationIssue: () => (configured ? null : "unconfigured"),
    isAvailable: () => configured,
    analyzeQuery,
    generateResponse,
  };
  return { adapter, analyzeQuery, generateResponse };
}

function failure(provider: AIProviderId, category: ProviderFailureCategory): ProviderError {
  return new ProviderError({ provider, category, message: `synthetic ${category}`, dispatched: category !== "unconfigured" });
}

const timing: RequestTimingConfig = { deadlineMs: 30_000, stageTimeoutMs: 12_000, fallbackReserveMs: 8_000, maxPaidCalls: 3 };
const SPENDING = { categories: [{ name: "Groceries", amount: "1234.50", count: 7 }], total: "1234.50", period: "30d" };

function setup(options: { claude?: boolean; gemini?: boolean; now?: () => number } = {}) {
  const claude = fakeAdapter("anthropic", options.claude ?? true);
  const gemini = fakeAdapter("gemini", options.gemini ?? true);
  const beforeAttempt = vi.fn(async () => undefined);
  const orchestrator = new ProviderOrchestrator({
    adapters: { anthropic: claude.adapter, gemini: gemini.adapter },
    order: () => ({ primary: "anthropic", fallback: "gemini" }),
    timing: () => timing,
    now: options.now,
    beforeAttempt,
  });
  const executeTool = vi.fn<ChatRunInput["executeTool"]>(async () => ({ success: true, data: SPENDING, sanitized: true }));
  const runLocal = vi.fn<ChatRunInput["runLocal"]>(async () => ({
    reply: "Limited local summary (no AI provider was used): Groceries ZMW 1234.50",
    useful: true,
    executedToolCalls: [{ name: "get_spending_by_category", args: {} }],
    tokenCount: 20,
    dataSanitized: true,
  }));
  const renderLocal = vi.fn<ChatRunInput["renderLocal"]>(() => "Limited local summary (no AI provider was used): Groceries ZMW 1234.50");
  const input = (overrides: Partial<ChatRunInput> = {}): ChatRunInput => ({
    message: "where did my money go?",
    priorTurns: [],
    tokenBudget: 2000,
    currency: "ZMW",
    executeTool,
    runLocal,
    renderLocal,
    ...overrides,
  });
  return { orchestrator, claude, gemini, executeTool, runLocal, renderLocal, beforeAttempt, input };
}

describe("R17 provider orchestrator", () => {
  it("Claude healthy: both stages on Claude, zero Gemini calls", async () => {
    const t = setup();
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "claude", analysisProvider: "anthropic", answerProvider: "anthropic", transmissionAttempted: true });
    expect(outcome.reply).toContain("anthropic explains");
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(t.gemini.generateResponse).not.toHaveBeenCalled();
    expect(outcome.attempts.map((a) => [a.stage, a.provider, a.outcome])).toEqual([
      ["analysis", "anthropic", "succeeded"],
      ["answer", "anthropic", "succeeded"],
    ]);
    expect(t.beforeAttempt).toHaveBeenCalledTimes(2);
  });

  it("eligible Claude analysis failure: exactly one Gemini analysis and one Gemini answer, Claude not retried", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValueOnce(failure("anthropic", "overloaded"));
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "gemini", analysisProvider: "gemini", answerProvider: "gemini" });
    expect(t.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(t.claude.generateResponse).not.toHaveBeenCalled();
    expect(t.gemini.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(t.gemini.generateResponse).toHaveBeenCalledTimes(1);
    expect(outcome.attempts.filter((a) => a.dispatched)).toHaveLength(3);
    expect(outcome.attempts[0]).toMatchObject({ provider: "anthropic", outcome: "failed", category: "overloaded" });
  });

  it("Claude answer-stage failure: Gemini explains the same sanitised results without re-running tools", async () => {
    const t = setup();
    t.claude.generateResponse.mockRejectedValueOnce(failure("anthropic", "timeout"));
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "gemini", analysisProvider: "anthropic", answerProvider: "gemini" });
    expect(t.executeTool).toHaveBeenCalledTimes(1);
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(t.gemini.generateResponse.mock.calls[0][1]).toEqual([{ name: "get_spending_by_category", result: SPENDING }]);
  });

  it("both fail at analysis: the labelled local mode answers; nothing useful → unavailable", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValue(failure("anthropic", "connection"));
    t.gemini.analyzeQuery.mockRejectedValue(failure("gemini", "rate_limited"));
    const local = await t.orchestrator.run(t.input());
    expect(local).toMatchObject({ mode: "local", analysisProvider: "local", answerProvider: "local", failureCategory: "rate_limited" });

    t.runLocal.mockResolvedValueOnce({ reply: "limited mode help", useful: false, executedToolCalls: [], tokenCount: 5, dataSanitized: true });
    const none = await t.orchestrator.run(t.input());
    expect(none).toMatchObject({ mode: "unavailable", analysisProvider: null, answerProvider: null });
  });

  it("both fail at answer: local template from the already-sanitised results, or unavailable", async () => {
    const t = setup();
    t.claude.generateResponse.mockRejectedValue(failure("anthropic", "server_error"));
    t.gemini.generateResponse.mockRejectedValue(failure("gemini", "server_error"));
    const local = await t.orchestrator.run(t.input());
    expect(local).toMatchObject({ mode: "local", analysisProvider: "anthropic", answerProvider: "local" });
    expect(t.renderLocal).toHaveBeenCalledWith([SPENDING], { providerAttempted: true });

    t.renderLocal.mockReturnValueOnce(null);
    const none = await t.orchestrator.run(t.input());
    expect(none).toMatchObject({ mode: "unavailable", reply: NO_DATA_REPLY });
  });

  it("billing failure is not failed over to Gemini (cap bypass), but the free local mode may answer", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValueOnce(failure("anthropic", "billing"));
    const outcome = await t.orchestrator.run(t.input());
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ mode: "local", failureCategory: "billing" });
  });

  it("a safety refusal is final: no other provider and no local answer", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValueOnce(failure("anthropic", "safety_refusal"));
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "unavailable", reply: REFUSAL_REPLY });
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(t.runLocal).not.toHaveBeenCalled();
  });

  it("application errors propagate unchanged and never trigger failover", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(t.orchestrator.run(t.input())).rejects.toThrow("DB connection lost");
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();

    t.executeTool.mockRejectedValueOnce(new Error("FX rate missing"));
    await expect(t.orchestrator.run(t.input())).rejects.toThrow("FX rate missing");
    expect(t.gemini.generateResponse).not.toHaveBeenCalled();
  });

  it("no provider configured: no call, no transmission, local mode with provider local", async () => {
    const t = setup({ claude: false, gemini: false });
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "local", transmissionAttempted: false, analysisProvider: "local" });
    expect(outcome.attempts.map((a) => [a.provider, a.outcome, a.category])).toEqual([
      ["anthropic", "skipped", "unconfigured"],
      ["gemini", "skipped", "unconfigured"],
    ]);
    expect(t.beforeAttempt).not.toHaveBeenCalled();
  });

  it("derives per-call timeouts from the deadline and reserves the fallback window", async () => {
    let clock = 0;
    const t = setup({ now: () => clock });
    await t.orchestrator.run(t.input());
    expect(t.claude.analyzeQuery.mock.calls[0][1]?.timeoutMs).toBe(12_000);

    clock = 0;
    t.claude.analyzeQuery.mockImplementationOnce(async () => {
      clock = 25_000; // Claude took most of the deadline, then failed.
      throw failure("anthropic", "timeout");
    });
    await t.orchestrator.run(t.input());
    // 5 s left, Gemini is last in the chain: it gets the whole remainder.
    expect(t.gemini.analyzeQuery.mock.calls[0][1]?.timeoutMs).toBe(5_000);
  });

  it("stops calling providers once the deadline is spent", async () => {
    let clock = 0;
    const t = setup({ now: () => clock });
    t.claude.analyzeQuery.mockImplementationOnce(async () => {
      clock = 29_500;
      throw failure("anthropic", "timeout");
    });
    const outcome = await t.orchestrator.run(t.input());
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(outcome.mode).toBe("local");
  });

  it("cancellation: a late result is ignored, no further provider is started, nothing is answered", async () => {
    const t = setup();
    const controller = new AbortController();
    t.claude.analyzeQuery.mockImplementationOnce(async () => {
      controller.abort();
      return { toolCalls: [], textResponse: "late answer", tokenCount: 10 };
    });
    const outcome = await t.orchestrator.run(t.input({ signal: controller.signal }));
    expect(outcome).toMatchObject({ mode: "unavailable", reply: CANCELLED_REPLY, cancelled: true });
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(t.runLocal).not.toHaveBeenCalled();
  });

  it("a consent/admission recheck failure before an attempt stops the request with no dispatch", async () => {
    const t = setup();
    t.beforeAttempt.mockRejectedValueOnce(new Error("consent revoked"));
    await expect(t.orchestrator.run(t.input())).rejects.toThrow("consent revoked");
    expect(t.claude.analyzeQuery).not.toHaveBeenCalled();
  });

  it("only disallowed tool proposals produce no answer, not an invented one", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockResolvedValueOnce({ toolCalls: [{ name: "drop_table", args: {} }], textResponse: "done", tokenCount: 10 });
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome).toMatchObject({ mode: "unavailable", blockedTools: ["drop_table"] });
    expect(t.executeTool).not.toHaveBeenCalled();
  });

  it("never exceeds three paid calls", async () => {
    const t = setup();
    t.claude.analyzeQuery.mockRejectedValueOnce(failure("anthropic", "overloaded"));
    t.gemini.generateResponse.mockRejectedValueOnce(failure("gemini", "overloaded"));
    const outcome = await t.orchestrator.run(t.input());
    expect(outcome.attempts.filter((a) => a.dispatched).length).toBeLessThanOrEqual(3);
    expect(outcome.mode).toBe("local");
  });
});
