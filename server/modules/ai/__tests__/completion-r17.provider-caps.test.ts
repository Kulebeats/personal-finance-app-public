/**
 * R17 slice 2: a paid provider fails closed without an operator call cap
 * (coordinator rule until the OI-02 monetary caps land). No network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getProviderCallCap } from "../ai.provider-config";
import { withCallCapGate } from "../ai.provider-caps";
import { ProviderOrchestrator, type ChatRunInput } from "../ai.provider-orchestrator";
import { ProviderError, type AIProviderAdapter, type AIProviderId } from "../ai.provider.types";

function adapter(id: AIProviderId, configured = true): AIProviderAdapter {
  return {
    id,
    configuredModel: () => (configured ? `${id}-model` : null),
    configurationIssue: () => (configured ? null : "unconfigured"),
    isAvailable: () => configured,
    analyzeQuery: vi.fn(async () => ({ toolCalls: [{ name: "get_spending_by_category", args: {} }], tokenCount: 10 })),
    generateResponse: vi.fn(async () => ({ response: `${id} answer`, tokenCount: 10 })),
  };
}

function input(overrides: Partial<ChatRunInput> = {}): ChatRunInput {
  return {
    message: "where did my money go?",
    priorTurns: [],
    tokenBudget: 2000,
    currency: "ZMW",
    executeTool: async () => ({ success: true, sanitized: true, data: { total: "12.50" } }),
    runLocal: vi.fn(async () => ({ reply: "local", useful: true, executedToolCalls: [], tokenCount: 1, dataSanitized: true })),
    renderLocal: () => "local summary",
    ...overrides,
  };
}

const order = () => ({ primary: "anthropic" as const, fallback: "gemini" as const });

describe("provider call caps", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["", null],
    ["0", null],
    ["-3", null],
    ["2.5", null],
    ["lots", null],
    // Astra #255 r4: an out-of-range value must not parse to Infinity or an unsafe integer.
    ["99999999999999999999", null],
    ["9007199254740992", null],
    ["25", 25],
  ] as const)("AI_ANTHROPIC_DAILY_CALL_CAP=%j reads as %j", (raw, expected) => {
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", raw);
    expect(getProviderCallCap("anthropic")).toBe(expected);
  });

  it("a configured provider without a cap is unavailable and labelled unconfigured", () => {
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "");
    const gated = withCallCapGate(adapter("anthropic"));
    expect(gated.isAvailable()).toBe(false);
    expect(gated.configurationIssue()).toBe("unconfigured");

    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    expect(gated.isAvailable()).toBe(true);
    expect(gated.configurationIssue()).toBeNull();
  });

  it("with keys but no caps, nothing is dispatched and the local mode says no provider was used", async () => {
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "");
    vi.stubEnv("AI_GEMINI_DAILY_CALL_CAP", "");
    const claude = adapter("anthropic");
    const gemini = adapter("gemini");
    const run = input();
    const outcome = await new ProviderOrchestrator({
      adapters: { anthropic: withCallCapGate(claude), gemini: withCallCapGate(gemini) },
      order,
    }).run(run);

    expect(claude.analyzeQuery).not.toHaveBeenCalled();
    expect(gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(outcome.mode).toBe("local");
    expect(outcome.transmissionAttempted).toBe(false);
    expect(run.runLocal).toHaveBeenCalledWith({ providerAttempted: false });
  });

  it("with no keys and no caps at all, the local mode still answers", async () => {
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "");
    vi.stubEnv("AI_GEMINI_DAILY_CALL_CAP", "");
    const outcome = await new ProviderOrchestrator({
      adapters: { anthropic: withCallCapGate(adapter("anthropic", false)), gemini: withCallCapGate(adapter("gemini", false)) },
      order,
    }).run(input());
    expect(outcome).toMatchObject({ mode: "local", reply: "local" });
  });

  it("a claim refused because the cap is reached is final for paid work: no fallback bypass, local answer", async () => {
    const claude = adapter("anthropic");
    const gemini = adapter("gemini");
    const beforeAttempt = vi.fn(async () => {
      throw new ProviderError({ provider: "anthropic", category: "billing", message: "call cap reached", dispatched: false });
    });
    const run = input({ beforeAttempt });
    const outcome = await new ProviderOrchestrator({ adapters: { anthropic: claude, gemini }, order }).run(run);

    expect(claude.analyzeQuery).not.toHaveBeenCalled();
    expect(gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(beforeAttempt).toHaveBeenCalledOnce();
    expect(outcome.mode).toBe("local");
    expect(outcome.attempts[0]).toMatchObject({ provider: "anthropic", outcome: "skipped", category: "billing", dispatched: false });
    expect(run.runLocal).toHaveBeenCalledWith({ providerAttempted: false });
  });

  it("a claim refused as unconfigured moves on to the fallback", async () => {
    const claude = adapter("anthropic");
    const gemini = adapter("gemini");
    const beforeAttempt = vi.fn(async (claim: { provider: AIProviderId }) => {
      if (claim.provider === "anthropic") {
        throw new ProviderError({ provider: "anthropic", category: "unconfigured", message: "no cap", dispatched: false });
      }
    });
    const outcome = await new ProviderOrchestrator({ adapters: { anthropic: claude, gemini }, order }).run(input({ beforeAttempt }));
    expect(claude.analyzeQuery).not.toHaveBeenCalled();
    expect(outcome.mode).toBe("gemini");
  });
});
