/**
 * Provider provenance for the ai_query audit row (R17, B7, AI-14).
 *
 * Records which provider handled each stage, every ordered attempt with its
 * model, outcome, failure category and usage, and whether anything was
 * transmitted. Usage stays `null` when unknown; it is never zero-filled.
 * Only safe metadata is recorded: no keys, prompts or raw provider payloads.
 *
 * @module ai/ai.provenance
 */

import type { ChatRunOutcome } from "./ai.provider-orchestrator";

export interface ProviderAttemptAudit {
  ordinal: number;
  stage: string;
  provider: string;
  model: string | null;
  outcome: string;
  failure_category: string | null;
  dispatched: boolean;
  usage_known: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  provider_request_id: string | null;
  duration_ms: number;
}

export interface ProviderAuditDetails {
  answer_mode: ChatRunOutcome["mode"];
  analysis_provider: ChatRunOutcome["analysisProvider"];
  answer_provider: ChatRunOutcome["answerProvider"];
  provider_attempts: ProviderAttemptAudit[];
  paid_calls: number;
  cancelled: boolean;
}

export function buildProviderAuditDetails(outcome: ChatRunOutcome): ProviderAuditDetails {
  const attempts = outcome.attempts.map((attempt) => ({
    ordinal: attempt.ordinal,
    stage: attempt.stage,
    provider: attempt.provider,
    model: attempt.model,
    outcome: attempt.outcome,
    failure_category: attempt.category,
    dispatched: attempt.dispatched,
    usage_known: attempt.usage.known,
    input_tokens: attempt.usage.inputTokens,
    output_tokens: attempt.usage.outputTokens,
    cache_read_tokens: attempt.usage.cacheReadTokens,
    cache_write_tokens: attempt.usage.cacheWriteTokens,
    provider_request_id: attempt.providerRequestId,
    duration_ms: attempt.durationMs,
  }));
  return {
    answer_mode: outcome.mode,
    analysis_provider: outcome.analysisProvider,
    answer_provider: outcome.answerProvider,
    provider_attempts: attempts,
    paid_calls: attempts.filter((attempt) => attempt.dispatched).length,
    cancelled: outcome.cancelled,
  };
}
