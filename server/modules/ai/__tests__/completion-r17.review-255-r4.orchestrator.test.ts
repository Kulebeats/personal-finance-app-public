/**
 * R17 #255 Astra round 4 (orchestrator): consent is rechecked once more after
 * the attempt claim commits and before the adapter call; a refusal there
 * settles the claimed attempt as never dispatched.
 */
import { describe, expect, it, vi } from "vitest";
import { ProviderOrchestrator, type ChatRunInput, type StageAttemptRecord } from "../ai.provider-orchestrator";
import type { AIProviderAdapter, AIProviderId, AnalysisResult, AnswerResult } from "../ai.provider.types";
import type { RequestTimingConfig } from "../ai.provider-config";

type AnalyzeFn = AIProviderAdapter["analyzeQuery"];
type AnswerFn = AIProviderAdapter["generateResponse"];

function fakeAdapter(id: AIProviderId) {
  const analyzeQuery = vi.fn<AnalyzeFn>(async (): Promise<AnalysisResult> => ({
    toolCalls: [{ name: "get_spending_by_category", args: { period: "30d" } }],
    tokenCount: 100,
    provider: id,
    model: `${id}-model`,
  }));
  const generateResponse = vi.fn<AnswerFn>(async (): Promise<AnswerResult> => ({
    response: `${id} explains.`,
    tokenCount: 200,
    provider: id,
    model: `${id}-model`,
  }));
  const adapter: AIProviderAdapter = {
    id,
    configuredModel: () => `${id}-model`,
    configurationIssue: () => null,
    isAvailable: () => true,
    analyzeQuery,
    generateResponse,
  };
  return { adapter, analyzeQuery, generateResponse };
}

const timing: RequestTimingConfig = { deadlineMs: 30_000, stageTimeoutMs: 12_000, fallbackReserveMs: 8_000, maxPaidCalls: 3 };
const SPENDING = { categories: [{ name: "Groceries", amount: "1234.50", count: 7 }], total: "1234.50", period: "30d" };

function setup(clock: { now: number }) {
  const claude = fakeAdapter("anthropic");
  const gemini = fakeAdapter("gemini");
  const orchestrator = new ProviderOrchestrator({
    adapters: { anthropic: claude.adapter, gemini: gemini.adapter },
    order: () => ({ primary: "anthropic", fallback: "gemini" }),
    timing: () => timing,
    now: () => clock.now,
  });
  const input = (overrides: Partial<ChatRunInput> = {}): ChatRunInput => ({
    message: "where did my money go?",
    priorTurns: [],
    tokenBudget: 2000,
    currency: "ZMW",
    executeTool: async () => ({ success: true, data: SPENDING, sanitized: true }),
    runLocal: async () => ({ reply: "local", useful: true, executedToolCalls: [], tokenCount: 0, dataSanitized: true }),
    renderLocal: () => "Limited local summary (no AI provider was used).",
    ...overrides,
  });
  return { orchestrator, claude, gemini, input };
}

describe("R17 #255 Astra r4 orchestrator", () => {
  it("P1 #3 consent rechecked after the claim: a refusal there stops the call before the adapter sees anything", async () => {
    const t = setup({ now: 0 });
    const settled: StageAttemptRecord[] = [];
    const refusal = new Error("Household AI consent changed.");
    const beforeDispatch = vi.fn(async () => {
      throw refusal;
    });

    const run = t.orchestrator.run(t.input({
      beforeAttempt: async () => ({ attemptId: "attempt-1" }),
      afterAttempt: async (record) => {
        settled.push(record);
      },
      beforeDispatch,
    }));

    await expect(run).rejects.toBe(refusal);
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(t.claude.analyzeQuery).not.toHaveBeenCalled();
    expect(t.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(settled).toEqual([expect.objectContaining({ attemptId: "attempt-1", dispatched: false, outcome: "failed" })]);
  });
});
