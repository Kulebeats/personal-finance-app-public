export const APPLICATION_ENTRY = 'server/production-application.ts';
export const APPLICATION_ARTIFACT = 'dist/production-application.js';
export const PUBLIC_GETTER_SOURCE = 'server/config/redis/production-slot.mjs';
export const PUBLIC_GETTER_STAGE_PATH = '.runtime/trusted/server/config/redis/production-slot.mjs';
export const APPLICATION_GETTER_SPECIFIER = '../.runtime/trusted/server/config/redis/production-slot.mjs';
export const TRUSTED_ENTRY_POINTS = Object.freeze([
  PUBLIC_GETTER_SOURCE,
  'server/config/redis/production-slot-bootstrap.mjs',
]);
export const TRUSTED_MODULE_ALLOWLIST = Object.freeze([
  'server/config/redis/invalidation.mjs',
  'server/config/redis/keys.mjs',
  'server/config/redis/production-connection.mjs',
  'server/config/redis/production-diagnostics.mjs',
  'server/config/redis/production-operations.mjs',
  'server/config/redis/production-rate-limit.mjs',
  'server/config/redis/production-slot-bootstrap.mjs',
  'server/config/redis/production-slot-state.mjs',
  'server/config/redis/production-slot.mjs',
  'server/config/redis/production.mjs',
  'server/config/redis/rate-limit-protocol.mjs',
  'server/modules/health/redis-readiness.ts',
  'server/testing/production/layout.mjs',
  'server/testing/production/manifest.mjs',
  'server/testing/production/primitives.mjs',
  'server/testing/production/redis-credentials.mjs',
  'server/testing/production/redis-owned-lifetime.mjs',
  'server/testing/production/redis-owned-runtime.mjs',
  'server/testing/production/redis-owned-service.mjs',
  'server/testing/production/redis-owned-supervisor.mjs',
  'server/testing/production/security.mjs',
  'server/testing/production/services.mjs',
]);
export const AUTHORITY_SOURCE_MODULES = Object.freeze([
  'server/config/redis/production.mjs',
  'server/config/redis/production-slot-state.mjs',
  'server/config/redis/production-slot-bootstrap.mjs',
  'server/testing/production/manifest.mjs',
  'server/testing/production/redis-credentials.mjs',
  'server/testing/production/redis-owned-service.mjs',
]);

