import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import type { AnalyticsInvalidation } from '../config/redis/keys.mjs';
import { invalidateOrdinaryAnalytics } from './ordinary-analytics-invalidation';

export interface AnalyticsCacheBackend {
  assertCurrent(): void;
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  invalidate(filter: AnalyticsInvalidation): Promise<number>;
}

/** Ordinary optional cache behavior; production-profile bindings are injected explicitly. */
export function createOrdinaryAnalyticsBackend(): AnalyticsCacheBackend | null {
  const client = redis;
  if (!client) return null;
  return {
    assertCurrent() {},
    async getJson<T>(key: string): Promise<T | null> {
      try {
        const text = await client.get(key);
        return text === null ? null : JSON.parse(text) as T;
      } catch (error) {
        logger.warn('Redis get error, falling back to compute', { error });
        return null;
      }
    },
    async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      try { await client.setex(key, ttlSeconds, JSON.stringify(value)); }
      catch (error) { logger.warn('Redis set error', { error }); }
    },
    invalidate: filter => invalidateOrdinaryAnalytics(client, filter),
  };
}
