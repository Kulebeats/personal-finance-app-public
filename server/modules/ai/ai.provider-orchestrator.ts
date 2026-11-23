/**
 * Stage-aware provider orchestrator (R17.1, B1, AI-02/03/04/12/13).
 *
 * Two stages per logical request: analysis (tool selection) then answer
 * (explanation of sanitised tool results). Claude is tried first; on an
 * eligible failure the fallback takes the stage, and once switched the request
 * stays on the fallback. If every eligible provider fails, the labelled local
 * mode answers from authorised tool results, or the outcome is "unavailable".
 *
 * Bounds: one attempt per provider per stage, at most three paid calls, one
 * overall deadline with a reserved fallback window, abort signals honoured and
 * late results ignored. Application errors (anything that is not a provider
 * failure) propagate unchanged: failover never conceals our own defects.
 *
 * @module ai/ai.provider-orchestrator
 */

import { isProviderFailure } from "./ai.fallback";
import { AI_TOOL_CALL_CAP, enforceToolAllowlist } from "./ai.guardrails";
import {
  getProviderOrder,
  getRequestTimingConfig,
  MIN_AI_CALL_TIMEOUT_MS,
  type ProviderOrder,
  type RequestTimingConfig,
} from "./ai.provider-config";
import {
  isFailoverEligible,
  isProviderError,
  permitsLocalMode,
  ProviderError,
  UNKNOWN_USAGE,
  type AIProviderAdapter,
  type AIProviderId,
  type AIStage,
  type AnswerMode,
  type ProviderCallMeta,
  type ProviderFailureCategory,
  type ProviderPriorTurn,
  type ProviderToolCall,
  type ProviderUsage,
  type ToolResultForPrompt,
} from "./ai.provider.types";
import { AIErrorCode, type ToolResult } from "./ai.types";

export interface StageAttemptRecord {
  ordinal: number;
  stage: AIStage;
  provider: AIProviderId;
  model: string | null;
  outcome: "succeeded" | "failed" | "skipped";
  category: ProviderFailureCategory | null;
  dispatched: boolean;
  usage: ProviderUsage;
  providerRequestId: string | null;
  durationMs: number;
  /** The ledger row a claimed attempt settles by (Astra #255 r3). */
  attemptId?: string;
}

export type StageProvider = AIProviderId | "local" | null;

export interface LocalRun {
  reply: string;
  useful: boolean;
  executedToolCalls: ProviderToolCall[];
  tokenCount: number;
  dataSanitized: boolean;
}

export interface ChatRunInput {
  message: string;
  priorTurns: ProviderPriorTurn[];
  tokenBudget: number;
  currency: string;
  signal?: AbortSignal;
  /** Executes one validated call through the sanitising tool layer. */
  executeTool: (call: ProviderToolCall) => Promise<ToolResult>;
  /** The keyword local mode, run when no provider produced an analysis. */
  runLocal: (context: LocalRenderContext) => Promise<LocalRun>;
  /** Template a local answer from already-sanitised results, or null. */
  renderLocal: (sanitisedData: unknown[], context: LocalRenderContext) => string | null;
  /** False keeps the whole request local (e.g. an outdated consent version). */
  externalProvidersAllowed?: boolean;
  /** Paid calls the logical request already made on earlier attempts (B1). */
  priorPaidCalls?: number;
  /** Per-request gate before each dispatch (consent recheck, attempt claim). Throw to stop. */
  beforeAttempt?: (attempt: AttemptClaim) => Promise<AttemptTicket | void>;
  /** Per-request settlement of each claimed attempt, awaited before the next step. */
  afterAttempt?: (record: StageAttemptRecord) => Promise<void>;
  /**
   * Last gate after the claim commits, right before the adapter call (Astra
   * #255 r4: consent read once more). Throwing stops the call; the claimed
   * attempt settles as never dispatched and the error propagates.
   */
  beforeDispatch?: (attempt: AttemptClaim) => Promise<void>;
}

export interface AttemptClaim {
  stage: AIStage;
  provider: AIProviderId;
  ordinal: number;
  model: string | null;
  timeoutMs: number;
  /** The request's overall deadline (epoch ms): a claim never waits past it. */
  requestDeadlineAt: number;
}

/** A claimed attempt's ledger row. */
export interface AttemptTicket {
  attemptId: string;
}

/** Lets local copy tell the truth about whether a provider call was sent. */
export interface LocalRenderContext {
  providerAttempted: boolean;
}

export interface ChatRunOutcome {
  mode: AnswerMode;
  reply: string;
  analysisProvider: StageProvider;
  answerProvider: StageProvider;
  executedToolCalls: ProviderToolCall[];
  blockedTools: string[];
  droppedTools: string[];
  tokenCount: number;
  dataSanitized: boolean;
  attempts: StageAttemptRecord[];
  transmissionAttempted: boolean;
  failureCategory: ProviderFailureCategory | null;
  cancelled: boolean;
}

export interface OrchestratorDeps {
  adapters: Readonly<Record<AIProviderId, AIProviderAdapter>>;
  order?: () => ProviderOrder;
  timing?: () => RequestTimingConfig;
  now?: () => number;
  /** Rechecked before every outbound attempt (consent, admission). Throw to stop. */
  beforeAttempt?: (attempt: AttemptClaim) => Promise<unknown>;
}

export const REFUSAL_REPLY = "I can't help with that request. I can answer questions about your household finances.";
export const INVALID_REQUEST_REPLY =
  "I couldn't process that request. Please shorten the question or narrow the time range.";
export const NO_DATA_REPLY =
  "I couldn't retrieve the information needed to answer your question, so I won't guess. Please try again.";
export const CANCELLED_REPLY = "The request was cancelled before an answer was produced.";

const MODE_BY_PROVIDER: Readonly<Record<AIProviderId, AnswerMode>> = { anthropic: "claude", gemini: "gemini" };

/** Legacy stubs throw plain errors carrying an AIErrorCode; type them here. */
function normaliseProviderFailure(error: unknown, provider: AIProviderId): ProviderError | null {
  if (isProviderError(error)) return error;
  if (!isProviderFailure(error)) return null;
  const code = (error as { code?: string }).code;
  return new ProviderError({
    provider,
    category: code === AIErrorCode.RATE_LIMIT_EXCEEDED ? "rate_limited" : "connection",
    message: error instanceof Error ? error.message : "Provider failure",
    dispatched: true,
  });
}

interface ChainEntry {
  id: AIProviderId;
  adapter: AIProviderAdapter;
}

interface RunState {
  attempts: StageAttemptRecord[];
  paidCalls: number;
  deadline: number;
  lastFailure: ProviderFailureCategory | null;
  cancelled: boolean;
}

export class ProviderOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** The configured external chain in order (primary first). */
  chain(): ChainEntry[] {
    const order = (this.deps.order ?? getProviderOrder)();
    return [order.primary, order.fallback]
      .filter((id): id is AIProviderId => id !== null)
      .map((id) => ({ id, adapter: this.deps.adapters[id] }));
  }

  hasConfiguredProvider(): boolean {
    return this.chain().some((entry) => entry.adapter.isAvailable());
  }

  async run(input: ChatRunInput): Promise<ChatRunOutcome> {
    const timing = (this.deps.timing ?? getRequestTimingConfig)();
    const state: RunState = { attempts: [], paidCalls: input.priorPaidCalls ?? 0, deadline: this.now() + timing.deadlineMs, lastFailure: null, cancelled: false };
    const chain = input.externalProvidersAllowed === false ? [] : this.chain();

    const analysis = await this.runStage(chain, 0, "analysis", state, timing, input, (adapter, options) =>
      adapter.analyzeQuery(input.message, { ...options, tokenBudget: input.tokenBudget, priorTurns: input.priorTurns }),
    );
    if (state.cancelled) return this.terminal(state, "unavailable", CANCELLED_REPLY, null, null);
    if (!analysis) return this.localAnalysis(state, input);

    const { result, index } = analysis;
    const analysisProvider = chain[index].id;
    const selection = enforceToolAllowlist(result.toolCalls, AI_TOOL_CALL_CAP);
    const base = {
      analysisProvider,
      executedToolCalls: selection.allowedCalls,
      blockedTools: selection.blockedCalls.map((call) => call.name),
      droppedTools: selection.droppedByCap.map((call) => call.name),
    };
    let tokenCount = Math.min(input.tokenBudget, result.tokenCount);

    if (selection.allowedCalls.length === 0) {
      const text = result.textResponse?.trim() ?? "";
      // Only disallowed calls proposed: a guardrail outcome, not an answer.
      if (text.length === 0 || base.blockedTools.length > 0) {
        return { ...this.terminal(state, "unavailable", NO_DATA_REPLY, analysisProvider, null, tokenCount), ...base };
      }
      return { ...this.terminal(state, MODE_BY_PROVIDER[analysisProvider], text, analysisProvider, analysisProvider, tokenCount), ...base };
    }

    const { toolResults, dataSanitized } = await this.executeTools(selection.allowedCalls, input);
    if (toolResults.length === 0) {
      return { ...this.terminal(state, "unavailable", NO_DATA_REPLY, analysisProvider, null, tokenCount), ...base, dataSanitized };
    }

    const remainingBudget = Math.max(0, input.tokenBudget - tokenCount);
    if (remainingBudget === 0) {
      return { ...this.terminal(state, "unavailable", INVALID_REQUEST_REPLY, analysisProvider, null, tokenCount), ...base, dataSanitized };
    }

    // The answer stage stays on the provider that analysed (or later ones).
    const answer = await this.runStage(chain, index, "answer", state, timing, input, (adapter, options) =>
      adapter.generateResponse(input.message, toolResults, input.currency, {
        ...options,
        tokenBudget: remainingBudget,
        maxOutputTokens: remainingBudget,
      }),
    );
    if (state.cancelled) return { ...this.terminal(state, "unavailable", CANCELLED_REPLY, analysisProvider, null, tokenCount), ...base, dataSanitized };

    if (answer) {
      const answerProvider = chain[answer.index].id;
      tokenCount = Math.min(input.tokenBudget, tokenCount + answer.result.tokenCount);
      return {
        ...this.terminal(state, MODE_BY_PROVIDER[answerProvider], answer.result.response, analysisProvider, answerProvider, tokenCount),
        ...base,
        dataSanitized,
      };
    }

    // A refusal of the explanation is final: nothing is explained locally.
    if (state.lastFailure === "safety_refusal") {
      return { ...this.terminal(state, "unavailable", REFUSAL_REPLY, analysisProvider, null, tokenCount), ...base, dataSanitized };
    }
    // Every answer provider failed: explain the SAME sanitised results locally.
    const local = state.lastFailure && !permitsLocalMode(state.lastFailure)
      ? null
      : input.renderLocal(toolResults.map((entry) => entry.result), this.localContext(state));
    return local
      ? { ...this.terminal(state, "local", local, analysisProvider, "local", tokenCount), ...base, dataSanitized }
      : { ...this.terminal(state, "unavailable", NO_DATA_REPLY, analysisProvider, null, tokenCount), ...base, dataSanitized };
  }

  private async localAnalysis(state: RunState, input: ChatRunInput): Promise<ChatRunOutcome> {
    if (state.lastFailure === "safety_refusal") return this.terminal(state, "unavailable", REFUSAL_REPLY, null, null);
    if (state.lastFailure === "invalid_request") return this.terminal(state, "unavailable", INVALID_REQUEST_REPLY, null, null);

    const local = await input.runLocal(this.localContext(state));
    return {
      ...this.terminal(state, local.useful ? "local" : "unavailable", local.reply, local.useful ? "local" : null, local.useful ? "local" : null, local.tokenCount),
      executedToolCalls: local.executedToolCalls,
      dataSanitized: local.dataSanitized,
    };
  }

  private async executeTools(
    calls: ProviderToolCall[],
    input: ChatRunInput,
  ): Promise<{ toolResults: ToolResultForPrompt[]; dataSanitized: boolean }> {
    const toolResults: ToolResultForPrompt[] = [];
    let dataSanitized = true;
    for (const call of calls) {
      const result = await input.executeTool(call);
      // Any executed tool whose data was not sanitised makes the attestation false.
      if (result.sanitized === false) dataSanitized = false;
      if (result.success && result.data !== undefined && result.sanitized) {
        toolResults.push({ name: call.name, result: result.data });
      }
    }
    return { toolResults, dataSanitized };
  }

  private async runStage<T extends ProviderCallMeta>(
    chain: ChainEntry[],
    startIndex: number,
    stage: AIStage,
    state: RunState,
    timing: RequestTimingConfig,
    input: ChatRunInput,
    call: (adapter: AIProviderAdapter, options: { signal: AbortSignal; timeoutMs: number }) => Promise<T>,
  ): Promise<{ result: T; index: number } | null> {
    for (let index = startIndex; index < chain.length; index += 1) {
      const { id, adapter } = chain[index];
      const ordinal = state.attempts.length + 1;
      // `isAvailable` is the gate; the issue only labels why it is closed.
      const issue = adapter.isAvailable() ? null : (adapter.configurationIssue?.() ?? "unconfigured");
      if (issue) {
        this.record(state, { ordinal, stage, adapter: chain[index], outcome: "skipped", category: issue, dispatched: false, started: this.now() });
        state.lastFailure = issue;
        continue;
      }
      const hasLaterProvider = index < chain.length - 1;
      const timeoutMs = this.callTimeout(state, timing, hasLaterProvider);
      if (timeoutMs === null || state.paidCalls >= timing.maxPaidCalls) {
        this.record(state, { ordinal, stage, adapter: chain[index], outcome: "skipped", category: "timeout", dispatched: false, started: this.now() });
        state.lastFailure = "timeout";
        // Review fix P2-1: the reserve only protects the fallback. When the
        // primary has no usable window, hand the remainder to the fallback.
        if (timeoutMs === null && hasLaterProvider && state.paidCalls < timing.maxPaidCalls) continue;
        return null;
      }
      if (input.signal?.aborted) {
        state.cancelled = true;
        return null;
      }
      const claim: AttemptClaim = {
        stage, provider: id, ordinal, model: adapter.configuredModel?.() ?? null, timeoutMs, requestDeadlineAt: state.deadline,
      };
      const { refusal, attemptId } = await this.claimOrRefusal(claim, input);
      if (refusal) {
        // A refused claim (no cap, cap reached) dispatched nothing. A reached
        // cap ("billing") is final for paid work: no fallback bypasses it.
        this.record(state, { ordinal, stage, adapter: chain[index], outcome: "skipped", category: refusal, dispatched: false, started: this.now() });
        state.lastFailure = refusal;
        if (isFailoverEligible(refusal)) continue;
        return null;
      }

      // Astra #255 r3: the claim may have waited on its locks. The call gets
      // only what is left of the request deadline; none left, it never starts.
      const dispatchTimeoutMs = this.callTimeout(state, timing, hasLaterProvider);
      if (dispatchTimeoutMs === null) {
        await this.settle(input, this.record(state, {
          ordinal, stage, adapter: chain[index], outcome: "failed", category: "timeout", dispatched: false, started: this.now(), attemptId,
        }));
        state.lastFailure = "timeout";
        if (hasLaterProvider) continue;
        return null;
      }
      try {
        await input.beforeDispatch?.(claim);
      } catch (error) {
        await this.settle(input, this.record(state, {
          ordinal, stage, adapter: chain[index], outcome: "failed", category: "cancelled", dispatched: false, started: this.now(), attemptId,
        }));
        throw error;
      }
      const started = this.now();
      const callTimeoutMs = Math.min(timeoutMs, dispatchTimeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(callTimeoutMs)]) : AbortSignal.timeout(callTimeoutMs);
      state.paidCalls += 1;
      try {
        const result = await call(adapter, { signal, timeoutMs: callTimeoutMs });
        if (input.signal?.aborted) {
          // A late result after cancellation is ignored, never written.
          await this.settle(input, this.record(state, { ordinal, stage, adapter: chain[index], outcome: "failed", category: "cancelled", dispatched: true, started, meta: result, attemptId }));
          state.cancelled = true;
          return null;
        }
        if (signal.aborted) {
          // Astra r2: an answer that lands after the stage timeout is discarded
          // as a timeout (usage still recorded), and the chain moves on.
          await this.settle(input, this.record(state, { ordinal, stage, adapter: chain[index], outcome: "failed", category: "timeout", dispatched: true, started, meta: result, attemptId }));
          state.lastFailure = "timeout";
          continue;
        }
        await this.settle(input, this.record(state, { ordinal, stage, adapter: chain[index], outcome: "succeeded", category: null, dispatched: true, started, meta: result, attemptId }));
        return { result, index };
      } catch (error) {
        const failure = normaliseProviderFailure(error, id);
        if (!failure) throw error;
        const category = input.signal?.aborted ? "cancelled" : failure.category;
        await this.settle(input, this.record(state, {
          ordinal, stage, adapter: chain[index], outcome: "failed", category, dispatched: failure.dispatched, started,
          meta: { usage: failure.usage, providerRequestId: failure.providerRequestId }, attemptId,
        }));
        state.lastFailure = category;
        if (category === "cancelled") {
          state.cancelled = true;
          return null;
        }
        if (!isFailoverEligible(category)) return null;
      }
    }
    return null;
  }

  /** Run the claim hooks; a typed ProviderError refuses the attempt, anything else propagates. */
  private async claimOrRefusal(
    claim: AttemptClaim,
    input: ChatRunInput,
  ): Promise<{ refusal: ProviderFailureCategory | null; attemptId?: string }> {
    try {
      await this.deps.beforeAttempt?.(claim);
      const ticket = await input.beforeAttempt?.(claim);
      return { refusal: null, attemptId: ticket ? ticket.attemptId : undefined };
    } catch (error) {
      if (isProviderError(error) && !error.dispatched) return { refusal: error.category };
      throw error;
    }
  }

  private localContext(state: RunState): LocalRenderContext {
    return { providerAttempted: state.attempts.some((attempt) => attempt.dispatched) };
  }

  private callTimeout(state: RunState, timing: RequestTimingConfig, hasLaterProvider: boolean): number | null {
    const remaining = state.deadline - this.now();
    const usable = hasLaterProvider ? remaining - timing.fallbackReserveMs : remaining;
    const timeout = Math.min(timing.stageTimeoutMs, usable);
    return timeout >= MIN_AI_CALL_TIMEOUT_MS ? timeout : null;
  }

  private record(
    state: RunState,
    entry: {
      ordinal: number;
      stage: AIStage;
      adapter: ChainEntry;
      outcome: StageAttemptRecord["outcome"];
      category: ProviderFailureCategory | null;
      dispatched: boolean;
      started: number;
      meta?: ProviderCallMeta;
      attemptId?: string;
    },
  ): StageAttemptRecord {
    const record: StageAttemptRecord = {
      ordinal: entry.ordinal,
      stage: entry.stage,
      provider: entry.adapter.id,
      model: entry.meta?.model ?? entry.adapter.adapter.configuredModel?.() ?? null,
      outcome: entry.outcome,
      category: entry.category,
      dispatched: entry.dispatched,
      usage: entry.meta?.usage ?? UNKNOWN_USAGE,
      providerRequestId: entry.meta?.providerRequestId ?? null,
      durationMs: Math.max(0, this.now() - entry.started),
      ...(entry.attemptId ? { attemptId: entry.attemptId } : {}),
    };
    state.attempts.push(record);
    return record;
  }

  private async settle(input: ChatRunInput, record: StageAttemptRecord): Promise<void> {
    await input.afterAttempt?.(record);
  }

  private terminal(
    state: RunState,
    mode: AnswerMode,
    reply: string,
    analysisProvider: StageProvider,
    answerProvider: StageProvider,
    tokenCount = 0,
  ): ChatRunOutcome {
    return {
      mode,
      reply,
      analysisProvider,
      answerProvider,
      executedToolCalls: [],
      blockedTools: [],
      droppedTools: [],
      tokenCount,
      dataSanitized: true,
      attempts: state.attempts,
      transmissionAttempted: state.attempts.some((attempt) => attempt.dispatched),
      failureCategory: mode === "unavailable" || mode === "local" ? state.lastFailure : null,
      cancelled: state.cancelled,
    };
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
