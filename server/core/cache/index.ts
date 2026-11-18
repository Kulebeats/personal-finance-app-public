/**
 * Core Cache Module
 *
 * In-memory caching with TTL, tag-based invalidation,
 * and higher-order function support.
 *
 * @module core/cache
 */

// Cache store
export { cacheStore, type CacheStats, type CacheConfig } from "./store";

// Higher-order function
export {
  withCache,
  cached,
  invalidateTag,
  invalidateTags,
  invalidatePrefix,
  TTL,
  type CacheOptions,
} from "./withCache";
