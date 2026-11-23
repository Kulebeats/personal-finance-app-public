/**
 * Cache Store
 *
 * Cache with TTL support.
 * Uses Redis when configured and falls back to in-memory storage otherwise.
 *
 * @module core/cache/store
 */

import {
  isRedisEnabled,
  productionRedis,
  redisDeleteByPrefix,
  redisDeleteKey,
  redisGetJson,
  redisSetJson,
} from "../../config/redis";
import { logger } from "../../utils/logger";

/**
 * Cache entry with expiration and LRU tracking
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  defaultTtlMs: number;
  maxSize: number;
  checkIntervalMs: number;
}

export interface CacheRedisBackend {
  /** Required-component policy/fencing only; never establishes service admission. */
  assertCurrent?: () => void;
  isEnabled: () => boolean;
  getJson: <T>(key: string) => Promise<T | null>;
  setJson: <T>(key: string, value: T, ttlSeconds: number) => Promise<boolean>;
  deleteKey: (key: string) => Promise<boolean>;
  deleteByPrefix: (prefix: string) => Promise<number>;
}

const DEFAULT_REDIS_BACKEND: CacheRedisBackend = productionRedis?.cache ?? {
  isEnabled: isRedisEnabled,
  getJson: redisGetJson,
  setJson: redisSetJson,
  deleteKey: redisDeleteKey,
  deleteByPrefix: redisDeleteByPrefix,
};

/**
 * ARCHITECTURE: Cache Configuration
 *
 * Default settings balance memory usage with hit rate:
 * - defaultTtlMs: 5 minutes prevents stale data while improving response times
 * - maxSize: 10,000 entries limits memory footprint (~10-50MB typical)
 * - checkIntervalMs: 1 minute cleanup balances CPU usage with memory recovery
 */
const DEFAULT_CONFIG: CacheConfig = {
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxSize: 10000,
  checkIntervalMs: 60 * 1000, // Check every minute
};

/**
 * Cache store. The synchronous methods operate on the local fallback store.
 * Async methods use Redis as the source of truth when Redis is configured.
 */
export class CacheStore {
  private cache = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
  };
  private config: CacheConfig;
  private redisBackend: CacheRedisBackend;
  private readonly requiredAssert: (() => void) | undefined;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly redisKeyPrefix = "core-cache:";

  constructor(
    config: Partial<CacheConfig> = {},
    redisBackend: CacheRedisBackend = DEFAULT_REDIS_BACKEND,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.redisBackend = redisBackend;
    this.requiredAssert = redisBackend.assertCurrent?.bind(redisBackend);
    if (!this.requiresRemote) this.startCleanup();
  }

  assertCurrent(): void { this.requiredAssert?.(); }
  private get requiresRemote(): boolean { return this.requiredAssert !== undefined; }
  private localOnly(): void {
    this.assertCurrent();
    if (this.requiresRemote) throw new Error("CACHE_REQUIRED_ASYNC_ONLY");
  }
  private remoteEnabled(): boolean {
    this.assertCurrent();
    const enabled = this.redisBackend.isEnabled(); this.assertCurrent();
    if (this.requiresRemote && !enabled) throw new Error("CACHE_REQUIRED_BACKEND_REFUSED");
    return enabled;
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | undefined {
    this.localOnly();
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      this.updateSize();
      return undefined;
    }

    this.stats.hits++;
    // Update last access time for LRU
    entry.lastAccessedAt = Date.now();
    return entry.value as T;
  }

  /**
   * Get a value from Redis when configured, otherwise the local fallback.
   */
  async getAsync<T>(key: string): Promise<T | undefined> {
    if (this.remoteEnabled()) {
      const value = await this.redisBackend.getJson<T>(this.redisKey(key));
      this.assertCurrent();
      if (value !== null) {
        this.stats.hits++;
        return value;
      }

      this.stats.misses++;
      return undefined;
    }

    return this.get<T>(key);
  }

  /**
   * Set a value in the cache
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    this.localOnly();
    const ttl = ttlMs ?? this.config.defaultTtlMs;
    const now = Date.now();

    /**
     * BUSINESS RULE: LRU (Least Recently Used) Eviction
     *
     * When cache is full, we evict the least recently accessed entry.
     * This ensures frequently accessed data stays in cache while
     * rarely accessed data is removed first.
     *
     * LRU provides better cache efficiency than FIFO for typical access patterns.
     */
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      createdAt: now,
      lastAccessedAt: now,
    });

    this.stats.sets++;
    this.updateSize();
  }

  /**
   * Set a value in Redis when configured, otherwise the local fallback.
   */
  async setAsync<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.config.defaultTtlMs;

    if (this.remoteEnabled()) {
      const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
      const stored = await this.redisBackend.setJson(
        this.redisKey(key),
        value,
        ttlSeconds,
      );
      this.assertCurrent();

      if (stored) {
        this.stats.sets++;
        return;
      }
      if (this.requiresRemote) throw new Error("CACHE_REQUIRED_WRITE_REFUSED");
    }

    this.set(key, value, ttl);
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    this.localOnly();
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      this.updateSize();
    }
    return deleted;
  }

  /**
   * Delete a value from Redis when configured, otherwise the local fallback.
   */
  async deleteAsync(key: string): Promise<boolean> {
    if (this.remoteEnabled()) {
      const localDeleted = this.requiresRemote ? false : this.delete(key);
      const deleted = await this.redisBackend.deleteKey(this.redisKey(key));
      this.assertCurrent();
      if (deleted) {
        this.stats.deletes++;
        return true;
      }
      if (this.requiresRemote) return false;
      return localDeleted;
    }

    return this.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   */
  deletePattern(pattern: string): number {
    this.localOnly();
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.stats.deletes += count;
      this.updateSize();
    }

    return count;
  }

  /**
   * Delete all keys matching a prefix-compatible pattern from Redis when
   * configured, otherwise the local fallback.
   */
  async deletePatternAsync(pattern: string): Promise<number> {
    if (this.remoteEnabled()) {
      const redisPrefix = this.requiresRemote ? this.requiredRedisPrefix(pattern) : this.redisPrefixFromPattern(pattern);
      if (redisPrefix !== null) {
        const localDeleted = this.requiresRemote ? 0 : this.deletePattern(pattern);
        const deleted = await this.redisBackend.deleteByPrefix(
          this.redisKey(redisPrefix),
        );
        this.assertCurrent();
        if (deleted > 0) {
          this.stats.deletes += deleted;
          return deleted;
        }
        if (this.requiresRemote) return 0;
        return localDeleted;
      }
    }

    return this.deletePattern(pattern);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.localOnly();
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
    this.updateSize();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    this.localOnly();
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.updateSize();
      return false;
    }
    return true;
  }

  /**
   * Ping method for health checks
   *
   * Returns cache health status including:
   * - isHealthy: whether cache is operational
   * - stats: current cache statistics
   * - hitRate: cache hit rate percentage
   * - latencyMs: time to perform a test operation
   */
  ping(): {
    isHealthy: boolean;
    stats: CacheStats;
    hitRate: number;
    latencyMs: number;
  } {
    const start = Date.now();

    // Test cache operation
    const testKey = "__ping_test__";
    this.set(testKey, true, 1000);
    const retrieved = this.get<boolean>(testKey);
    this.delete(testKey);

    const latencyMs = Date.now() - start;
    const isHealthy = retrieved === true;

    return {
      isHealthy,
      stats: this.getStats(),
      hitRate: this.getHitRate(),
      latencyMs,
    };
  }

  /**
   * LRU Eviction: Remove least recently accessed entry
   */
  private evictOldest(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      this.updateSize();
    }
  }

  private updateSize(): void {
    this.stats.size = this.cache.size;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let evicted = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          evicted++;
        }
      }

      if (evicted > 0) {
        this.stats.evictions += evicted;
        this.updateSize();
        logger.debug("Cache cleanup", { evicted, remaining: this.cache.size });
      }
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private redisKey(key: string): string {
    return `${this.redisKeyPrefix}${key}`;
  }

  private requiredRedisPrefix(pattern: string): string {
    if (!pattern.startsWith("^")) throw new Error("CACHE_REQUIRED_PATTERN_REFUSED");
    let prefix = pattern.slice(1);
    if (prefix.endsWith(".*")) prefix = prefix.slice(0, -2);
    else if (prefix.endsWith("*")) prefix = prefix.slice(0, -1);
    if (!/^[\x21-\x7e]{1,512}$/.test(prefix) || /[\\[\]()+?{}|$^.*]/.test(prefix)) throw new Error("CACHE_REQUIRED_PATTERN_REFUSED");
    return prefix;
  }

  private redisPrefixFromPattern(pattern: string): string | null {
    let prefix = pattern.startsWith("^") ? pattern.slice(1) : pattern;
    const wildcardIndex = prefix.indexOf("*");
    if (wildcardIndex >= 0) {
      prefix = prefix.slice(0, wildcardIndex);
    }

    return /[\\[\]()+?{}|$]/.test(prefix) ? null : prefix;
  }
}

// Singleton instance
export const cacheStore = new CacheStore();
