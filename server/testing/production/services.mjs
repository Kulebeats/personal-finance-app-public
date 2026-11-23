import { check, shape, integer, matches, hash, uuid } from './primitives.mjs';

export function endpoint(value) {
  shape(value, ['host', 'port']); check(value.host === '127.0.0.1'); integer(value.port, 65535);
  check(![80, 443, 5000, 5432, 55432, 6379].includes(value.port));
}
function exactVersion(value) { matches(value, /^[0-9]{1,3}(\.[0-9]{1,4}){1,3}$/); }
export function validateEndpoints(value) {
  const roles = ['terminator', 'backend', 'browserEgressProxy', 'postgres', 'redis']; shape(value, ['browserOrigin', ...roles]);
  for (const role of roles) endpoint(value[role]);
  check(new Set(roles.map((role) => value[role].port)).size === roles.length);
  check(value.browserOrigin === `https://127.0.0.1:${value.terminator.port}`);
}
export function validatePostgres(value, endpoints, runId) {
  shape(value, ['clusterId', 'serverVersion', 'target', 'expectedMarker', 'role', 'credentialRef', 'credentialGeneration', 'schema']);
  uuid(value.clusterId); uuid(value.credentialRef); uuid(value.credentialGeneration); matches(value.serverVersion, /^18\.[0-9]{1,4}$/);
  const target = value.target; shape(target, ['version', 'disposable', 'synthetic', 'host', 'port', 'database', 'runId']);
  endpoint({ host: target.host, port: target.port });
  check(target.version === 1 && target.disposable === true && target.synthetic === true && target.runId === runId);
  check(target.port === endpoints.postgres.port && target.database === `pfa_completion_r20_${runId}_test` && target.database.length <= 63);
  check(value.expectedMarker === `pfa-synthetic-test:v1:${runId}:${target.database}`);
  matches(value.role, /^[a-z_][a-z0-9_]{0,62}$/); check(!['postgres', 'root'].includes(value.role));
  shape(value.schema, ['sourceSha256', 'journalSha256', 'migrations']); hash(value.schema.sourceSha256); hash(value.schema.journalSha256);
  check(Array.isArray(value.schema.migrations) && value.schema.migrations.length > 0 && value.schema.migrations.length <= 128);
  let previous = '', when = 0;
  for (const migration of value.schema.migrations) {
    shape(migration, ['name', 'sha256', 'journalWhenMs']); matches(migration.name, /^[0-9]{4}_[a-z0-9_]{1,80}$/); hash(migration.sha256);
    integer(migration.journalWhenMs, Number.MAX_SAFE_INTEGER); check(migration.name > previous && migration.journalWhenMs > when);
    previous = migration.name; when = migration.journalWhenMs;
  }
}
export function validateRedis(value, postgres, runId) {
  shape(value, ['instanceId', 'serverVersion', 'transport', 'database', 'aclUser', 'credentialRef', 'credentialGeneration', 'keyPrefix']);
  uuid(value.instanceId); uuid(value.credentialRef); uuid(value.credentialGeneration); exactVersion(value.serverVersion);
  check(value.transport === 'tcp' && value.database === 0 && value.aclUser === `pfa_${runId}` && value.keyPrefix === `pfa:production:${runId}:`);
  check(value.credentialRef !== postgres.credentialRef && value.credentialGeneration !== postgres.credentialGeneration);
}
