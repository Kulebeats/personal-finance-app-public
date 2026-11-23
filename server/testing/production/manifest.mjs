import { canonicalJson, parse, digest, check, shape, matches, hash, freeze, refuse } from './primitives.mjs';
import { validatePaths, validateBuild } from './layout.mjs';
import { validateEndpoints, validatePostgres, validateRedis } from './services.mjs';
import { validateTls, validateChromium, validatePolicy, validateTimeouts } from './security.mjs';
export { canonicalJson, digest } from './primitives.mjs';

const brand = new WeakSet();
const certifications = freeze({ filesystemIdentity: false, buildArtifactReadback: false, runtimeDependencyIdentity: false,
  liveDatabaseIdentity: false, liveSchemaIdentity: false, liveRedisIdentity: false, nativePgTls: false,
  chromiumTrust: false, egressEnforced: false, executionAuthorized: false });
export function requireProductionManifest(record) { check(brand.has(record)); return record; }

/** Supplied expectations are compared, never authenticated as owner provenance. */
export function readProductionManifest(text, callerExpectations) {
  try {
    const pins = parse(canonicalJson(callerExpectations));
    shape(pins, ['expectedManifestSha256', 'runId', 'profile', 'buildCommitSha', 'harnessCommitSha', 'approvalRef',
      'expectedArtifactsSha256', 'expectedServicesSha256', 'expectedSecuritySha256']);
    const value = parse(text);
    shape(value, ['kind', 'version', 'profile', 'runId', 'issuedAt', 'approvalRef', 'harnessCommitSha', 'paths', 'build', 'endpoints', 'postgres', 'redis', 'tls', 'chromium', 'policy', 'timeouts']);
    check(value.kind === 'pfa-production-profile' && value.version === 1 && value.profile === 'local-production-v1');
    matches(value.runId, /^[a-z][a-z0-9]{7,31}$/); matches(value.approvalRef, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/); hash(value.harnessCommitSha, 40);
    matches(value.issuedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    check(Number.isFinite(Date.parse(value.issuedAt)) && new Date(value.issuedAt).toISOString() === value.issuedAt);
    validatePaths(value.paths); validateBuild(value.build, value.paths); validateEndpoints(value.endpoints);
    validatePostgres(value.postgres, value.endpoints, value.runId); validateRedis(value.redis, value.postgres, value.runId);
    validateTls(value.tls, value.paths); validateChromium(value.chromium, value.paths, value.tls);
    validatePolicy(value.policy, value.endpoints.browserOrigin); validateTimeouts(value.timeouts);
    for (const key of ['expectedManifestSha256', 'expectedArtifactsSha256', 'expectedServicesSha256', 'expectedSecuritySha256']) hash(pins[key]);
    hash(pins.buildCommitSha, 40); hash(pins.harnessCommitSha, 40);
    check(pins.runId === value.runId && pins.profile === value.profile && pins.approvalRef === value.approvalRef &&
      pins.buildCommitSha === value.build.commitSha && pins.harnessCommitSha === value.harnessCommitSha);
    check(digest(text) === pins.expectedManifestSha256 && digest(canonicalJson(value.build.artifacts)) === pins.expectedArtifactsSha256);
    check(digest(canonicalJson({ endpoints: value.endpoints, postgres: value.postgres, redis: value.redis })) === pins.expectedServicesSha256);
    check(digest(canonicalJson({ tls: value.tls, chromium: value.chromium, policy: value.policy })) === pins.expectedSecuritySha256);
    const record = freeze({ kind: 'validated-production-profile', manifestSha256: pins.expectedManifestSha256, document: value, certifications });
    brand.add(record); return record;
  } catch { refuse(); }
}
