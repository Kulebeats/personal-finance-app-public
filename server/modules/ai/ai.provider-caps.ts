/**
 * R17 slice 2: paid providers fail closed without an operator call cap.
 *
 * `withCallCapGate` wraps an adapter so that "configured" also requires a cap
 * (AI_<PROVIDER>_DAILY_CALL_CAP). Without one the provider is unavailable and
 * labelled `unconfigured`, history is never loaded for it, and Thandi answers
 * in the labelled local mode. Whether the cap is already reached is decided
 * atomically when an attempt is claimed (ai.admission.repository).
 *
 * @module ai/ai.provider-caps
 */
import { claudeClient } from "./ai.claude";
import { geminiClient } from "./ai.gemini";
import { getProviderCallCap } from "./ai.provider-config";
import type { AIProviderAdapter, AIProviderId } from "./ai.provider.types";

/** `id` is the slot the adapter fills (legacy stubs may not carry their own). */
export function withCallCapGate(adapter: AIProviderAdapter, id: AIProviderId = adapter.id): AIProviderAdapter {
  const hasCap = () => getProviderCallCap(id) !== null;
  return {
    id,
    // Optional calls: legacy stubs predate these members (as in the orchestrator).
    configuredModel: () => adapter.configuredModel?.() ?? null,
    configurationIssue: () => adapter.configurationIssue?.() ?? (hasCap() ? null : "unconfigured"),
    isAvailable: () => adapter.isAvailable() && hasCap(),
    analyzeQuery: (message, options) => adapter.analyzeQuery(message, options),
    generateResponse: (message, results, currency, options) => adapter.generateResponse(message, results, currency, options),
  };
}

/** The raw provider clients (key + model); health reads these and the caps itself. */
export const providerClients: Readonly<Record<AIProviderId, AIProviderAdapter>> = {
  anthropic: claudeClient,
  gemini: geminiClient,
};

/** What chat dispatches through: every paid provider gated by its cap. */
export function capGatedAdapters(): Record<AIProviderId, AIProviderAdapter> {
  return { anthropic: withCallCapGate(claudeClient, "anthropic"), gemini: withCallCapGate(geminiClient, "gemini") };
}
