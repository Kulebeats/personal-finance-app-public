import { createHash } from "crypto";
import { productionRedis } from "../config/redis";
import { logger } from "../utils/logger";
import { createOrdinaryAnalyticsBackend, type AnalyticsCacheBackend } from "./analytics-cache-backend";
import type { AnalyticsEndpoint } from "../config/redis/keys.mjs";

const CACHE_VERSION = 1; // Increment to invalidate all caches

// TTLs in seconds
const CACHE_TTLS: Record<string, number> = {
  dashboard: 300, // 5 min
  cashflow: 300, // 5 min
  spendingBreakdown: 300, // 5 min
  spendingTrend: 180, // 3 min
  annual: 900, // 15 min
  netWorth: 600, // 10 min
  sankey: 600, // 10 min
  income: 300, // 5 min
  savingsRate: 300, // 5 min
  transactions: 60, // 1 min
  // New endpoints
  financialRatios: 300,
  debtAnalysis: 300,
  expenseClassification: 300,
  goalsProgress: 60,
  subcategoryBreakdown: 300,
  forecast: 300,
  customChart: 300,
};

interface CacheEntry<T> {
  data: T;
  generatedAt: string;
}

export class AnalyticsCache {
  constructor(private readonly backend: AnalyticsCacheBackend | null = productionRedis?.analytics ?? createOrdinaryAnalyticsBackend()) {}

  private generateKey(
    endpoint: string,
    householdId: string,
    params: Record<string, unknown>,
  ): string {
    // REPORTS-CACHE-001 FIX: Ensure userId is always included in cache key
    // to prevent cross-user cache pollution
    const userId = params.userId as string | undefined;
    if (!userId) {
      logger.warn("Cache key generated without userId", { endpoint, householdId });
    }

    // stable stringify for params to ensure consistent hash
    const stableParams = Object.keys(params)
      .sort()
      .reduce(
        (obj, key) => {
          obj[key] = params[key];
          return obj;
        },
        {} as Record<string, unknown>,
      );

    const hash = createHash("md5")
      .update(JSON.stringify(stableParams))
      .digest("hex")
      .substring(0, 12);

    // Include userId explicitly in key structure for security visibility
    // householdId and userId provide tenant isolation, hash provides query uniqueness
    const userSegment = userId ? `:${userId}` : "";
    return `analytics:${endpoint}:${householdId}${userSegment}:v${CACHE_VERSION}:${hash}`;
  }

  /**
   * Get cached value or compute and cache it
   */
  async getOrCompute<T>(
    endpoint: keyof typeof CACHE_TTLS,
    householdId: string,
    params: Record<string, unknown>,
    compute: () => Promise<T>,
  ): Promise<T & { generatedAt: string }> {
    // If Redis is not available, just compute and return with current time
    const backend = this.backend;
    backend?.assertCurrent();
    // A calculation started before a ledger or visibility change can finish after cache invalidation.
    // Read balance-sensitive reports live, including ratios whose FX rates change at household midnight.
    const liveRead = endpoint === "netWorth" || endpoint === "netWorthChanges" || endpoint === "financialRatios"
      || endpoint === "debtAnalysis" || endpoint === "budgetComparison"
      || (endpoint === "cashflow" && params.includeForecast === true);
    if (!backend || liveRead) {
      const result = await compute();
      backend?.assertCurrent();
      return { ...result, generatedAt: new Date().toISOString() };
    }

    const key = this.generateKey(endpoint, householdId, params);
    const ttl = CACHE_TTLS[endpoint] || 300;

    // An injected required binding rejects failures; ordinary optional fallback
    // lives in its backend and cannot swallow a profile-generation refusal.
    const cached = await backend.getJson<CacheEntry<T>>(key);
    backend.assertCurrent();
    if (cached !== null) {
      // Handle legacy cache format if any exists (though version bump should prevent this)
      if (cached.generatedAt) {
        return { ...cached.data, generatedAt: cached.generatedAt };
      }
      // Fallback for raw data if ever encountered
      return {
        ...(cached as unknown as T),
        generatedAt: new Date().toISOString(),
      };
    }

    // Compute
    const result = await compute();
    backend.assertCurrent();
    const generatedAt = new Date().toISOString();
    const entry: CacheEntry<T> = { data: result, generatedAt };

    await backend.setJson(key, entry, ttl);
    backend.assertCurrent();

    return { ...result, generatedAt };
  }

  /**
   * Invalidate all keys for a specific household
   * REPORTS-CACHE-001: Updated pattern to handle new key structure with userId
   */
  async invalidateHousehold(householdId: string): Promise<void> {
    if (!this.backend) return;
    this.backend.assertCurrent();
    await this.backend.invalidate({ scope: "household", householdId });
    this.backend.assertCurrent();
  }

  /**
   * Invalidate specific endpoint for a household
   * REPORTS-CACHE-001: Updated pattern to handle new key structure with userId
   */
  async invalidateEndpoint(
    endpoint: AnalyticsEndpoint,
    householdId: string,
  ): Promise<void> {
    if (!this.backend) return;
    this.backend.assertCurrent();
    await this.backend.invalidate({ scope: "endpoint", endpoint, householdId });
    this.backend.assertCurrent();
  }
}

export const analyticsCache = new AnalyticsCache();
