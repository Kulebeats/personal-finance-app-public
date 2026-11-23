/**
 * Gemini adapter: Thandi's fallback provider (R17.1, AI-03).
 *
 * Conforms to the canonical `AIProviderAdapter` contract. The model id comes
 * from `GEMINI_MODEL` only (the retired hard-coded `gemini-2.0-flash` is gone).
 * Calls carry a real abort signal and timeout through the SDK's request
 * options instead of a non-cancelling promise race, and every SDK failure is
 * mapped to a typed `ProviderFailureCategory`.
 *
 * Tool declarations are generated from the canonical JSON Schema definitions
 * in `ai.tool-definitions.ts`, so both providers see the same allow-list.
 *
 * @module ai/ai.gemini
 */

import {
  FinishReason,
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIRequestInputError,
  GoogleGenerativeAIResponseError,
  SchemaType,
  type Content,
  type EnhancedGenerateContentResponse,
  type FunctionDeclaration,
  type FunctionDeclarationSchemaProperty,
  type GenerativeModel,
  type SingleRequestOptions,
} from "@google/generative-ai";
import { logger } from "../../utils/logger";
import { DEFAULT_AI_REQUEST_TOKEN_BUDGET } from "./ai.guardrails";
import { getGeminiConfig } from "./ai.provider-config";
import {
  AI_SYSTEM_PROMPT_TEMPLATE,
  AI_SYSTEM_PROMPT_VERSION,
  AI_TOOL_DEFINITIONS,
  AI_TOOL_NAMES,
  buildAnswerPrompt,
  buildSystemPrompt,
  type JsonSchemaProperty,
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

// Compatibility re-exports: these names predate the canonical contract.
export { AI_SYSTEM_PROMPT_TEMPLATE, AI_SYSTEM_PROMPT_VERSION };
export const GEMINI_TOOL_NAMES: readonly string[] = AI_TOOL_NAMES;
export type GeminiToolCall = ProviderToolCall;
export type GeminiPriorTurn = ProviderPriorTurn;
export type GeminiCallOptions = ProviderCallOptions;
export type GeminiResponse = AnalysisResult;

const DEFAULT_CALL_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const MIN_OUTPUT_TOKENS = 64;
/** Finish reasons that mean the provider declined (P1-2), not a protocol fault. */
const SAFETY_FINISH_REASONS: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.RECITATION,
  FinishReason.SPII,
]);
const DEFAULT_TOKEN_BUDGET = DEFAULT_AI_REQUEST_TOKEN_BUDGET;
const PRIMING_ACK =
  "Understood. I will help answer financial questions using the available tools and follow all guidelines.";

const SCHEMA_TYPE: Readonly<Record<JsonSchemaProperty["type"], SchemaType>> = {
  string: SchemaType.STRING,
  number: SchemaType.NUMBER,
  boolean: SchemaType.BOOLEAN,
};

function toGeminiProperty(property: JsonSchemaProperty): FunctionDeclarationSchemaProperty {
  if (property.enum) {
    return { type: SchemaType.STRING, format: "enum", description: property.description, enum: [...property.enum] };
  }
  return { type: SCHEMA_TYPE[property.type], description: property.description } as FunctionDeclarationSchemaProperty;
}

/** Gemini declaration shape, generated from the canonical definitions. */
export const GEMINI_TOOL_DECLARATIONS: FunctionDeclaration[] = AI_TOOL_DEFINITIONS.map((definition) => ({
  name: definition.name,
  description: definition.description,
  parameters: {
    type: SchemaType.OBJECT,
    properties: Object.fromEntries(
      Object.entries(definition.inputSchema.properties).map(([key, property]) => [key, toGeminiProperty(property)]),
    ),
    required: [...definition.inputSchema.required],
  },
}));

/** Map a Gemini SDK failure to a typed category. Exported for the failure-matrix tests. */
export function classifyGeminiError(error: unknown): { category: ProviderFailureCategory; status: number | null } {
  // An abort is the deadline signal firing; user cancellation is decided by
  // the orchestrator, which owns the caller's signal.
  if (error instanceof GoogleGenerativeAIAbortError) return { category: "timeout", status: null };
  if (error instanceof GoogleGenerativeAIFetchError) {
    const status = error.status ?? null;
    const reasons = (error.errorDetails ?? []).map((detail) => String(detail.reason ?? ""));
    if (reasons.includes("API_KEY_INVALID")) return { category: "authentication", status };
    if (status === 401) return { category: "authentication", status };
    if (status === 403) return { category: "permission", status };
    if (status === 404) return { category: "model_not_found", status };
    if (status === 408 || status === 504) return { category: "timeout", status };
    if (status === 429) return { category: "rate_limited", status };
    if (status === 503) return { category: "overloaded", status };
    if (status !== null && status >= 500) return { category: "server_error", status };
    return { category: "invalid_request", status };
  }
  if (error instanceof GoogleGenerativeAIRequestInputError) return { category: "invalid_request", status: null };
  if (error instanceof GoogleGenerativeAIResponseError) {
    return { category: /block|safety/i.test(error.message) ? "safety_refusal" : "malformed_output", status: null };
  }
  if (error instanceof Error && error.name === "AbortError") return { category: "timeout", status: null };
  return { category: "connection", status: null };
}

function toUsage(response: EnhancedGenerateContentResponse): ProviderUsage {
  const usage = response.usageMetadata;
  if (!usage) return UNKNOWN_USAGE;
  return {
    known: true,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
    cacheReadTokens: usage.cachedContentTokenCount ?? null,
    cacheWriteTokens: null,
  };
}

export class GeminiClient implements AIProviderAdapter {
  readonly id = "gemini" as const;
  private cached: { key: string; model: string; instance: GenerativeModel } | null = null;

  configuredModel(): string | null {
    return getGeminiConfig().model;
  }

  configurationIssue(): ProviderFailureCategory | null {
    const { apiKey, model } = getGeminiConfig();
    return apiKey && model ? null : "unconfigured";
  }

  /** Configured (key and model present). Configured is not proven healthy. */
  isAvailable(): boolean {
    return this.configurationIssue() === null;
  }

  async analyzeQuery(userMessage: string, options: ProviderCallOptions = {}): Promise<AnalysisResult> {
    const model = this.requireModel();
    const systemPrompt = buildSystemPrompt();
    const tokenBudget = this.resolveTokenBudget(options.tokenBudget);
    // The current message and system prompt are checked WITHOUT history:
    // history was already trimmed to fit inside the remainder.
    const promptTokens = estimatePromptTokens(systemPrompt) + estimatePromptTokens(userMessage);
    this.assertWithinBudget(promptTokens, tokenBudget);

    const chat = model.instance.startChat({ history: this.buildContents(systemPrompt, options.priorTurns ?? []) });
    const response = await this.call(() => chat.sendMessage(userMessage, this.requestOptions(options)), options);
    this.assertNotBlocked(response);

    const { toolCalls, text } = this.extract(response);
    if (toolCalls.length === 0 && text.length === 0) {
      throw this.failure("malformed_output", "Gemini returned neither text nor a tool call", true, toUsage(response));
    }
    const usage = toUsage(response);
    return {
      toolCalls,
      textResponse: text.length > 0 ? text : undefined,
      tokenCount: Math.min(tokenBudget, (usage.inputTokens ?? promptTokens) + (usage.outputTokens ?? 0)),
      provider: this.id,
      model: model.model,
      usage,
      providerRequestId: null,
    };
  }

  async generateResponse(
    userMessage: string,
    toolResults: ToolResultForPrompt[],
    currency: string,
    options: ProviderCallOptions = {},
  ): Promise<AnswerResult> {
    const model = this.requireModel();
    const fullPrompt = `${buildSystemPrompt()}\n\n${buildAnswerPrompt(userMessage, toolResults, currency)}`;
    const tokenBudget = this.resolveTokenBudget(options.tokenBudget);
    const promptTokens = estimatePromptTokens(fullPrompt);
    this.assertWithinBudget(promptTokens, tokenBudget);

    const remaining = tokenBudget - promptTokens;
    const maxOutputTokens = Math.max(
      MIN_OUTPUT_TOKENS,
      Math.min(DEFAULT_MAX_OUTPUT_TOKENS, options.maxOutputTokens ?? remaining, remaining),
    );
    const response = await this.call(
      () =>
        model.instance.generateContent(
          {
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            generationConfig: { maxOutputTokens, temperature: 0.2 },
          },
          this.requestOptions(options),
        ),
      options,
    );
    this.assertNotBlocked(response);

    const text = this.safeText(response);
    if (text.length === 0) {
      throw this.failure("malformed_output", "Gemini returned an empty answer", true, toUsage(response));
    }
    const usage = toUsage(response);
    return {
      response: text,
      tokenCount: Math.min(tokenBudget, (usage.inputTokens ?? promptTokens) + (usage.outputTokens ?? 0)),
      provider: this.id,
      model: model.model,
      usage,
      providerRequestId: null,
    };
  }

  /**
   * Provider `contents`: the system-prompt priming pair, then prior turns
   * oldest-first. Exposed so tests can assert the exact shape that leaves the
   * household boundary.
   */
  buildContents(systemPrompt: string, priorTurns: ProviderPriorTurn[] = []): Content[] {
    return [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: PRIMING_ACK }] },
      ...priorTurns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
    ];
  }

  /** Token cost of the system prompt, reserved before history is trimmed. */
  estimateSystemPromptTokens(): number {
    return estimatePromptTokens(buildSystemPrompt());
  }

  private requireModel(): { model: string; instance: GenerativeModel } {
    const { apiKey, model } = getGeminiConfig();
    if (!apiKey || !model) {
      throw this.failure("unconfigured", "Gemini is not configured (GEMINI_API_KEY and GEMINI_MODEL are required)", false);
    }
    if (!this.cached || this.cached.key !== apiKey || this.cached.model !== model) {
      const instance = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model,
        generationConfig: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, temperature: 0.2 },
        tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
      });
      this.cached = { key: apiKey, model, instance };
    }
    return { model, instance: this.cached.instance };
  }

  private requestOptions(options: ProviderCallOptions): SingleRequestOptions {
    return { timeout: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, signal: options.signal };
  }

  private async call(
    send: () => Promise<{ response: EnhancedGenerateContentResponse }>,
    options: ProviderCallOptions,
  ): Promise<EnhancedGenerateContentResponse> {
    try {
      return (await send()).response;
    } catch (error) {
      const { category, status } = classifyGeminiError(error);
      logger.warn("Gemini call failed", { category, status, model: getGeminiConfig().model });
      throw this.failure(category, `Gemini call failed (${category})`, true, UNKNOWN_USAGE, status);
    }
  }

  /**
   * Review fix P1-2: a blocked prompt or a safety-type finish is the
   * provider's refusal. Classify it BEFORE extraction, so an empty blocked
   * response is never "malformed output" (which would let local mode answer
   * a question the provider refused).
   */
  private assertNotBlocked(response: EnhancedGenerateContentResponse): void {
    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = response.candidates?.[0]?.finishReason;
    if (blockReason || (finishReason && SAFETY_FINISH_REASONS.has(finishReason))) {
      logger.warn("Gemini refused the request", { blockReason, finishReason });
      throw this.failure("safety_refusal", "Gemini declined to answer", true, toUsage(response));
    }
  }

  private extract(response: EnhancedGenerateContentResponse): { toolCalls: ProviderToolCall[]; text: string } {
    const candidate = response.candidates?.[0];
    const toolCalls: ProviderToolCall[] = [];
    const texts: string[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        const args = part.functionCall.args;
        toolCalls.push({
          name: part.functionCall.name,
          args: args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {},
        });
      } else if (part.text) {
        texts.push(part.text);
      }
    }
    return { toolCalls, text: texts.join("\n").trim() };
  }

  private safeText(response: EnhancedGenerateContentResponse): string {
    try {
      return response.text().trim();
    } catch (error) {
      const { category } = classifyGeminiError(error);
      throw this.failure(category, `Gemini answer unreadable (${category})`, true, toUsage(response));
    }
  }

  private assertWithinBudget(promptTokens: number, tokenBudget: number): void {
    if (promptTokens >= tokenBudget) {
      throw this.failure("invalid_request", "Request exceeds the token budget", false);
    }
  }

  private resolveTokenBudget(tokenBudget?: number): number {
    return tokenBudget && tokenBudget > 0 ? tokenBudget : DEFAULT_TOKEN_BUDGET;
  }

  private failure(
    category: ProviderFailureCategory,
    message: string,
    dispatched: boolean,
    usage: ProviderUsage = UNKNOWN_USAGE,
    status: number | null = null,
  ): ProviderError {
    return new ProviderError({ provider: this.id, category, message, dispatched, usage, status });
  }
}

export const geminiClient = new GeminiClient();
