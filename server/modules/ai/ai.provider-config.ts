/**
 * Thandi provider configuration (R17.1, master §3 configuration contract).
 *
 * Model ids come from the environment only. There is deliberately no default
 * model: an adapter with a key but no model reports `unconfigured` rather than
 * silently calling a retired or more expensive model.
 *
 * Read lazily (per call) so tests and operators can change the environment
 * without a restart of the module graph.
 *
 * @module ai/ai.provider-config
 */

import type { AIProviderId } from "./ai.provider.types";

export const DEFAULT_AI_REQUEST_DEADLINE_MS = 30_000;
export const DEFAULT_AI_STAGE_TIMEOUT_MS = 12_000;
export const DEFAULT_AI_FALLBACK_RESERVE_MS = 8_000;
/** Below this a provider call cannot complete; the stage goes local instead. */
export const MIN_AI_CALL_TIMEOUT_MS = 1_000;
/** B1: at most three paid calls per logical request. */
export const MAX_AI_PAID_CALLS = 3;

const PROVIDER_IDS: readonly AIProviderId[] = ["anthropic", "gemini"];

function readNonEmpty(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readNonEmpty(name);
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : fallback;
}

function readProviderId(name: string, fallback: AIProviderId | null): AIProviderId | null {
  const raw = readNonEmpty(name);
  if (raw === null) return fallback;
  if (raw === "none") return null;
  return PROVIDER_IDS.find((id) => id === raw) ?? fallback;
}

export interface ProviderOrder {
  primary: AIProviderId | null;
  fallback: AIProviderId | null;
}

/** Claude primary, Gemini fallback unless the operator says otherwise. */
export function getProviderOrder(): ProviderOrder {
  const primary = readProviderId("AI_PRIMARY_PROVIDER", "anthropic");
  const fallback = readProviderId("AI_FALLBACK_PROVIDER", "gemini");
  return { primary, fallback: fallback === primary ? null : fallback };
}

export interface ProviderCredentials {
  apiKey: string | null;
  model: string | null;
}

export function getAnthropicConfig(): ProviderCredentials {
  return { apiKey: readNonEmpty("ANTHROPIC_API_KEY"), model: readNonEmpty("ANTHROPIC_MODEL") };
}

export function getGeminiConfig(): ProviderCredentials {
  return { apiKey: readNonEmpty("GEMINI_API_KEY"), model: readNonEmpty("GEMINI_MODEL") };
}

export interface RequestTimingConfig {
  deadlineMs: number;
  stageTimeoutMs: number;
  fallbackReserveMs: number;
  maxPaidCalls: number;
}

export function getRequestTimingConfig(): RequestTimingConfig {
  return {
    deadlineMs: readPositiveInt("AI_REQUEST_DEADLINE_MS", DEFAULT_AI_REQUEST_DEADLINE_MS),
    stageTimeoutMs: readPositiveInt("AI_STAGE_TIMEOUT_MS", DEFAULT_AI_STAGE_TIMEOUT_MS),
    fallbackReserveMs: readPositiveInt("AI_FALLBACK_RESERVE_MS", DEFAULT_AI_FALLBACK_RESERVE_MS),
    maxPaidCalls: MAX_AI_PAID_CALLS,
  };
}

/** Rolling window for the per-provider paid-call cap. */
export const AI_PROVIDER_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

const CALL_CAP_ENV: Readonly<Record<AIProviderId, string>> = {
  anthropic: "AI_ANTHROPIC_DAILY_CALL_CAP",
  gemini: "AI_GEMINI_DAILY_CALL_CAP",
};

/**
 * Operator ceiling on dispatched calls per provider and configured model in
 * the rolling window. Null (unset or not a positive integer) means the paid
 * provider is NOT enabled: Thandi fails closed until a cap is configured
 * (coordinator rule pending the OI-02 monetary caps).
 */
export function getProviderCallCap(provider: AIProviderId): number | null {
  const raw = readNonEmpty(CALL_CAP_ENV[provider]);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  // A positive safe integer, else fail closed (Astra #255 r4): parseInt of a
  // huge digit string rounds to an imprecise, effectively unlimited cap.
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
