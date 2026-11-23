/**
 * R17.1 (17a): the Claude adapter on the official SDK, exercised against a
 * recorded-response transport. No network: the SDK class itself is replaced
 * for the "real transport" assertions, and every other case injects a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";

const sdk = vi.hoisted(() => ({
  constructed: [] as Array<Record<string, unknown>>,
  createCalls: [] as Array<{ body: Record<string, unknown>; options: Record<string, unknown> }>,
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    messages = {
      create: async (body: Record<string, unknown>, options: Record<string, unknown>) => {
        sdk.createCalls.push({ body, options });
        return recorded({ content: [{ type: "text", text: "Recorded answer." }] as Message["content"] });
      },
    };
    constructor(options: Record<string, unknown>) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ClaudeAdapter, classifyClaudeError, toClaudeMessages, type ClaudeMessagesTransport } from "../ai.claude";
import { ProviderError } from "../ai.provider.types";
import { AI_TOOL_NAMES } from "../ai.tool-definitions";

type RecordedMessage = Message & { _request_id?: string | null };

function recorded(partial: Partial<Message>): RecordedMessage {
  return {
    id: "msg_recorded",
    type: "message",
    role: "assistant",
    model: "recorded-claude-model",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: null },
    content: [],
    _request_id: "req_recorded_1",
    ...partial,
  } as RecordedMessage;
}

function headers(): Headers {
  return new Headers({ "request-id": "req_failed_1" });
}

function apiError(status: number, type: string): APIError {
  return APIError.generate(status, { type: "error", error: { type, message: "synthetic" } }, "synthetic", headers());
}

describe("R17 Claude adapter", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-not-a-key");
    vi.stubEnv("ANTHROPIC_MODEL", "configured-claude-model");
    sdk.constructed.length = 0;
    sdk.createCalls.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the official SDK with retries disabled, the configured model, and the caller's signal and timeout", async () => {
    const adapter = new ClaudeAdapter();
    const controller = new AbortController();
    await adapter.generateResponse("q", [{ name: "get_budget_status", result: { budgets: [] } }], "ZMW", {
      signal: controller.signal,
      timeoutMs: 4321,
    });

    expect(sdk.constructed).toEqual([expect.objectContaining({ apiKey: "test-only-not-a-key", maxRetries: 0 })]);
    expect(sdk.createCalls).toHaveLength(1);
    expect(sdk.createCalls[0].body.model).toBe("configured-claude-model");
    expect(sdk.createCalls[0].options).toEqual(expect.objectContaining({ maxRetries: 0, timeout: 4321, signal: controller.signal }));
  });

  it("is unconfigured, and never dispatches, without a key or without a model id", async () => {
    const transport = vi.fn<ClaudeMessagesTransport>();
    vi.stubEnv("ANTHROPIC_MODEL", "");
    const adapter = new ClaudeAdapter(transport);
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.configuredModel()).toBeNull();
    await expect(adapter.analyzeQuery("how much did I spend?")).rejects.toMatchObject({
      category: "unconfigured",
      dispatched: false,
    });
    vi.stubEnv("ANTHROPIC_MODEL", "configured-claude-model");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(adapter.isAvailable()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps tool_use blocks to canonical tool calls, ignores thinking blocks, and reports usage and request id", async () => {
    const transport = vi.fn<ClaudeMessagesTransport>().mockResolvedValue(
      recorded({
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "private reasoning", signature: "sig" },
          { type: "tool_use", id: "toolu_1", name: "get_spending_by_category", input: { period: "30d" } },
        ] as Message["content"],
      }),
    );
    const result = await new ClaudeAdapter(transport).analyzeQuery("where did my money go?", {
      priorTurns: [
        { role: "user", text: "hi" },
        { role: "model", text: "Hello." },
      ],
    });

    expect(result.toolCalls).toEqual([{ name: "get_spending_by_category", args: { period: "30d" } }]);
    expect(result.textResponse).toBeUndefined();
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("recorded-claude-model");
    expect(result.providerRequestId).toBe("req_recorded_1");
    expect(result.usage).toEqual({ known: true, inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: null });

    const body = transport.mock.calls[0][1];
    expect(body.model).toBe("configured-claude-model");
    expect(body.tools?.map((tool) => ("name" in tool ? tool.name : ""))).toEqual([...AI_TOOL_NAMES]);
    expect(body.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
      { role: "user", content: "where did my money go?" },
    ]);
    expect(JSON.stringify(body)).not.toContain("private reasoning");
  });

  it("treats an empty response as malformed and a refusal as a safety refusal, never as an answer", async () => {
    const empty = new ClaudeAdapter(vi.fn<ClaudeMessagesTransport>().mockResolvedValue(recorded({ content: [] })));
    await expect(empty.generateResponse("q", [], "ZMW")).rejects.toMatchObject({ category: "malformed_output", dispatched: true });

    const refusal = new ClaudeAdapter(
      vi.fn<ClaudeMessagesTransport>().mockResolvedValue(recorded({ stop_reason: "refusal", content: [{ type: "text", text: "no" }] as Message["content"] })),
    );
    await expect(refusal.analyzeQuery("q")).rejects.toMatchObject({ category: "safety_refusal" });
  });

  it.each([
    ["connection", new APIConnectionError({ message: "socket hang up" })],
    ["timeout", new APIConnectionTimeoutError()],
    ["timeout", new APIUserAbortError()],
    ["overloaded", apiError(529, "overloaded_error")],
    ["rate_limited", apiError(429, "rate_limit_error")],
    ["server_error", apiError(500, "api_error")],
    ["authentication", apiError(401, "authentication_error")],
    ["permission", apiError(403, "permission_error")],
    ["model_not_found", apiError(404, "not_found_error")],
    ["billing", apiError(400, "billing_error")],
    ["invalid_request", apiError(400, "invalid_request_error")],
  ] as const)("classifies %s", async (category, error) => {
    expect(classifyClaudeError(error).category).toBe(category);
    const adapter = new ClaudeAdapter(vi.fn<ClaudeMessagesTransport>().mockRejectedValue(error));
    const thrown = await adapter.analyzeQuery("q").catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(ProviderError);
    expect(thrown).toMatchObject({ provider: "anthropic", category });
    expect(String((thrown as Error).message)).not.toContain("test-only-not-a-key");
  });

  it("keeps the first turn the user's and merges same-role neighbours", () => {
    expect(toClaudeMessages([{ role: "model", text: "orphan" }, { role: "user", text: "a" }], "b")).toEqual([
      { role: "user", content: "a\n\nb" },
    ]);
  });
});
