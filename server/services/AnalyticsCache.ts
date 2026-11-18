import { redis } from "../config/redis";
import { createHash } from "crypto";
import { logger } from "../utils/logger";

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
  netWorthChanges: 600,
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
    if (!redis) {
      const result = await compute();
      return { ...result, generatedAt: new Date().toISOString() };
    }

    const key = this.generateKey(endpoint, householdId, params);
    const ttl = CACHE_TTLS[endpoint] || 300;

    try {
      // Try cache first
      const cached = await redis.get(key);
      if (cached) {
        const entry = JSON.parse(cached) as CacheEntry<T>;
        // Handle legacy cache format if any exists (though version bump should prevent this)
        if (entry.generatedAt) {
          return { ...entry.data, generatedAt: entry.generatedAt };
        }
        // Fallback for raw data if ever encountered
        return {
          ...(entry as unknown as T),
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      logger.warn("Redis get error, falling back to compute", { error });
    }

    // Compute
    const result = await compute();
    const generatedAt = new Date().toISOString();
    const entry: CacheEntry<T> = { data: result, generatedAt };

    try {
      // Cache result with wrapper
      await redis.setex(key, ttl, JSON.stringify(entry));
    } catch (error) {
      logger.warn("Redis set error", { error });
    }

    return { ...result, generatedAt };
  }

  /**
   * Invalidate all keys for a specific household
   * REPORTS-CACHE-001: Updated pattern to handle new key structure with userId
   */
  async invalidateHousehold(householdId: string): Promise<void> {
    if (!redis) return;

    try {
      // Pattern matches both with and without userId segment for backwards compatibility
      const pattern = `analytics:*:${householdId}*:v${CACHE_VERSION}:*`;
      const stream = redis.scanStream({
        match: pattern,
        count: 100,
      });

      stream.on("data", (keys: string[]) => {
        if (keys.length) {
          const pipeline = redis!.pipeline();
          keys.forEach((key) => pipeline.del(key));
          pipeline.exec();
        }
      });

      stream.on("end", () => {
        // scan complete
      });
    } catch (error) {
      logger.error("Cache invalidation error", { error });
    }
  }

  /**
   * Invalidate specific endpoint for a household
   * REPORTS-CACHE-001: Updated pattern to handle new key structure with userId
   */
  async invalidateEndpoint(
    endpoint: string,
    householdId: string,
  ): Promise<void> {
    if (!redis) return;

    try {
      // Pattern matches both with and without userId segment for backwards compatibility
      const pattern = `analytics:${endpoint}:${householdId}*:v${CACHE_VERSION}:*`;
      const stream = redis.scanStream({
        match: pattern,
        count: 100,
      });

      stream.on("data", (keys: string[]) => {
        if (keys.length) {
          const pipeline = redis!.pipeline();
          keys.forEach((key) => pipeline.del(key));
          pipeline.exec();
        }
      });
    } catch (error) {
      logger.error("Cache endpoint invalidation error", { error });
    }
  }
}

export const analyticsCache = new AnalyticsCache();
