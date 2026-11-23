/**
 * Canonical provider contracts for Thandi (R17.1, AI-01).
 *
 * Both external adapters (Claude primary, Gemini fallback) implement
 * `AIProviderAdapter`. Nothing outside an adapter may depend on a provider's
 * own request or response shape. Failures are typed: every adapter maps its
 * SDK errors to a `ProviderFailureCategory`, and the orchestrator decides from
 * the category alone whether another provider may take the stage.
 *
 * @module ai/ai.provider.types
 */

import { AIErrorCode } from "./ai.types";

export type AIProviderId = "anthropic" | "gemini";
export type AIStage = "analysis" | "answer";

/** How the final reply was produced. Drives the client label (17e). */
export type AnswerMode = "claude" | "gemini" | "local" | "unavailable";

export type ProviderFailureCategory =
  | "unconfigured"
  | "authentication"
  | "permission"
  | "model_not_found"
  | "connection"
  | "timeout"
  | "overloaded"
  | "server_error"
  | "rate_limited"
  | "billing"
  | "invalid_request"
  | "safety_refusal"
  | "malformed_output"
  | "cancelled";

/**
 * Categories after which the fallback provider may take the stage (B1, master
 * §3 failure table). Configuration failures are eligible so one fallback keeps
 * the service usable while the operator is alerted. Billing/cap failures are
 * NOT eligible: billing-cap failover is disabled by default. A safety refusal,
 * invalid request or malformed payload is never re-asked elsewhere.
 */
const FAILOVER_ELIGIBLE: ReadonlySet<ProviderFailureCategory> = new Set<ProviderFailureCategory>([
  "unconfigured",
  "authentication",
  "permission",
  "model_not_found",
  "connection",
  "timeout",
  "overloaded",
  "server_error",
  "rate_limited",
]);

/**
 * Categories after which the free local mode must NOT answer instead: a
 * refusal or rejected request is the outcome, and a cancelled request writes
 * no answer at all.
 */
const LOCAL_FORBIDDEN: ReadonlySet<ProviderFailureCategory> = new Set<ProviderFailureCategory>([
  "safety_refusal",
  "invalid_request",
  "cancelled",
]);

/** Configuration states that mean "an operator must act", for status (17e). */
export const CONFIGURATION_CATEGORIES: ReadonlySet<ProviderFailureCategory> = new Set<ProviderFailureCategory>([
  "unconfigured",
  "authentication",
  "permission",
  "model_not_found",
]);

export function isFailoverEligible(category: ProviderFailureCategory): boolean {
  return FAILOVER_ELIGIBLE.has(category);
}

export function permitsLocalMode(category: ProviderFailureCategory): boolean {
  return !LOCAL_FORBIDDEN.has(category);
}

/** Token usage as the provider reported it. Unknown stays unknown, never zero. */
export interface ProviderUsage {
  known: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export const UNKNOWN_USAGE: ProviderUsage = Object.freeze({
  known: false,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
});

export interface ProviderErrorInit {
  provider: AIProviderId;
  category: ProviderFailureCategory;
  message: string;
  status?: number | null;
  providerRequestId?: string | null;
  /** True when the request may have reached the provider (cost possibly incurred). */
  dispatched: boolean;
  usage?: ProviderUsage;
}

/**
 * The only error an adapter throws for a provider-side failure. `code` keeps
 * the legacy `AIErrorCode` contract that `isProviderFailure` relies on.
 */
export class ProviderError extends Error {
  readonly code: AIErrorCode;
  readonly provider: AIProviderId;
  readonly category: ProviderFailureCategory;
  readonly status: number | null;
  readonly providerRequestId: string | null;
  readonly dispatched: boolean;
  readonly usage: ProviderUsage;
  readonly retryable: boolean;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.category = init.category;
    this.status = init.status ?? null;
    this.providerRequestId = init.providerRequestId ?? null;
    this.dispatched = init.dispatched;
    this.usage = init.usage ?? UNKNOWN_USAGE;
    this.retryable = isFailoverEligible(init.category);
    this.code = init.category === "rate_limited" ? AIErrorCode.RATE_LIMIT_EXCEEDED : AIErrorCode.EXTERNAL_API_ERROR;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export interface ProviderToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A replayed conversation turn. `model` is the provider-neutral name for a
 * previous assistant reply (the vocabulary `selectHistoryTurns` emits); each
 * adapter maps it to its own role name. Only plain text is ever replayed:
 * no thinking, signature, tool or debug blocks cross providers.
 */
export interface ProviderPriorTurn {
  role: "user" | "model";
  text: string;
}

export interface ProviderCallOptions {
  tokenBudget?: number;
  maxOutputTokens?: number;
  priorTurns?: ProviderPriorTurn[];
  /** Aborts the outbound call (request deadline or user cancellation). */
  signal?: AbortSignal;
  /** Per-call timeout derived from the remaining request deadline. */
  timeoutMs?: number;
}

/** Metadata every successful call reports. Optional so legacy stubs still fit. */
export interface ProviderCallMeta {
  provider?: AIProviderId;
  model?: string;
  usage?: ProviderUsage;
  providerRequestId?: string | null;
}

export interface AnalysisResult extends ProviderCallMeta {
  toolCalls: ProviderToolCall[];
  textResponse?: string;
  tokenCount: number;
}

export interface AnswerResult extends ProviderCallMeta {
  response: string;
  tokenCount: number;
}

export interface ToolResultForPrompt {
  name: string;
  result: unknown;
}

export interface AIProviderAdapter {
  readonly id: AIProviderId;
  /** The configured model id, or null when none is configured. */
  configuredModel(): string | null;
  /** Why the adapter cannot be called, or null when it is configured. */
  configurationIssue(): ProviderFailureCategory | null;
  /** Configured (key and model present). Configured is not proven healthy. */
  isAvailable(): boolean;
  analyzeQuery(userMessage: string, options?: ProviderCallOptions): Promise<AnalysisResult>;
  generateResponse(
    userMessage: string,
    toolResults: ToolResultForPrompt[],
    currency: string,
    options?: ProviderCallOptions,
  ): Promise<AnswerResult>;
}

/** Characters-per-token heuristic shared by both adapters for budgeting only. */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
