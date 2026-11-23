import { beforeEach, describe, expect, it, vi } from "vitest";
import { Money } from "../../../core/money";
import { ClaudeAdapter, type ClaudeMessagesTransport } from "../ai.claude";
import { GeminiClient } from "../ai.gemini";
import { renderLocalSummary } from "../ai.local-templates";
import type { AIProviderAdapter, ToolResultForPrompt } from "../ai.provider.types";
import { sanitizeToolResult } from "../ai.sanitizer";

const recordedGemini = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() { throw new Error("Only the injected local Claude transport may run"); }
  },
  APIConnectionError: class extends Error {},
  APIConnectionTimeoutError: class extends Error {},
  APIError: class extends Error {},
  APIUserAbortError: class extends Error {},
}));

vi.mock("@google/generative-ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@google/generative-ai")>(),
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: recordedGemini }; }
  },
}));

// Adapter configuration uses placeholders for the fake transports, with no inherited environment.
vi.mock("../ai.provider-config", () => ({
  getAnthropicConfig: () => ({ apiKey: "recorded-anthropic", model: "recorded-claude" }),
  getGeminiConfig: () => ({ apiKey: "recorded-gemini", model: "recorded-gemini" }),
}));

const currency = "ZMW";
const question = "How much did I spend and what is still upcoming?";
const email = "synthetic.thirdparty@example.invalid";
const category = `Trips ${email}`;
const hiddenDigits = "+260 971 234 567";
const date = "2026-11-18";

function toolResults(): ToolResultForPrompt[] {
  const amount = new Money("971234567.25", currency);
  const small = new Money("12.50", currency);
  const transaction = { transactionId: "hidden-row", date, description: "Coffee", category, merchant: "Coffee shop", amount: small };
  const raw: ReadonlyArray<readonly [string, unknown]> = [
    ["get_spending_by_category", [
      { category, amount, transactionCount: 1 },
      { category: "School meals", amount: small, transactionCount: 2 },
    ]],
    ["get_recent_transactions", [transaction]],
    ["get_transaction_search", [transaction]],
    ["get_upcoming_recurring", [
      { description: `Subscription ${hiddenDigits}`, category, amount: small, nextDate: date, frequency: "monthly" },
      { description: "Broadband", category: null, amount: small, nextDate: date, frequency: "monthly" },
    ]],
    ["get_budget_status", [{ categoryName: category, budgeted: amount, spent: small, remaining: amount,
      percentUsed: 5, status: "under_budget" }]],
    ["get_category_trends", [{ categoryName: category, points: [{ month: "2026-11", amount: small }], trendDirection: "flat" }]],
    ["get_goals_status", [{ name: email.replace("@", "＠"), target: null, progressAvailability: "unavailable" }]],
    ["get_merchant_spending", [{ merchantName: `Supplier ${email.replace("@", "＠")}`, totalSpent: small,
      transactionCount: 1, avgTransactionAmount: small }]],
    ["get_account_balances", [{ accountType: "checking", accountName: "Raw account name", balance: new Money("12.50", "USD"),
      currency: "USD", isActive: true }]],
  ];
  return raw.map(([name, data]) => {
    const result = sanitizeToolResult(name, data, currency);
    expect(result.sanitized).toBe(true);
    return { name, result: result.data };
  });
}

describe("A-68 answer-stage tool labels", () => {
  const recordedClaude = vi.fn<ClaudeMessagesTransport>();
  beforeEach(() => {
    recordedClaude.mockReset().mockResolvedValue({
      id: "recorded-claude", model: "recorded-claude", stop_reason: "end_turn",
      content: [{ type: "text", text: "Recorded answer." }],
    } as Awaited<ReturnType<ClaudeMessagesTransport>>);
    recordedGemini.mockReset().mockResolvedValue({
      response: { candidates: [{ content: { parts: [{ text: "Recorded answer." }] } }], text: () => "Recorded answer." },
    });
  });

  const adapters: Array<{ id: string; adapter: () => AIProviderAdapter; sent: () => unknown }> = [
    { id: "Claude", adapter: () => new ClaudeAdapter(recordedClaude), sent: () => recordedClaude.mock.calls[0]?.[1] },
    { id: "Gemini", adapter: () => new GeminiClient(), sent: () => recordedGemini.mock.calls[0]?.[0] },
  ];

  it.each(adapters)("redacts identifiers from the full $id answer request and keeps financial context", async ({ adapter, sent }) => {
    const results = toolResults();
    const localData = JSON.stringify(results);
    expect(localData).toContain(email);

    const reply = await adapter().generateResponse(question, results, currency);
    expect(reply.response).toBe("Recorded answer.");
    const prompt = JSON.stringify(sent());
    expect(prompt).not.toContain("synthetic.thirdparty");
    expect(prompt).not.toContain(hiddenDigits);
    expect(prompt).not.toContain("Raw account name");
    expect(prompt).toContain("Trips [email]");
    expect(prompt).toContain("Subscription [phone]");
    expect(prompt).toContain("School meals");
    expect(prompt).toContain(question);
    expect(prompt).toContain(date);
    for (const fragment of ['"amount": "971234567.25"', '"currency": "USD"', '"currentAmount": null']) {
      expect(prompt).toContain(JSON.stringify(fragment).slice(1, -1));
    }
    expect(JSON.stringify(results)).toBe(localData);
    expect(renderLocalSummary(results.map(entry => entry.result), currency)).toContain(category);
  });
});
