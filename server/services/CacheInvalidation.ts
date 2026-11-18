import { analyticsCache } from "./AnalyticsCache";
import { logger } from "../utils/logger";

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
  ],
  account: [
    "netWorth",
    "dashboard",
    "netWorthChanges", // Uses account balance snapshots
    "financialRatios", // Uses account balances for ratio calculations
    "debtAnalysis", // Uses debt account balances
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

  await Promise.all(
    endpoints.map((endpoint) =>
      analyticsCache.invalidateEndpoint(endpoint, householdId)
    )
  );
}

/**
 * Invalidate all analytics cache for a household
 * Use when major changes occur (e.g., bulk import, account deletion)
 */
export async function invalidateAll(householdId: string): Promise<void> {
  logger.info("Invalidating all analytics cache", { householdId });
  await analyticsCache.invalidateHousehold(householdId);
}
