import type RedisStore from 'rate-limit-redis';
import type { Options } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { ProductionRedisOperationBinding } from './production-operations.mjs';
export type RateLimitPrefix = 'rl:general:' | 'rl:analytics:' | 'rl:auth:' | 'rl:ipauth:' | 'rl:strict:' | 'rl:expensive:' | 'rl:upload:';
export type ProductionRedisRateLimitStore = Readonly<Pick<RedisStore, 'init' | 'get' | 'increment' | 'decrement' | 'resetKey'>>;
export function createProductionRedisStore(binding: ProductionRedisOperationBinding, runPrefix: string, prefix: RateLimitPrefix): ProductionRedisRateLimitStore;
export interface ProductionRateLimitApplication {
  assertCurrent(): void;
  readonly rateLimit: Readonly<{ createStore(prefix: RateLimitPrefix): ProductionRedisRateLimitStore }>;
}
export type ProductionRateLimitHandler = RateLimitRequestHandler;
export function createProductionRateLimiter(application: ProductionRateLimitApplication, prefix: RateLimitPrefix, options: Partial<Options>): ProductionRateLimitHandler;
