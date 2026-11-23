import type { PrivateRedisCredentialCapability } from '../../testing/production/redis-credentials.mjs';
import type { ProductionRedisOperations } from './production-operations.mjs';
import type { ProductionRedisRateLimitStore, RateLimitPrefix } from './production-rate-limit.mjs';
declare const productionRedisAdmission: unique symbol;
export type AdmittedProductionRedis = Readonly<{ [productionRedisAdmission]: true }>;
export interface RedisAdmissionProjection {
  readonly runId: string; readonly instanceId: string; readonly redisRunId: string;
  readonly credentialRef: string; readonly credentialGeneration: string; readonly connectionGeneration: string;
  readonly ownershipReceiptId: string; readonly endpoint: Readonly<{ host: '127.0.0.1'; port: number }>;
  readonly database: 0; readonly serverVersion: string; readonly aclUser: string; readonly keyPrefix: string;
}
export interface ProductionRedisApplication extends ProductionRedisOperations {
  readonly rateLimit: Readonly<{ createStore(prefix: RateLimitPrefix): ProductionRedisRateLimitStore }>;
}
export interface ProductionRedisConnectionOwner {
  revoke(): void;
  close(): Promise<Readonly<{ connectionGeneration: string; closed: true }>>;
  projection(): Readonly<RedisAdmissionProjection>;
}
/** Trusted bootstrap only; runtime brands reject public receipt substitutes. */
export function admitProductionRedis(input: Readonly<{
  manifest: unknown; service: unknown; credentials: PrivateRedisCredentialCapability; signal: AbortSignal;
}>): Promise<Readonly<{ admission: AdmittedProductionRedis; owner: Readonly<ProductionRedisConnectionOwner> }>>;
export function requireProductionRedis(admission: unknown): Readonly<ProductionRedisApplication>;
/** Trusted slot only; does not expose owner or secret material. */
export function onProductionRedisRevoked(admission: unknown, callback: () => void): () => void;
