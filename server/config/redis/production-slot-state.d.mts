import type { AdmittedProductionRedis, ProductionRedisApplication } from './production.mjs';
/** Private cell imports are restricted to the fixed getter/installer edges. */
export function readInstalledProductionRedis(): Readonly<ProductionRedisApplication> | null;
export function installInPrivateProductionRedisCell(admission: AdmittedProductionRedis): void;
