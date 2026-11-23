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
const tagRegistry = new Map<string, Map<string, object>>();

/**
 * Register a cache key under tags
 */
function registerTags(key: string, tags: string[]): void {
  for (const tag of tags) {
    const keys = tagRegistry.get(tag) || new Map<string, object>();
    keys.set(key, {});
    tagRegistry.set(tag, keys);
  }
}

/**
 * Invalidate all cache entries with a specific tag
 */
export async function invalidateTag(tag: string): Promise<number> {
  cacheStore.assertCurrent();
  const keys = tagRegistry.get(tag);
  if (!keys) return 0;
  const selected = Array.from(keys);
  if (selected.length > 10000) throw new Error("CACHE_TAG_INVALIDATION_REFUSED");
  let count = 0;
  for (const [key] of selected) {
    if (await cacheStore.deleteAsync(key)) count++;
    cacheStore.assertCurrent();
  }
  for (const [key, registration] of selected) {
    if (keys.get(key) === registration) keys.delete(key);
  }
  if (keys.size === 0 && tagRegistry.get(tag) === keys) tagRegistry.delete(tag);
  logger.debug("Cache tag invalidated", { tag, count });
  return count;
}

/**
 * Invalidate multiple tags
 */
export async function invalidateTags(tags: string[]): Promise<number> {
  cacheStore.assertCurrent();
  if (tags.length > 64) throw new Error("CACHE_TAG_INVALIDATION_REFUSED");
  let count = 0;
  for (const tag of tags) { count += await invalidateTag(tag); cacheStore.assertCurrent(); }
  return count;
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
    cacheStore.assertCurrent();
    // Check if we should skip caching
    if (skipCache?.(...args)) {
      const result = await fn(...args); cacheStore.assertCurrent(); return result;
    }

    // Generate cache key
    const key = keyGenerator
      ? keyGenerator(...args)
      : defaultKeyGenerator(prefix, args);

    // Try to get from cache
    const cached = await cacheStore.getAsync<TResult>(key);
    cacheStore.assertCurrent();
    if (cached !== undefined) {
      logger.debug("Cache hit", { key });
      return cached;
    }

    // Execute function and cache result
    const result = await fn(...args);
    cacheStore.assertCurrent();

    await cacheStore.setAsync(key, result, ttlMs);
    cacheStore.assertCurrent();

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
export async function invalidatePrefix(prefix: string): Promise<number> {
  cacheStore.assertCurrent();
  const pattern = `^${prefix}:`;
  const deleted = await cacheStore.deletePatternAsync(pattern);
  cacheStore.assertCurrent(); return deleted;
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
