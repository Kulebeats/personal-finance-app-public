import { analyticsCache } from "./AnalyticsCache";
import { logger } from "../utils/logger";
import { OrdinaryAnalyticsInvalidationError } from "./ordinary-analytics-invalidation";

/**
 * Cache Invalidation Service
 *
 * Maps entity changes to affected analytics endpoints for cache invalidation.
 * Per V7 spec Section 7.3.
 */

// FIX PERF-REPORTS-002: Expand invalidation map to include new analytics endpoints
// Map of entity types to analytics endpoints that should be invalidated
const INVALIDATION_MAP = {
  transaction: [
    "cashflow",
    "spendingBreakdown",
    "spendingTrend",
    "annual",
    "sankey",
    "income",
    "savingsRate",
    "transactions",
    "financialRatios", // Uses transaction data for ratio calculations
    "debtAnalysis", // Uses transaction data for debt analysis
    "expenseClassification", // Uses transaction data for classification
    "forecast", // Uses historical transaction data for forecasting
    "customChart", // May use transaction data in custom charts
    "goalsProgress", // Whether a goal's progress is visible follows its linked transactions
  ],
  account: [
    "netWorth",
    "dashboard",
    "netWorthChanges", // Uses account balance snapshots
    "financialRatios", // Uses account balances for ratio calculations
    "debtAnalysis", // Uses debt account balances
    "goalsProgress", // Whether a goal's progress is visible follows account privacy
  ],
  category: [
    "spendingBreakdown",
    "annual",
    "sankey",
    "expenseClassification", // Uses category data
    "subcategoryBreakdown", // Uses subcategory data
  ],
  budget: [
    "dashboard",
    "forecast", // Uses budget data for forecasting
    "cashflow", // includeForecast responses share the cashflow endpoint key.
  ],
  goal: [
    "goalsProgress", // Uses goal data for progress tracking
  ],
} as const;

type InvalidationEntity = keyof typeof INVALIDATION_MAP;

/**
 * Invalidate analytics cache when an entity changes
 */
export async function invalidateOnChange(
  entity: InvalidationEntity,
  householdId: string
): Promise<void> {
  const endpoints = INVALIDATION_MAP[entity];

  if (!endpoints) {
    logger.warn("Unknown entity for cache invalidation", { entity });
    return;
  }

  logger.debug("Invalidating cache for entity change", {
    entity,
    householdId,
    endpoints,
  });

  const outcomes = await Promise.allSettled(
    endpoints.map((endpoint) =>
      analyticsCache.invalidateEndpoint(endpoint, householdId)
    )
  );
  const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  // A concurrent ordinary failure must not conceal a required profile refusal.
  const requiredFailure = failures.find(outcome => !(outcome.reason instanceof OrdinaryAnalyticsInvalidationError));
  if (requiredFailure) throw requiredFailure.reason;
  if (failures.length > 0) throw failures[0].reason;
}

/** Optional ordinary cache work after commit must not fail an already completed write. */
export async function invalidateOnChangeAfterCommit(
  entity: InvalidationEntity,
  householdId: string,
): Promise<void> {
  try {
    await invalidateOnChange(entity, householdId);
  } catch (error) {
    // A required injected profile refusal is not an ordinary cache fallback.
    if (!(error instanceof OrdinaryAnalyticsInvalidationError)) throw error;
    logger.warn("Optional analytics cache invalidation failed after commit", { entity, householdId, error });
  }
}

/**
 * Invalidate all analytics cache for a household
 * Use when major changes occur (e.g., bulk import, account deletion)
 */
export async function invalidateAll(householdId: string): Promise<void> {
  logger.info("Invalidating all analytics cache", { householdId });
  await analyticsCache.invalidateHousehold(householdId);
}
