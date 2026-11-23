/**
 * AI Caching Layer
 *
 * Legacy L1/L2 cache primitives. Tool-result reuse is disabled until cache
 * identity includes the current actor, visibility and data generation.
 * AI tools continue to read and sanitize current data on every request.
 *
 * @module ai/ai.cache
 */

import { logger } from '../../utils/logger';
import {
  productionRedis,
  redisGetJson,
  redisSetJson,
  redisDeleteByPrefix,
} from '../../config/redis';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ============================================================================
// TYPES
// ============================================================================

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
}

/** Whose view a cached tool result is: the household and the acting member. */
export interface CacheIdentity {
  householdId: string;
  userId: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

// ============================================================================
// AI CACHE CLASS
// ============================================================================

export class AICache {
  private cache: Map<string, CacheEntry>;
  private stats: CacheStats;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      evictions: 0
    };

    // The admitted R20 profile has no AI-cache namespace or user/generation
    // cache identity yet. Disable the optional cache rather than falling back
    // to household-only L1 entries or issuing rejected ai:* Redis operations.
    if (!productionRedis) this.startCleanup();
  }

  /**
   * Bypass tool-result reuse in every profile without bypassing its lease check.
   */
  isCacheable(_toolName: string): boolean {
    if (productionRedis) {
      productionRedis.assertCurrent();
    }
    return false;
  }

  /**
   * Generate a cache key for a tool call.
   */
  generateKey(
    identity: CacheIdentity,
    toolName: string,
    args: Record<string, unknown>
  ): string {
    // C3-08: a tool result is filtered for the member who asked, so the acting
    // member is part of the key. Household and tool stay first so
    // invalidateHousehold and invalidateTool still clear every member's entries.
    const { householdId, userId } = identity;
    if (!householdId || !userId) {
      throw new Error('AI cache key requires the household and the acting member');
    }

    // Sort args for consistent key generation
    const sortedArgs = Object.keys(args)
      .sort()
      .map(key => `${key}=${JSON.stringify(args[key])}`)
      .join('&');

    return `ai:${householdId}:${toolName}:${userId}:${sortedArgs}`;
  }

  /**
   * Get a cached result.
   */
  get<T>(key: string): T | null {
    if (productionRedis) {
      productionRedis.assertCurrent();
      return null;
    }
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return null;
    }

    // Cache hit
    entry.hitCount++;
    this.stats.hits++;

    logger.debug('AI cache hit', {
      key,
      hitCount: entry.hitCount,
      age: Date.now() - entry.createdAt
    });

    return entry.data as T;
  }

  /**
   * Set a cached result.
   */
  set<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
    if (productionRedis) {
      productionRedis.assertCurrent();
      return;
    }
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      hitCount: 0
    };

    this.cache.set(key, entry);
    this.stats.size = this.cache.size;

    logger.debug('AI cache set', {
      key,
      ttlMs,
      cacheSize: this.cache.size
    });
  }

  /**
   * Read-through get backed by the shared Redis cache (SCP-328).
   *
   * L1 = this in-process Map (fast, instance-local).
   * L2 = Redis (shared across instances, when configured).
   *
   * On an L1 miss it consults Redis; a Redis hit repopulates L1. When Redis is
   * not configured this behaves exactly like the synchronous in-memory `get`.
   */
  async getAsync<T>(key: string): Promise<T | null> {
    if (productionRedis) {
      productionRedis.assertCurrent();
      return null;
    }
    // L1: in-process cache.
    const local = this.get<T>(key);
    if (local !== null) {
      return local;
    }

    // L2: shared Redis cache.
    const remote = await redisGetJson<T>(key);
    if (remote !== null) {
      // Repopulate L1 so subsequent hits stay fast.
      this.set<T>(key, remote);
      this.stats.hits++;
      logger.debug('AI cache hit (redis)', { key });
      return remote;
    }

    return null;
  }

  /**
   * Write-through set: writes both L1 (in-process) and L2 (Redis) so other
   * instances can serve the cached result (SCP-328). A no-op on Redis when it
   * is not configured — L1 still holds the value.
   */
  async setAsync<T>(
    key: string,
    data: T,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    if (productionRedis) {
      productionRedis.assertCurrent();
      return;
    }
    this.set<T>(key, data, ttlMs);
    await redisSetJson<T>(key, data, Math.ceil(ttlMs / 1000) || DEFAULT_TTL_SECONDS);
  }

  /**
   * Invalidate all cached entries for a household.
   * Call this when data changes (transactions, budgets, goals, etc.).
   */
  invalidateHousehold(householdId: string): number {
    productionRedis?.assertCurrent();
    let count = 0;
    const prefix = `ai:${householdId}:`;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }

    // Clear the shared Redis layer too (fire-and-forget; no-op without Redis).
    if (!productionRedis) {
      void redisDeleteByPrefix(prefix).catch((error) =>
        logger.warn('AI cache redis invalidation failed', { householdId, error }),
      );
    }

    if (count > 0) {
      this.stats.evictions += count;
      this.stats.size = this.cache.size;

      logger.info('AI cache invalidated for household', {
        householdId,
        entriesRemoved: count
      });
    }

    return count;
  }

  /**
   * Invalidate specific tool results for a household.
   */
  invalidateTool(householdId: string, toolName: string): number {
    productionRedis?.assertCurrent();
    let count = 0;
    const prefix = `ai:${householdId}:${toolName}:`;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }

    // Clear the shared Redis layer too (fire-and-forget; no-op without Redis).
    if (!productionRedis) {
      void redisDeleteByPrefix(prefix).catch((error) =>
        logger.warn('AI cache redis tool invalidation failed', {
          householdId,
          toolName,
          error,
        }),
      );
    }

    if (count > 0) {
      this.stats.evictions += count;
      this.stats.size = this.cache.size;

      logger.debug('AI cache tool invalidated', {
        householdId,
        toolName,
        entriesRemoved: count
      });
    }

    return count;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0
    };
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.size = 0;
    this.stats.evictions += size;

    logger.info('AI cache cleared', { entriesRemoved: size });
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CACHE_CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.stats.evictions += removed;
      this.stats.size = this.cache.size;

      logger.debug('AI cache cleanup', {
        entriesRemoved: removed,
        remainingEntries: this.cache.size
      });
    }
  }

  /**
   * Stop the cache (for graceful shutdown).
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export singleton instance
export const aiCache = new AICache();

// ============================================================================
// CACHE INVALIDATION HELPERS
// ============================================================================

/**
 * Invalidate cache when transaction data changes.
 */
export function invalidateOnTransactionChange(householdId: string): void {
  // Transactions affect spending, budgets, trends, etc.
  aiCache.invalidateTool(householdId, 'get_spending_by_category');
  aiCache.invalidateTool(householdId, 'get_budget_status');
  aiCache.invalidateTool(householdId, 'get_merchant_spending');
  aiCache.invalidateTool(householdId, 'get_category_trends');
  aiCache.invalidateTool(householdId, 'get_monthly_summary');
  aiCache.invalidateTool(householdId, 'get_account_balances');
}

/**
 * Invalidate cache when goal data changes.
 */
export function invalidateOnGoalChange(householdId: string): void {
  aiCache.invalidateTool(householdId, 'get_goals_status');
  aiCache.invalidateTool(householdId, 'get_goal_assignments');
}

/**
 * Invalidate cache when budget data changes.
 */
export function invalidateOnBudgetChange(householdId: string): void {
  aiCache.invalidateTool(householdId, 'get_budget_status');
}

/**
 * Invalidate cache when recurring transaction rules change.
 */
export function invalidateOnRecurringChange(householdId: string): void {
  aiCache.invalidateTool(householdId, 'get_upcoming_recurring');
  aiCache.invalidateTool(householdId, 'get_cash_flow');
}

/**
 * Invalidate cache when account data changes.
 */
export function invalidateOnAccountChange(householdId: string): void {
  aiCache.invalidateTool(householdId, 'get_account_balances');
  aiCache.invalidateTool(householdId, 'get_cash_flow');
}
