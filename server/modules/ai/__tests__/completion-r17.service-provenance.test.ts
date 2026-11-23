/**
 * R17 (17b/17e): the service routes through the orchestrator with Claude
 * primary, returns truthful provenance, and never persists or 200s an empty
 * success. Both adapters are stubs; analytics returns a fixed fixture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Money } from "../../../core/money";
import { ProviderError } from "../ai.provider.types";

const spies = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  recordExchange: vi.fn(async (params: { onPersisted?: (tx: never, id: string) => Promise<void> }) => {
    // Like the store: the hook runs in the exchange write, then the id is persisted.
    await params.onPersisted?.(undefined as never, "conversation-1");
    return { conversationId: "conversation-1", persisted: true };
  }),
  history: [] as Array<{ role: "user" | "assistant"; content: string }>,
  onSpendingRead: null as null | (() => void),
  claude: {
    isAvailable: vi.fn(() => true),
    configurationIssue: vi.fn(() => null),
    configuredModel: vi.fn(() => "configured-claude-model"),
    analyzeQuery: vi.fn(),
    generateResponse: vi.fn(),
  },
  gemini: {
    isAvailable: vi.fn(() => true),
    configurationIssue: vi.fn(() => null),
    configuredModel: vi.fn(() => "configured-gemini-model"),
    analyzeQuery: vi.fn(),
    generateResponse: vi.fn(),
  },
}));

vi.mock("../../../utils/logger", () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { log: spies.auditLog, getIpAddress: vi.fn() } }));
vi.mock("../../../db", () => ({ db: { query: { households: { findFirst: vi.fn().mockResolvedValue({ currency: "ZMW" }) } } } }));
vi.mock("../ai.cache", () => ({
  aiCache: { isCacheable: vi.fn(() => false), generateKey: vi.fn(() => "key"), getAsync: vi.fn(async () => null), setAsync: vi.fn() },
}));
vi.mock("../ai.conversation.service", () => ({
  AIConversationService: class {
    recordExchange = spies.recordExchange;
    async get() {
      return { messages: spies.history };
    }
  },
}));
vi.mock("../ai.claude", () => ({ claudeClient: { id: "anthropic", ...spies.claude } }));
vi.mock("../ai.gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai.gemini")>()),
  geminiClient: { id: "gemini", ...spies.gemini },
}));
vi.mock("../ai.analytics.service", () => ({
  AIAnalyticsService: class {
    // Replayed turns are relabelled against the asker's visible accounts.
    async getAccountBalances() {
      return [];
    }
    async getSpendingByCategory() {
      spies.onSpendingRead?.();
      return [{ category: "Groceries", amount: Money.from("1234.50", "ZMW"), transactionCount: 7, percentOfTotal: 100 }];
    }
  },
}));

import { AIService } from "../ai.service";

const query = { userId: "user-1", householdId: "household-1", message: "How much did I spend on groceries?" };

function auditDetails(): Record<string, unknown> {
  expect(spies.auditLog).toHaveBeenCalledTimes(1);
  return spies.auditLog.mock.calls[0][0].details as Record<string, unknown>;
}

function spendingAnalysis(provider: "anthropic" | "gemini") {
  return { toolCalls: [{ name: "get_spending_by_category", args: { period: "30d" } }], tokenCount: 100, provider, model: `${provider}-recorded` };
}

describe("R17 service provenance", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "anthropic");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "gemini");
    spies.auditLog.mockClear();
    spies.recordExchange.mockClear();
    for (const adapter of [spies.claude, spies.gemini]) {
      adapter.analyzeQuery.mockReset();
      adapter.generateResponse.mockReset();
      adapter.isAvailable.mockReturnValue(true);
    }
    spies.history = [];
    spies.onSpendingRead = null;
  });

  it("Claude answer: answerMode claude, used_gemini false, Gemini never called", async () => {
    spies.claude.analyzeQuery.mockResolvedValue(spendingAnalysis("anthropic"));
    spies.claude.generateResponse.mockResolvedValue({ response: "You spent ZMW 1234.50 on Groceries.", tokenCount: 50 });

    const result = await new AIService().processQuery(query);

    expect(result).toMatchObject({ answerMode: "claude", providers: { analysis: "anthropic", answer: "anthropic" } });
    expect(spies.gemini.analyzeQuery).not.toHaveBeenCalled();
    // The tool result Claude explained came through the sanitiser as the fixture amount.
    expect(JSON.stringify(spies.claude.generateResponse.mock.calls[0][1])).toContain("1234.50");
    const details = auditDetails();
    expect(details).toMatchObject({ used_gemini: false, answer_mode: "claude", analysis_provider: "anthropic", data_sanitized: true });
    expect(details.paid_calls).toBe(2);
  });

  it("Claude analysis fails eligibly: Gemini answers and is labelled the backup", async () => {
    spies.claude.analyzeQuery.mockRejectedValue(
      new ProviderError({ provider: "anthropic", category: "overloaded", message: "x", dispatched: true }),
    );
    spies.gemini.analyzeQuery.mockResolvedValue(spendingAnalysis("gemini"));
    spies.gemini.generateResponse.mockResolvedValue({ response: "You spent ZMW 1234.50 on Groceries.", tokenCount: 50 });

    const result = await new AIService().processQuery(query);

    expect(result.answerMode).toBe("gemini");
    expect(spies.recordExchange).toHaveBeenCalledTimes(1);
    expect(auditDetails()).toMatchObject({ used_gemini: true, answer_mode: "gemini", provider_attempted: true });
  });

  it("no provider configured: local summary from the fixture, provider local, nothing transmitted", async () => {
    spies.claude.isAvailable.mockReturnValue(false);
    spies.gemini.isAvailable.mockReturnValue(false);

    const result = await new AIService().processQuery(query);

    expect(result.answerMode).toBe("local");
    expect(result.reply).toContain("Limited local summary");
    expect(result.reply).toContain("ZMW 1234.50");
    expect(auditDetails()).toMatchObject({ provider_attempted: false, answer_mode: "local", analysis_provider: "local" });
  });

  it("unavailable is never a persisted success: no exchange is written and the reply is non-empty", async () => {
    spies.claude.isAvailable.mockReturnValue(false);
    spies.gemini.isAvailable.mockReturnValue(false);

    const result = await new AIService().processQuery({ ...query, message: "Tell me a joke" });

    expect(result.answerMode).toBe("unavailable");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(result.toolsUsed).toEqual([]);
    expect(spies.recordExchange).not.toHaveBeenCalled();
    expect(auditDetails()).toMatchObject({ answer_mode: "unavailable" });
  });

  it("P1-1: identifying text in the message and history is redacted before either provider sees it, and audited", async () => {
    spies.history = [
      { role: "user", content: "I am 123456/78/9, reach me on 0971234567" },
      { role: "assistant", content: "Noted." },
    ];
    spies.claude.analyzeQuery.mockResolvedValue(spendingAnalysis("anthropic"));
    spies.claude.generateResponse.mockResolvedValue({ response: "You spent ZMW 1234.50 on Groceries.", tokenCount: 50 });
    const message = "My email is thandi.user@example.com — how much did I spend on groceries?";

    await new AIService().processQuery({ ...query, message, conversationId: "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b" });

    const [sentMessage, options] = spies.claude.analyzeQuery.mock.calls[0];
    expect(sentMessage).toContain("[email]");
    expect(sentMessage).not.toContain("thandi.user@example.com");
    const sentHistory = JSON.stringify(options.priorTurns);
    expect(sentHistory).toContain("[nrc]");
    expect(sentHistory).toContain("[phone]");
    expect(sentHistory).not.toMatch(/123456\/78\/9|0971234567/);
    expect(spies.claude.generateResponse.mock.calls[0][0]).not.toContain("thandi.user@example.com");
    expect(auditDetails()).toMatchObject({ outbound_redacted: true, outbound_redactions: { email: 1, nrc: 1, phone: 1 } });
  });

  it("P1-1: a message with nothing identifying is sent unchanged and audited as not redacted", async () => {
    spies.claude.analyzeQuery.mockResolvedValue(spendingAnalysis("anthropic"));
    spies.claude.generateResponse.mockResolvedValue({ response: "You spent ZMW 1234.50 on Groceries.", tokenCount: 50 });

    await new AIService().processQuery(query);

    expect(spies.claude.analyzeQuery.mock.calls[0][0]).toBe(query.message);
    expect(auditDetails()).toMatchObject({ outbound_redacted: false });
  });

  it("P2-2: the request's abort signal reaches the orchestrator; a disconnect mid-request starts no further call and persists nothing", async () => {
    const controller = new AbortController();
    spies.claude.analyzeQuery.mockResolvedValue(spendingAnalysis("anthropic"));
    spies.claude.generateResponse.mockResolvedValue({ response: "late", tokenCount: 50 });
    spies.onSpendingRead = () => controller.abort();

    const result = await new AIService().processQuery({ ...query, signal: controller.signal });

    expect(spies.claude.analyzeQuery.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(spies.claude.generateResponse).not.toHaveBeenCalled();
    expect(spies.gemini.generateResponse).not.toHaveBeenCalled();
    expect(result.answerMode).toBe("unavailable");
    expect(spies.recordExchange).not.toHaveBeenCalled();
    expect(auditDetails()).toMatchObject({ cancelled: true });
  });
});
