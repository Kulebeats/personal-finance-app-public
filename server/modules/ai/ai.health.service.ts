/**
 * R17 (17e, AI-14): provider health for GET /api/ai/status.
 *
 * "Configured" is not "healthy". Health is read from the durable attempt
 * ledger for the provider AND the currently configured model, over a short
 * window, so a new key or model starts "unverified" until it has actually
 * answered. Cancellations, refusals and invalid requests are the caller's
 * outcome and never colour a provider's health. Nothing household-specific
 * and no secret or billing detail is returned.
 *
 * @module ai/ai.health.service
 */
import { and, desc, eq, gt, isNull, notInArray, or } from "drizzle-orm";
import { aiAttempts } from "@shared/schema";
import { db } from "../../db";
import { getProviderCallCap, getProviderOrder } from "./ai.provider-config";
import { aiAdmissionRepository } from "./ai.admission.repository";
import type { AIProviderAdapter, AIProviderId, ProviderFailureCategory } from "./ai.provider.types";

export const AI_HEALTH_WINDOW_MS = 15 * 60 * 1000;
const NON_POISONING_CATEGORIES: ProviderFailureCategory[] = ["cancelled", "safety_refusal", "invalid_request"];

export type ProviderHealth = "unconfigured" | "unverified" | "healthy" | "unhealthy";
export type AIServiceState = "unconfigured" | "operational" | "degraded" | "outage";
/** Why a provider cannot be used right now; null when it can. */
export type ProviderUnavailableReason = "not_configured" | "no_cap" | "cap_reached";

export interface ProviderStatus {
  provider: AIProviderId;
  role: "primary" | "fallback";
  configured: boolean;
  model: string | null;
  health: ProviderHealth;
  lastCheckedAt: string | null;
  lastFailureCategory: string | null;
  unavailableReason: ProviderUnavailableReason | null;
}

export interface ServiceHealth {
  state: AIServiceState;
  providers: ProviderStatus[];
}

async function latestRelevantAttempt(provider: AIProviderId, model: string, since: Date) {
  const [row] = await db
    .select({ status: aiAttempts.status, category: aiAttempts.failureCategory, completedAt: aiAttempts.completedAt })
    .from(aiAttempts)
    .where(
      and(
        eq(aiAttempts.provider, provider),
        eq(aiAttempts.model, model),
        // A claim that never reached the provider says nothing about it (Astra #255 r4).
        notInArray(aiAttempts.status, ["dispatched", "not_dispatched"]),
        gt(aiAttempts.completedAt, since),
        or(isNull(aiAttempts.failureCategory), notInArray(aiAttempts.failureCategory, NON_POISONING_CATEGORIES)),
      ),
    )
    .orderBy(desc(aiAttempts.completedAt))
    .limit(1);
  return row;
}

async function providerStatus(
  provider: AIProviderId,
  role: ProviderStatus["role"],
  adapter: AIProviderAdapter,
  since: Date,
): Promise<ProviderStatus> {
  const keyedModel = adapter.isAvailable() ? adapter.configuredModel?.() ?? null : null;
  // A paid provider without an operator call cap fails closed (not configured).
  const cap = getProviderCallCap(provider);
  const model = cap === null ? null : keyedModel;
  const notConfigured = keyedModel === null ? "not_configured" : "no_cap";
  const base = {
    provider, role, configured: model !== null, model, lastCheckedAt: null, lastFailureCategory: null,
    unavailableReason: model === null ? notConfigured : null,
  } satisfies Partial<ProviderStatus>;
  if (model === null) return { ...base, health: "unconfigured" };
  const capped = cap !== null && (await aiAdmissionRepository.readProviderCalls(provider, model)) >= cap;
  const withCap = { ...base, unavailableReason: capped ? ("cap_reached" as const) : null };
  const latest = await latestRelevantAttempt(provider, model, since);
  if (!latest) return { ...withCap, health: "unverified" };
  const healthy = latest.status === "succeeded";
  return {
    ...withCap,
    health: healthy ? "healthy" : "unhealthy",
    lastCheckedAt: latest.completedAt?.toISOString() ?? null,
    lastFailureCategory: healthy ? null : latest.category,
  };
}

function overallState(providers: ProviderStatus[]): AIServiceState {
  const usable = (entry: ProviderStatus | undefined) =>
    entry !== undefined && entry.configured && entry.health !== "unhealthy" && entry.unavailableReason === null;
  if (!providers.some((entry) => entry.configured)) return "unconfigured";
  const primary = providers.find((entry) => entry.role === "primary");
  if (usable(primary)) return "operational";
  // Same rule as dispatch (Astra #255 r4): a reached primary cap is final for
  // paid work, so no fallback takes the request.
  if (primary?.unavailableReason === "cap_reached") return "outage";
  return providers.some(usable) ? "degraded" : "outage";
}

export async function readServiceHealth(
  adapters: Readonly<Record<AIProviderId, AIProviderAdapter>>,
  now: number = Date.now(),
): Promise<ServiceHealth> {
  const order = getProviderOrder();
  const since = new Date(now - AI_HEALTH_WINDOW_MS);
  const roles: Array<[AIProviderId | null, ProviderStatus["role"]]> = [[order.primary, "primary"], [order.fallback, "fallback"]];
  const providers = await Promise.all(
    roles
      .filter((entry): entry is [AIProviderId, ProviderStatus["role"]] => entry[0] !== null)
      .map(([id, role]) => providerStatus(id, role, adapters[id], since)),
  );
  return { state: overallState(providers), providers };
}
