/**
 * R17 review fixes for #246 (Astra pre-merge review @5d4a5ea10).
 *
 * P1-1 outbound redaction of identifying text in the message and history.
 * P1-2 a Gemini safety block is a final safety refusal, never a local answer.
 * P2-1 a primary with no usable window does not starve a viable fallback.
 * P2-3 local-mode copy follows the recorded attempts.
 * (P2-2 cancellation is covered in completion-r17.service-provenance.)
 * No network: the Gemini SDK class is replaced and Claude is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  analysis: null as null | Record<string, unknown>,
  answer: null as null | Record<string, unknown>,
}));

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  const wrap = (body: Record<string, unknown>) => ({
    response: {
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0 },
      text: () => {
        throw new actual.GoogleGenerativeAIResponseError("Text not available. Response was blocked due to SAFETY");
      },
      ...body,
    },
  });
  class FakeGoogleGenerativeAI {
    getGenerativeModel() {
      return {
        startChat: () => ({ sendMessage: async () => wrap(sdk.analysis ?? {}) }),
        generateContent: async () => wrap(sdk.answer ?? {}),
      };
    }
  }
  return { ...actual, GoogleGenerativeAI: FakeGoogleGenerativeAI };
});

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GeminiClient } from "../ai.gemini";
import { redactOutbound, redactOutboundText } from "../ai.outbound-redaction";
import { ProviderOrchestrator, REFUSAL_REPLY, type ChatRunInput } from "../ai.provider-orchestrator";
import { localSummaryPrefix, renderLocalSummary } from "../ai.local-templates";
import { ProviderError, type AIProviderAdapter, type AIProviderId } from "../ai.provider.types";

describe("P1-1 outbound redaction", () => {
  it.each([
    ["email", "Email me at thandi.user+bank@example.co.zm please", "[email]"],
    ["nrc", "My NRC is 123456/78/9", "[nrc]"],
    ["phone", "Call +260 97 123 4567 or 0971234567", "[phone]"],
    ["id", "Transaction 3f2b8c1e-9a4d-4e2b-8f1a-0c9d8e7f6a5b looks wrong", "[id]"],
    ["card", "Card 4111 1111 1111 1111 was charged", "[card]"],
  ] as const)("redacts a %s", (kind, text, placeholder) => {
    const result = redactOutboundText(text);
    expect(result.text).toContain(placeholder);
    expect(result.counts[kind]).toBeGreaterThan(0);
  });

  it("removes every phone number in the text, not just the first", () => {
    const { text, counts } = redactOutboundText("Call +260 97 123 4567 or 0971234567");
    expect(text).not.toMatch(/\d{4}/);
    expect(counts.phone).toBe(2);
  });

  it("keeps ordinary amounts, dates and periods intact", () => {
    const text = "Did I spend more than ZMW 1,234.50 or K5000 between 2026-11-01 and 17/11/2026, over 30 days?";
    const result = redactOutboundText(text);
    expect(result.text).toBe(text);
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true);
  });

  it("redacts the current message and every prior turn, and totals the counts", () => {
    const result = redactOutbound("my email is a@b.co", [
      { role: "user", text: "NRC 123456/78/9" },
      { role: "model", text: "Thanks." },
    ]);
    expect(result.message).toBe("my email is [email]");
    expect(result.priorTurns).toEqual([
      { role: "user", text: "NRC [nrc]" },
      { role: "model", text: "Thanks." },
    ]);
    expect(result.counts).toMatchObject({ email: 1, nrc: 1 });
    expect(result.redacted).toBe(true);
  });
});

describe("P1-2 Gemini safety blocks are final refusals", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-not-a-key");
    vi.stubEnv("GEMINI_MODEL", "configured-gemini-model");
    sdk.analysis = null;
    sdk.answer = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a blocked prompt (promptFeedback.blockReason) is safety_refusal, not malformed output", async () => {
    sdk.analysis = { promptFeedback: { blockReason: "SAFETY" }, candidates: [] };
    await expect(new GeminiClient().analyzeQuery("blocked question")).rejects.toMatchObject({
      category: "safety_refusal",
      dispatched: true,
    });
  });

  it.each(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION", "SPII"])(
    "an analysis candidate finished by %s is safety_refusal",
    async (finishReason) => {
      sdk.analysis = { candidates: [{ finishReason, content: { parts: [] } }] };
      await expect(new GeminiClient().analyzeQuery("q")).rejects.toMatchObject({ category: "safety_refusal" });
    },
  );

  it("an answer-stage safety block is safety_refusal too", async () => {
    sdk.answer = { candidates: [{ finishReason: "SAFETY" }] };
    await expect(new GeminiClient().generateResponse("q", [], "ZMW")).rejects.toMatchObject({ category: "safety_refusal" });
  });

  it("an ordinary empty STOP response stays malformed output", async () => {
    sdk.analysis = { candidates: [{ finishReason: "STOP", content: { parts: [] } }] };
    await expect(new GeminiClient().analyzeQuery("q")).rejects.toMatchObject({ category: "malformed_output" });
  });
});

function stubAdapter(id: AIProviderId) {
  const adapter: AIProviderAdapter = {
    id,
    configuredModel: () => `${id}-model`,
    configurationIssue: () => null,
    isAvailable: () => true,
    analyzeQuery: vi.fn(async () => ({ toolCalls: [{ name: "get_spending_by_category", args: {} }], tokenCount: 10 })),
    generateResponse: vi.fn(async () => ({ response: `${id} answer`, tokenCount: 10 })),
  };
  return adapter;
}

function runInput(overrides: Partial<ChatRunInput> = {}): ChatRunInput {
  return {
    message: "where did my money go?",
    priorTurns: [],
    tokenBudget: 2000,
    currency: "ZMW",
    executeTool: async () => ({ success: true, sanitized: true, data: { categories: [{ name: "Groceries", amount: "12.50" }] } }),
    runLocal: async () => ({ reply: "local", useful: true, executedToolCalls: [], tokenCount: 1, dataSanitized: true }),
    renderLocal: () => "local summary",
    ...overrides,
  };
}

describe("P1-2 orchestrator: an answer-stage refusal is not explained locally", () => {
  it("returns the refusal reply and no local summary", async () => {
    const claude = stubAdapter("anthropic");
    vi.mocked(claude.generateResponse).mockRejectedValue(
      new ProviderError({ provider: "anthropic", category: "safety_refusal", message: "refused", dispatched: true }),
    );
    const renderLocal = vi.fn(() => "local summary");
    const outcome = await new ProviderOrchestrator({
      adapters: { anthropic: claude, gemini: stubAdapter("gemini") },
      order: () => ({ primary: "anthropic", fallback: "gemini" }),
    }).run(runInput({ renderLocal }));
    expect(outcome).toMatchObject({ mode: "unavailable", reply: REFUSAL_REPLY, failureCategory: "safety_refusal" });
    expect(renderLocal).not.toHaveBeenCalled();
  });
});

describe("P2-1 the fallback reserve never starves a viable fallback", () => {
  it("skips a primary with no usable window and gives the fallback the whole remainder", async () => {
    let clock = 0;
    const claude = stubAdapter("anthropic");
    const gemini = stubAdapter("gemini");
    const orchestrator = new ProviderOrchestrator({
      adapters: { anthropic: claude, gemini },
      order: () => ({ primary: "anthropic", fallback: "gemini" }),
      timing: () => ({ deadlineMs: 30_000, stageTimeoutMs: 12_000, fallbackReserveMs: 8_000, maxPaidCalls: 3 }),
      now: () => clock,
    });
    // Analysis + a slow tool leave 7 s: below Claude's reserved window.
    vi.mocked(claude.analyzeQuery).mockImplementation(async () => ({ toolCalls: [{ name: "get_spending_by_category", args: {} }], tokenCount: 10 }));
    const outcome = await orchestrator.run(
      runInput({
        executeTool: async () => {
          clock = 23_000;
          return { success: true, sanitized: true, data: { categories: [{ name: "Groceries", amount: "12.50" }] } };
        },
      }),
    );
    expect(claude.generateResponse).not.toHaveBeenCalled();
    expect(gemini.generateResponse).toHaveBeenCalledOnce();
    expect(vi.mocked(gemini.generateResponse).mock.calls[0][3]?.timeoutMs).toBe(7_000);
    expect(outcome.mode).toBe("gemini");
    expect(outcome.attempts.map((a) => [a.stage, a.provider, a.outcome])).toEqual([
      ["analysis", "anthropic", "succeeded"],
      ["answer", "anthropic", "skipped"],
      ["answer", "gemini", "succeeded"],
    ]);
  });
});

describe("P2-3 local-mode copy follows the recorded attempts", () => {
  const data = [{ categories: [{ name: "Groceries", amount: "12.50", count: 1 }], total: "12.50" }];

  it("says no provider was used only when nothing was sent", () => {
    expect(localSummaryPrefix(false)).toMatch(/no AI provider was used/);
    expect(renderLocalSummary(data, "ZMW", false)).toMatch(/^Limited local summary \(no AI provider was used\)/);
  });

  it("after an external attempt, says the answer was prepared locally without denying the attempt", () => {
    const rendered = renderLocalSummary(data, "ZMW", true);
    expect(rendered).toMatch(/^Limited local summary/);
    expect(rendered).not.toMatch(/no AI provider was used/);
    expect(rendered).toMatch(/prepared locally/i);
  });

  it("the orchestrator tells the local renderer whether a provider call was dispatched", async () => {
    const claude = stubAdapter("anthropic");
    const gemini = stubAdapter("gemini");
    for (const adapter of [claude, gemini]) {
      vi.mocked(adapter.generateResponse).mockRejectedValue(
        new ProviderError({ provider: adapter.id, category: "overloaded", message: "x", dispatched: true }),
      );
    }
    const renderLocal = vi.fn<ChatRunInput["renderLocal"]>(() => "local summary");
    await new ProviderOrchestrator({
      adapters: { anthropic: claude, gemini },
      order: () => ({ primary: "anthropic", fallback: "gemini" }),
    }).run(runInput({ renderLocal }));
    expect(renderLocal).toHaveBeenCalledWith(expect.any(Array), { providerAttempted: true });

    const runLocal = vi.fn<ChatRunInput["runLocal"]>(async () => ({ reply: "l", useful: true, executedToolCalls: [], tokenCount: 1, dataSanitized: true }));
    const unconfigured = { ...stubAdapter("anthropic"), isAvailable: () => false, configurationIssue: () => "unconfigured" as const };
    await new ProviderOrchestrator({
      adapters: { anthropic: unconfigured, gemini: { ...unconfigured, id: "gemini" } },
      order: () => ({ primary: "anthropic", fallback: "gemini" }),
    }).run(runInput({ runLocal }));
    expect(runLocal).toHaveBeenCalledWith({ providerAttempted: false });
  });
});

describe("P2-2 a client disconnect aborts the request", () => {
  it("aborts when the response closes before it was finished, and not after a normal finish", async () => {
    const { EventEmitter } = await import("node:events");
    const { abortSignalForResponse } = await import("../ai.request-signal");

    const dropped = Object.assign(new EventEmitter(), { writableEnded: false });
    const droppedSignal = abortSignalForResponse(dropped);
    expect(droppedSignal.aborted).toBe(false);
    dropped.emit("close");
    expect(droppedSignal.aborted).toBe(true);

    const finished = Object.assign(new EventEmitter(), { writableEnded: false });
    const finishedSignal = abortSignalForResponse(finished);
    finished.writableEnded = true;
    finished.emit("close");
    expect(finishedSignal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Astra round 2 @f254f3890
// ---------------------------------------------------------------------------

describe("R2 P1 outbound redaction resists spacing, punctuation and Unicode variants", () => {
  const FW = (ascii: string) => ascii.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
  const variants: ReadonlyArray<readonly [string, string, "email" | "nrc" | "phone" | "card", string]> = [
    ["spaced NRC", "My NRC is 123456 / 78 / 9 ok", "nrc", "123456"],
    ["dashed NRC", "NRC 123456-78-9", "nrc", "123456"],
    ["space-separated NRC", "NRC 123456 78 9", "nrc", "123456"],
    ["full-width NRC", `NRC ${FW("123456/78/9")}`, "nrc", "123456"],
    ["zero-width NRC", "NRC 123\u200B456/78\u200D/9", "nrc", "456"],
    ["spaced email", "write to alice @ example.com today", "email", "alice"],
    ["spaced-dot email", "alice@example . co . zm", "email", "alice"],
    ["full-width email", `mail ${FW("alice@example.com")}`, "email", "alice"],
    ["zero-width email", "ali\u200Bce@exa\u2060mple.com", "email", "ce@"],
    ["bracketed +260 phone", "ring +260 (97) 123 4567", "phone", "4567"],
    ["dotted local phone", "ring 097.123.4567", "phone", "4567"],
    ["dashed local phone", "ring 097-123-4567", "phone", "4567"],
    ["bracketed local phone", "ring (097) 123 4567", "phone", "4567"],
    ["full-width phone", `ring ${FW("+260971234567")}`, "phone", "4567"],
    ["dashed card", "card 4111-1111-1111-1111", "card", "1111"],
    // r3: a dot is never a card separator (it is a decimal point).
    ["dashed 13-digit card", "card 4222-2222-2222-2", "card", "2222"],
    ["contiguous card", "card 4111111111111111 please", "card", "41111111"],
    ["Amex card", "amex 3782 822463 10005", "card", "822463"],
    // r3 single-message bypasses
    ["dotted NRC", "NRC 123456.78.9", "nrc", "123456"],
    ["newline inside an NRC group", "NRC 123\n456/78/9", "nrc", "456"],
    ["whitespace between NRC groups", "NRC 123456\n78\t9", "nrc", "123456"],
    ["split local phone", "ring 0 97 123 4567", "phone", "4567"],
    ["mixed-script email", "mail alice@exаmple.com now", "email", "alice"],
    ["non-Latin email", "mail тест@пример.рф", "email", "@"],
    ["full-width card", `card ${FW("4111 1111 1111 1111")}`, "card", "1111"],
  ];

  it.each(variants)("current message: %s", (_label, text, kind, leaked) => {
    const result = redactOutboundText(text);
    expect(result.counts[kind]).toBeGreaterThan(0);
    expect(result.text).not.toContain(leaked);
  });

  it.each(variants)("prior assistant turn: %s", (_label, text, kind, leaked) => {
    const result = redactOutbound("what about it?", [
      { role: "user", text: "remind me" },
      { role: "model", text },
    ]);
    expect(result.counts[kind]).toBeGreaterThan(0);
    expect(result.priorTurns[1].text).not.toContain(leaked);
    expect(result.redacted).toBe(true);
  });

  it.each([
    "Did I spend more than ZMW 1,234.50 or K5000 between 2026-11-01 and 17/11/2026, over 30 days?",
    "On 07.11.2026 12:30 I paid K 1 250.00 for 2 items",
    "Budget 2026: K12,500,000.00 across 12 months, 3.5% up from 09/11/2025",
    "I owe ZMW 250 000 by 2026-12-31",
    // r3: adjacent values must not fuse into a card number.
    "Compare spending for 2026-01-01 2026-02-01.",
    "My balances are 1200.00 1500.00 1800.00.",
    "ZMW 1,200.00",
    "Rent 4500.00 4500.00 4500.00 4500.00 this year",
  ])("leaves amounts and dates untouched: %s", (text) => {
    const result = redactOutboundText(text);
    expect(result.text).toBe(text);
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true);
  });
});

describe("R2 P2 a withheld goal's funding is reported as unavailable, not absent", () => {
  it("says funding information is unavailable when progress is withheld", () => {
    const rendered = renderLocalSummary(
      [{ assignments: [{ goalName: "Holiday", accountName: null, progressAvailability: "unavailable", current: null }] }],
      "ZMW",
      true,
    );
    expect(rendered).toContain("Holiday");
    expect(rendered).toMatch(/funding information is unavailable/i);
    expect(rendered).not.toMatch(/no linked account/i);
  });

  it("still says no linked account when progress is visible and nothing is linked", () => {
    const rendered = renderLocalSummary(
      [{ assignments: [{ goalName: "Car", accountName: null, progressAvailability: "available", current: "0.00" }] }],
      "ZMW",
    );
    expect(rendered).toMatch(/Car: no linked account/);
  });
});

describe("R2 a provider answer that arrives after its stage timeout is discarded", () => {
  it("records the late analysis as a timeout and moves to the fallback", async () => {
    const claude = stubAdapter("anthropic");
    const gemini = stubAdapter("gemini");
    // Ignores nothing: waits for the combined signal to fire, then "succeeds" late.
    vi.mocked(claude.analyzeQuery).mockImplementation(
      (_message, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener("abort", () =>
            resolve({ toolCalls: [{ name: "get_spending_by_category", args: {} }], tokenCount: 10 }),
          );
        }),
    );
    const outcome = await new ProviderOrchestrator({
      adapters: { anthropic: claude, gemini },
      order: () => ({ primary: "anthropic", fallback: "gemini" }),
      timing: () => ({ deadlineMs: 30_000, stageTimeoutMs: 1_000, fallbackReserveMs: 1_000, maxPaidCalls: 3 }),
    }).run(runInput());

    expect(outcome.attempts.slice(0, 2).map((a) => [a.stage, a.provider, a.outcome, a.category])).toEqual([
      ["analysis", "anthropic", "failed", "timeout"],
      ["analysis", "gemini", "succeeded", null],
    ]);
    expect(outcome.analysisProvider).toBe("gemini");
    expect(outcome.cancelled).toBe(false);
  });
});
