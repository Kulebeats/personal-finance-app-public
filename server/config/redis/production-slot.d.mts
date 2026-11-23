import type { ProductionRedisApplication } from './production.mjs';
/** Null means never installed. Installed revocation always throws. */
export function getProductionRedis(): Readonly<ProductionRedisApplication> | null;
