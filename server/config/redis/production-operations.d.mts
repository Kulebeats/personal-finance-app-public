import type { AnalyticsCacheBackend } from '../../services/analytics-cache-backend';

/** Internal testable plumbing; this structural interface grants no service admission. */
export interface ProductionRedisOperationBinding {
  assertCurrent(): void;
  execute(command: readonly string[]): Promise<unknown>;
  runOperation<T>(action: () => Promise<T>): Promise<T>;
  revoke(): void;
}
export interface ProductionRedisCacheOperations {
  assertCurrent(): void;
  isEnabled(): true;
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
  deleteKey(key: string): Promise<boolean>;
  deleteByPrefix(prefix: string): Promise<number>;
}
export type RedisQuotaCounter = Readonly<{ count: number; ttlSeconds: number }>;
export interface ProductionRedisOperations {
  assertCurrent(): void;
  readonly cache: Readonly<ProductionRedisCacheOperations>;
  readonly analytics: Readonly<AnalyticsCacheBackend>;
  readonly readiness: Readonly<{ probe(signal: AbortSignal): Promise<void> }>;
  readonly quota: Readonly<{
    increment(key: string, ttlSeconds: number): Promise<RedisQuotaCounter>;
    read(key: string): Promise<RedisQuotaCounter | null>;
  }>;
}
export function createProductionRedisOperations(binding: ProductionRedisOperationBinding, runPrefix: string): Readonly<ProductionRedisOperations>;
