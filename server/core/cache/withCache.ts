/**
 * Cache Higher-Order Function
 *
 * Wraps async functions with caching behavior.
 *
 * @module core/cache/withCache
 */

import { cacheStore } from "./store";
import { logger } from "../../utils/logger";

/**
 * Cache options for withCache
 */
export interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttlMs?: number;
  /** Custom key generator */
  keyGenerator?: (...args: unknown[]) => string;
  /** Tags for group invalidation */
  tags?: string[];
  /** Condition to skip caching */
  skipCache?: (...args: unknown[]) => boolean;
}

/**
 * Tag registry for invalidation
 */
const tagRegistry = new Map<string, Set<string>>();

/**
 * Register a cache key under tags
 */
function registerTags(key: string, tags: string[]): void {
  for (const tag of tags) {
    const keys = tagRegistry.get(tag) || new Set();
    keys.add(key);
    tagRegistry.set(tag, keys);
  }
}

/**
 * Invalidate all cache entries with a specific tag
 */
export function invalidateTag(tag: string): number {
  const keys = tagRegistry.get(tag);
  if (!keys) return 0;

  let count = 0;
  for (const key of keys) {
    if (cacheStore.delete(key)) {
      count++;
    }
    void cacheStore.deleteAsync(key).catch((error) =>
      logger.warn("Async cache tag invalidation failed", { tag, key, error }),
    );
  }

  tagRegistry.delete(tag);
  logger.debug("Cache tag invalidated", { tag, count });
  return count;
}

/**
 * Invalidate multiple tags
 */
export function invalidateTags(tags: string[]): number {
  return tags.reduce((acc, tag) => acc + invalidateTag(tag), 0);
}

/**
 * Default key generator using JSON serialization
 */
function defaultKeyGenerator(prefix: string, args: unknown[]): string {
  const argsHash = JSON.stringify(args);
  return `${prefix}:${argsHash}`;
}

/**
 * Higher-order function to wrap async functions with caching
 */
export function withCache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  prefix: string,
  options: CacheOptions = {}
): (...args: TArgs) => Promise<TResult> {
  const { ttlMs, keyGenerator, tags = [], skipCache } = options;

  return async (...args: TArgs): Promise<TResult> => {
    // Check if we should skip caching
    if (skipCache?.(...args)) {
      return fn(...args);
    }

    // Generate cache key
    const key = keyGenerator
      ? keyGenerator(...args)
      : defaultKeyGenerator(prefix, args);

    // Try to get from cache
    const cached = await cacheStore.getAsync<TResult>(key);
    if (cached !== undefined) {
      logger.debug("Cache hit", { key });
      return cached;
    }

    // Execute function and cache result
    const result = await fn(...args);

    await cacheStore.setAsync(key, result, ttlMs);

    // Register tags for invalidation
    if (tags.length > 0) {
      registerTags(key, tags);
    }

    logger.debug("Cache miss - stored", { key });
    return result;
  };
}

/**
 * Decorator-style caching for class methods
 */
export function cached(prefix: string, options: CacheOptions = {}) {
  return function <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >
  ) {
    const methodName = String(context.name);
    const fullPrefix = `${prefix}:${methodName}`;

    return function (this: This, ...args: Args): Promise<Return> {
      return withCache(
        (...a: Args) => target.call(this, ...a),
        fullPrefix,
        options
      )(...args);
    };
  };
}

/**
 * Invalidate cache by key prefix
 */
export function invalidatePrefix(prefix: string): number {
  const pattern = `^${prefix}:`;
  void cacheStore.deletePatternAsync(pattern).catch((error) =>
    logger.warn("Async cache prefix invalidation failed", { prefix, error }),
  );
  return cacheStore.deletePattern(pattern);
}

/**
 * Common TTL presets
 */
export const TTL = {
  SHORT: 30 * 1000, // 30 seconds
  MEDIUM: 5 * 60 * 1000, // 5 minutes
  LONG: 30 * 60 * 1000, // 30 minutes
  HOUR: 60 * 60 * 1000, // 1 hour
  DAY: 24 * 60 * 60 * 1000, // 24 hours
} as const;
