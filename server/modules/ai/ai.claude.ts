/**
 * Claude adapter: Thandi's primary provider (R17.1, AI-02).
 *
 * Direct Anthropic Messages API on the official TypeScript SDK. The model id
 * comes from `ANTHROPIC_MODEL` only. SDK retries are zero: the orchestrator
 * owns the attempt budget (at most one call per provider per stage), so a
 * hidden SDK retry would multiply paid calls. Every call carries an abort
 * signal and a timeout derived from the request deadline.
 *
 * The transport is injectable so CI exercises this adapter against recorded
 * responses with no network access.
 *
 * @module ai/ai.claude
 */

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { logger } from "../../utils/logger";
import { DEFAULT_AI_REQUEST_TOKEN_BUDGET } from "./ai.guardrails";
import { getAnthropicConfig } from "./ai.provider-config";
import {
  AI_TOOL_DEFINITIONS,
  buildAnswerPrompt,
  buildSystemPrompt,
} from "./ai.tool-definitions";
import {
  ProviderError,
  estimatePromptTokens,
  UNKNOWN_USAGE,
  type AIProviderAdapter,
  type AnalysisResult,
  type AnswerResult,
  type ProviderCallOptions,
  type ProviderFailureCategory,
  type ProviderPriorTurn,
  type ProviderToolCall,
  type ProviderUsage,
  type ToolResultForPrompt,
} from "./ai.provider.types";

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const MIN_OUTPUT_TOKENS = 64;
const DEFAULT_TOKEN_BUDGET = DEFAULT_AI_REQUEST_TOKEN_BUDGET;
const DEFAULT_CALL_TIMEOUT_MS = 12_000;

export interface ClaudeTransportOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

export type ClaudeMessagesTransport = (
  apiKey: string,
  params: MessageCreateParamsNonStreaming,
  options: ClaudeTransportOptions,
) => Promise<Message & { _request_id?: string | null }>;

/** The real transport. Constructed per key so a rotated key takes effect. */
const sdkTransport: ClaudeMessagesTransport = (apiKey, params, options) => {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return client.messages.create(params, {
    signal: options.signal,
    timeout: options.timeoutMs,
    maxRetries: 0,
  });
};

/** Anthropic `error.type` values that carry a meaning the HTTP status alone does not. */
const TYPE_CATEGORY: Readonly<Record<string, ProviderFailureCategory>> = {
  authentication_error: "authentication",
  permission_error: "permission",
  not_found_error: "model_not_found",
  rate_limit_error: "rate_limited",
  overloaded_error: "overloaded",
  api_error: "server_error",
  timeout_error: "timeout",
  billing_error: "billing",
  invalid_request_error: "invalid_request",
};

function categoryForStatus(status: number | undefined): ProviderFailureCategory {
  if (status === undefined) return "connection";
  if (status === 401) return "authentication";
  if (status === 402) return "billing";
  if (status === 403) return "permission";
  if (status === 404) return "model_not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server_error";
  return "invalid_request";
}

/** Map any SDK failure to a typed category. Exported for the failure-matrix tests. */
export function classifyClaudeError(error: unknown): { category: ProviderFailureCategory; status: number | null; requestId: string | null } {
  // An abort is the deadline signal firing. Whether the USER cancelled is the
  // orchestrator's call (it owns the caller's signal), not the adapter's.
  if (error instanceof APIUserAbortError) {
    return { category: "timeout", status: null, requestId: null };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return { category: "timeout", status: null, requestId: null };
  }
  if (error instanceof APIConnectionError) {
    return { category: "connection", status: null, requestId: null };
  }
  if (error instanceof APIError) {
    const status = typeof error.status === "number" ? error.status : undefined;
    const byType = error.type ? TYPE_CATEGORY[error.type] : undefined;
    return {
      category: byType ?? categoryForStatus(status),
      status: status ?? null,
      requestId: error.requestID ?? null,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { category: "timeout", status: null, requestId: null };
  }
  return { category: "connection", status: null, requestId: null };
}

function toUsage(message: Message): ProviderUsage {
  const usage = message.usage;
  if (!usage) return UNKNOWN_USAGE;
  return {
    known: true,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
  };
}

const CLAUDE_TOOLS: Tool[] = AI_TOOL_DEFINITIONS.map((definition) => ({
  name: definition.name,
  description: definition.description,
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(definition.inputSchema.properties).map(([key, property]) => [
        key,
        property.enum
          ? { type: property.type, description: property.description, enum: [...property.enum] }
          : { type: property.type, description: property.description },
      ]),
    ),
    required: [...definition.inputSchema.required],
  },
}));

/** Canonical history → Anthropic roles. Only text crosses; consecutive roles merge. */
export function toClaudeMessages(priorTurns: ProviderPriorTurn[], currentMessage: string): MessageParam[] {
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [
    ...priorTurns.map((turn) => ({ role: turn.role === "model" ? ("assistant" as const) : ("user" as const), text: turn.text })),
    { role: "user" as const, text: currentMessage },
  ];
  const merged: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      merged[merged.length - 1] = { role: last.role, text: `${last.text}\n\n${turn.text}` };
    } else {
      merged.push(turn);
    }
  }
  // The Messages API requires the first turn to be the user's.
  while (merged.length > 0 && merged[0].role !== "user") merged.shift();
  return merged.map((turn) => ({ role: turn.role, content: turn.text }));
}

function extractBlocks(message: Message): { text: string; toolCalls: ProviderToolCall[] } {
  const texts: string[] = [];
  const toolCalls: ProviderToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      texts.push(block.text);
    } else if (block.type === "tool_use") {
      const input = block.input;
      const args = input !== null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
      toolCalls.push({ name: block.name, args });
    }
    // Thinking, redacted-thinking and server-tool blocks are never surfaced,
    // persisted or forwarded to another provider.
  }
  return { text: texts.join("\n").trim(), toolCalls };
}

export class ClaudeAdapter implements AIProviderAdapter {
  readonly id = "anthropic" as const;

  constructor(private readonly transport: ClaudeMessagesTransport = sdkTransport) {}

  configuredModel(): string | null {
    return getAnthropicConfig().model;
  }

  configurationIssue(): ProviderFailureCategory | null {
    const { apiKey, model } = getAnthropicConfig();
    return apiKey && model ? null : "unconfigured";
  }

  isAvailable(): boolean {
    return this.configurationIssue() === null;
  }

  async analyzeQuery(userMessage: string, options: ProviderCallOptions = {}): Promise<AnalysisResult> {
    const system = buildSystemPrompt();
    const tokenBudget = options.tokenBudget && options.tokenBudget > 0 ? options.tokenBudget : DEFAULT_TOKEN_BUDGET;
    const promptTokens = estimatePromptTokens(system) + estimatePromptTokens(userMessage);
    this.assertWithinBudget(promptTokens, tokenBudget);
    const maxTokens = this.outputCap(tokenBudget - promptTokens, options.maxOutputTokens);

    const message = await this.send(
      {
        system,
        messages: toClaudeMessages(options.priorTurns ?? [], userMessage),
        tools: CLAUDE_TOOLS,
        max_tokens: maxTokens,
      },
      options,
    );

    const { text, toolCalls } = extractBlocks(message);
    if (toolCalls.length === 0 && text.length === 0) {
      throw this.malformed("Claude returned neither text nor a tool call", message);
    }
    const usage = toUsage(message);
    return {
      toolCalls,
      textResponse: text.length > 0 ? text : undefined,
      tokenCount: Math.min(tokenBudget, (usage.inputTokens ?? promptTokens) + (usage.outputTokens ?? 0)),
      provider: this.id,
      model: message.model,
      usage,
      providerRequestId: message._request_id ?? null,
    };
  }

  async generateResponse(
    userMessage: string,
    toolResults: ToolResultForPrompt[],
    currency: string,
    options: ProviderCallOptions = {},
  ): Promise<AnswerResult> {
    const system = buildSystemPrompt();
    const prompt = buildAnswerPrompt(userMessage, toolResults, currency);
    const tokenBudget = options.tokenBudget && options.tokenBudget > 0 ? options.tokenBudget : DEFAULT_TOKEN_BUDGET;
    const promptTokens = estimatePromptTokens(system) + estimatePromptTokens(prompt);
    this.assertWithinBudget(promptTokens, tokenBudget);
    const maxTokens = this.outputCap(tokenBudget - promptTokens, options.maxOutputTokens);

    const message = await this.send(
      { system, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens },
      options,
    );

    const { text } = extractBlocks(message);
    if (text.length === 0) {
      throw this.malformed("Claude returned an empty answer", message);
    }
    const usage = toUsage(message);
    return {
      response: text,
      tokenCount: Math.min(tokenBudget, (usage.inputTokens ?? promptTokens) + (usage.outputTokens ?? 0)),
      provider: this.id,
      model: message.model,
      usage,
      providerRequestId: message._request_id ?? null,
    };
  }

  private assertWithinBudget(promptTokens: number, tokenBudget: number): void {
    if (promptTokens >= tokenBudget) {
      throw new ProviderError({
        provider: this.id,
        category: "invalid_request",
        message: "Request exceeds the token budget",
        dispatched: false,
      });
    }
  }

  private outputCap(remaining: number, requested?: number): number {
    return Math.max(MIN_OUTPUT_TOKENS, Math.min(DEFAULT_MAX_OUTPUT_TOKENS, requested ?? remaining, remaining));
  }

  private async send(
    body: Omit<MessageCreateParamsNonStreaming, "model">,
    options: ProviderCallOptions,
  ): Promise<Message & { _request_id?: string | null }> {
    const { apiKey, model } = getAnthropicConfig();
    if (!apiKey || !model) {
      throw new ProviderError({
        provider: this.id,
        category: "unconfigured",
        message: "Claude is not configured (ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required)",
        dispatched: false,
      });
    }

    let message: Message & { _request_id?: string | null };
    try {
      message = await this.transport(apiKey, { ...body, model }, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      });
    } catch (error) {
      const { category, status, requestId } = classifyClaudeError(error);
      // Never log the key or the prompt; the SDK message carries neither.
      logger.warn("Claude call failed", { category, status: status ?? undefined, requestId: requestId ?? undefined, model });
      throw new ProviderError({
        provider: this.id,
        category,
        message: `Claude call failed (${category})`,
        status,
        providerRequestId: requestId,
        dispatched: category !== "unconfigured",
      });
    }

    if (message.stop_reason === "refusal") {
      throw new ProviderError({
        provider: this.id,
        category: "safety_refusal",
        message: "Claude declined the request",
        providerRequestId: message._request_id ?? null,
        dispatched: true,
        usage: toUsage(message),
      });
    }
    return message;
  }

  private malformed(reason: string, message: Message & { _request_id?: string | null }): ProviderError {
    return new ProviderError({
      provider: this.id,
      category: "malformed_output",
      message: reason,
      providerRequestId: message._request_id ?? null,
      dispatched: true,
      usage: toUsage(message),
    });
  }
}

export const claudeClient = new ClaudeAdapter();
