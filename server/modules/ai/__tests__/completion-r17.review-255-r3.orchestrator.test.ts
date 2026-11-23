/**
 * R17 #255 Astra round 3 (orchestrator): the three-paid-call limit counts the
 * logical request's earlier attempts, and a claim that waited on its locks
 * dispatches only inside what is left of the request deadline.
 */
import { describe, expect, it, vi } from "vitest";
import { ProviderOrchestrator, type AttemptClaim, type ChatRunInput, type StageAttemptRecord } from "../ai.provider-orchestrator";
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

describe("R17 #255 Astra r3 orchestrator", () => {
  it("P2(b) a retry that already made two paid calls makes at most one more", async () => {
    const t = setup({ now: 0 });

    const outcome = await t.orchestrator.run(t.input({ priorPaidCalls: 2 }));

    expect(t.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(t.claude.generateResponse).not.toHaveBeenCalled();
    expect(t.gemini.generateResponse).not.toHaveBeenCalled();
    expect(outcome.attempts.filter((attempt) => attempt.dispatched)).toHaveLength(1);
    expect(outcome.mode).toBe("local");
  });

  it("P2(c) a claim that waited past the primary's window never dispatches it, and the fallback gets only the remainder", async () => {
    const clock = { now: 0 };
    const t = setup(clock);
    const claims: AttemptClaim[] = [];
    const settled: StageAttemptRecord[] = [];
    let ticket = 0;
    const beforeAttempt = vi.fn(async (claim: AttemptClaim) => {
      claims.push(claim);
      // The first claim waits 25 s on its locks; 5 s of the 30 s deadline remain.
      if (claims.length === 1) clock.now += 25_000;
      ticket += 1;
      return { attemptId: `attempt-${ticket}` };
    });
    const afterAttempt = vi.fn(async (record: StageAttemptRecord) => {
      settled.push(record);
    });

    await t.orchestrator.run(t.input({ beforeAttempt, afterAttempt }));

    expect(claims[0]).toMatchObject({ provider: "anthropic", requestDeadlineAt: 30_000 });
    expect(t.claude.analyzeQuery).not.toHaveBeenCalled();
    expect(settled[0]).toMatchObject({ provider: "anthropic", attemptId: "attempt-1", dispatched: false, category: "timeout" });
    expect(t.gemini.analyzeQuery).toHaveBeenCalledTimes(1);
    const options = t.gemini.analyzeQuery.mock.calls[0][1];
    expect(options?.timeoutMs).toBeLessThanOrEqual(5_000);
  });
});
