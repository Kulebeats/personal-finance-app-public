/**
 * R17.1 (17a): the Gemini adapter conforms to the canonical contract, takes
 * its model id from GEMINI_MODEL only (no retired hard-coded id), passes a
 * real abort signal to the SDK and maps SDK failures to typed categories.
 * The SDK client class is replaced: nothing reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from "@google/generative-ai";

const sdk = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  sendOptions: [] as Array<Record<string, unknown> | undefined>,
  generateOptions: [] as Array<Record<string, unknown> | undefined>,
  sendResult: null as null | (() => Promise<unknown>),
}));

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  const response = (parts: unknown[]) => ({
    response: {
      candidates: [{ content: { parts } }],
      usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 12 },
      text: () => parts.map((part) => (part as { text?: string }).text ?? "").join(""),
    },
  });
  class FakeGoogleGenerativeAI {
    getGenerativeModel(params: Record<string, unknown>) {
      sdk.models.push(params);
      return {
        startChat: () => ({
          sendMessage: (_message: string, options?: Record<string, unknown>) => {
            sdk.sendOptions.push(options);
            return sdk.sendResult ? sdk.sendResult() : Promise.resolve(response([{ functionCall: { name: "get_budget_status", args: {} } }]));
          },
        }),
        generateContent: (_request: unknown, options?: Record<string, unknown>) => {
          sdk.generateOptions.push(options);
          return Promise.resolve(response([{ text: "Recorded Gemini answer." }]));
        },
      };
    }
  }
  return { ...actual, GoogleGenerativeAI: FakeGoogleGenerativeAI };
});

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { classifyGeminiError, GEMINI_TOOL_DECLARATIONS, GeminiClient } from "../ai.gemini";
import { AI_TOOL_DEFINITIONS } from "../ai.tool-definitions";

describe("R17 Gemini adapter", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-not-a-key");
    vi.stubEnv("GEMINI_MODEL", "configured-gemini-model");
    sdk.models.length = 0;
    sdk.sendOptions.length = 0;
    sdk.generateOptions.length = 0;
    sdk.sendResult = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("calls the configured model, never the retired hard-coded id", async () => {
    const result = await new GeminiClient().analyzeQuery("how is my budget?");
    expect(sdk.models[0].model).toBe("configured-gemini-model");
    expect(JSON.stringify(sdk.models)).not.toContain("gemini-2.0-flash");
    expect(result).toMatchObject({
      provider: "gemini",
      model: "configured-gemini-model",
      toolCalls: [{ name: "get_budget_status", args: {} }],
      usage: { known: true, inputTokens: 90, outputTokens: 12 },
    });
  });

  it("is unconfigured without GEMINI_MODEL even when a key is set", async () => {
    vi.stubEnv("GEMINI_MODEL", "");
    const client = new GeminiClient();
    expect(client.isAvailable()).toBe(false);
    await expect(client.analyzeQuery("q")).rejects.toMatchObject({ category: "unconfigured", dispatched: false });
    expect(sdk.models).toHaveLength(0);
  });

  it("passes the abort signal and per-call timeout to the SDK on both stages", async () => {
    const controller = new AbortController();
    const client = new GeminiClient();
    await client.analyzeQuery("q", { signal: controller.signal, timeoutMs: 2500 });
    await client.generateResponse("q", [{ name: "get_budget_status", result: { budgets: [] } }], "ZMW", {
      signal: controller.signal,
      timeoutMs: 1500,
    });
    expect(sdk.sendOptions[0]).toEqual({ signal: controller.signal, timeout: 2500 });
    expect(sdk.generateOptions[0]).toEqual({ signal: controller.signal, timeout: 1500 });
  });

  it("generates its declarations from the canonical JSON Schema definitions", () => {
    expect(GEMINI_TOOL_DECLARATIONS.map((declaration) => declaration.name)).toEqual(AI_TOOL_DEFINITIONS.map((d) => d.name));
    const spending = GEMINI_TOOL_DECLARATIONS.find((declaration) => declaration.name === "get_spending_by_category");
    expect(spending?.parameters?.required).toEqual(["period"]);
  });

  it("rejects an empty analysis as malformed instead of returning an empty answer", async () => {
    sdk.sendResult = () => Promise.resolve({ response: { candidates: [{ content: { parts: [] } }], text: () => "" } });
    await expect(new GeminiClient().analyzeQuery("q")).rejects.toMatchObject({ category: "malformed_output" });
  });

  it.each([
    ["timeout", new GoogleGenerativeAIAbortError("aborted")],
    ["rate_limited", new GoogleGenerativeAIFetchError("quota", 429)],
    ["overloaded", new GoogleGenerativeAIFetchError("unavailable", 503)],
    ["server_error", new GoogleGenerativeAIFetchError("boom", 500)],
    ["permission", new GoogleGenerativeAIFetchError("denied", 403)],
    ["model_not_found", new GoogleGenerativeAIFetchError("retired model", 404)],
    ["authentication", new GoogleGenerativeAIFetchError("bad key", 400, "Bad Request", [{ reason: "API_KEY_INVALID" }])],
    ["invalid_request", new GoogleGenerativeAIFetchError("bad", 400)],
    ["safety_refusal", new GoogleGenerativeAIResponseError("Candidate was blocked due to SAFETY")],
    ["connection", new TypeError("fetch failed")],
  ] as const)("classifies %s", async (category, error) => {
    expect(classifyGeminiError(error).category).toBe(category);
    sdk.sendResult = () => Promise.reject(error);
    await expect(new GeminiClient().analyzeQuery("q")).rejects.toMatchObject({ provider: "gemini", category });
  });
});
