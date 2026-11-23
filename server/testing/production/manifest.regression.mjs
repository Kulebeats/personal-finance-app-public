import test from 'node:test';
import assert from 'node:assert/strict';
import { readProductionManifest, requireProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { manifestFixture, approvedFixturePins } from './manifest.fixture.mjs';
import { validatePaths } from './layout.mjs';

test('literal fixture pins accept a frozen copied record with all certifications false', () => {
  const value = manifestFixture(); const pins = { ...approvedFixturePins }; const record = readProductionManifest(canonicalJson(value), pins);
  assert.equal(requireProductionManifest(record), record);
  assert.equal(record.kind, 'validated-production-profile');
  assert.equal(record.manifestSha256, approvedFixturePins.expectedManifestSha256);
  assert.equal(Object.isFrozen(record.document.tls.postgres.ca.file), true);
  assert.deepEqual(record.certifications, { filesystemIdentity: false, buildArtifactReadback: false, runtimeDependencyIdentity: false,
    liveDatabaseIdentity: false, liveSchemaIdentity: false, liveRedisIdentity: false, nativePgTls: false,
    chromiumTrust: false, egressEnforced: false, executionAuthorized: false });
  assert.throws(() => { record.document.redis.database = 1; }, TypeError);
  value.endpoints.postgres.port = 5432; pins.runId = 'changed';
  assert.equal(record.document.endpoints.postgres.port, 55444);
  for (const fake of [structuredClone(record), record.document, { kind: record.kind }, null]) assert.throws(() => requireProductionManifest(fake), /PRODUCTION_MANIFEST_REFUSED/);
});

// Deliberately untrusted self-consistent pairs exercise STRUCTURE, not provenance.
// Never use this helper to supply the approved positive fixture expectations.
function untrustedPair(value) {
  return { ...approvedFixturePins, runId: value.runId, profile: value.profile, buildCommitSha: value.build.commitSha,
    harnessCommitSha: value.harnessCommitSha, approvalRef: value.approvalRef, expectedManifestSha256: digest(canonicalJson(value)),
    expectedArtifactsSha256: digest(canonicalJson(value.build.artifacts)),
    expectedServicesSha256: digest(canonicalJson({ endpoints: value.endpoints, postgres: value.postgres, redis: value.redis })),
    expectedSecuritySha256: digest(canonicalJson({ tls: value.tls, chromium: value.chromium, policy: value.policy })) };
}

for (const [name, change] of [
  ['unknown top key', (m) => { m.args = ['--ignore-certificate-errors']; }],
  ['wrong kind', (m) => { m.kind = 'ordinary'; }], ['wrong version', (m) => { m.version = 2; }],
  ['ordinary test profile', (m) => { m.profile = 'database'; }], ['ambiguous run', (m) => { m.runId = [m.runId]; }],
  ['invalid timestamp', (m) => { m.issuedAt = '2026-02-30T00:00:00.000Z'; }],
  ['wrong node', (m) => { m.build.nodeVersion = '20.0.0'; }], ['bad code hash', (m) => { m.build.commitSha = '0'.repeat(40); }],
  ['origin downgrade', (m) => { m.endpoints.browserOrigin = 'http://127.0.0.1:55441'; }],
  ['origin trailing slash', (m) => { m.endpoints.browserOrigin += '/'; }],
  ['origin query routing', (m) => { m.endpoints.browserOrigin += '?host=foreign.invalid'; }],
  ['DNS endpoint', (m) => { m.endpoints.backend.host = 'localhost'; }],
  ['alternate numeric host', (m) => { m.endpoints.backend.host = '127.1'; }],
  ['IPv6 alias', (m) => { m.endpoints.backend.host = '::1'; }],
  ['string port', (m) => { m.endpoints.backend.port = '55442'; }],
  ['colliding ports', (m) => { m.endpoints.redis.port = m.endpoints.backend.port; }],
  ['URL extra routing', (m) => { m.endpoints.postgres.url = 'postgres://127.0.0.1/db'; }],
  ['foreign PG endpoint', (m) => { m.postgres.target.port = 55446; }],
  ['PG name', (m) => { m.postgres.target.database = 'finance_app'; }],
  ['PG run mismatch', (m) => { m.postgres.target.runId = 'different'; }],
  ['PG marker mismatch', (m) => { m.postgres.expectedMarker += 'foreign'; }],
  ['PG role', (m) => { m.postgres.role = 'postgres'; }], ['PG superuser alias', (m) => { m.postgres.role = 'root'; }],
  ['PG false synthetic', (m) => { m.postgres.target.synthetic = false; }],
  ['PG unexpected server option', (m) => { m.postgres.target.server = { origin: m.endpoints.browserOrigin }; }],
  ['PG version range', (m) => { m.postgres.serverVersion = '^18.6'; }],
  ['schema missing hash', (m) => { delete m.postgres.schema.sourceSha256; }],
  ['schema unsafe name', (m) => { m.postgres.schema.migrations[0].name = '../0000_fixture'; }],
  ['schema duplicate', (m) => { m.postgres.schema.migrations.push({ ...m.postgres.schema.migrations[0], journalWhenMs: 1730000000001 }); }],
  ['schema zero time', (m) => { m.postgres.schema.migrations[0].journalWhenMs = 0; }],
  ['schema reordered time', (m) => { m.postgres.schema.migrations.push({ ...m.postgres.schema.migrations[0], name: '0001_other', journalWhenMs: 1 }); }],
  ['Redis credential alias', (m) => { m.redis.credentialGeneration = m.postgres.credentialGeneration; }],
  ['Redis ambient profile', (m) => { m.redis.credentialProfile = 'default'; }],
  ['Redis unsafe user', (m) => { m.redis.aclUser = 'default'; }],
  ['Redis foreign prefix', (m) => { m.redis.keyPrefix = 'shared:'; }],
  ['Redis logical DB override', (m) => { m.redis.database = 1; }],
  ['Redis version wildcard', (m) => { m.redis.serverVersion = '8.x'; }],
  ['TLS verification disabled', (m) => { m.tls.postgres.rejectUnauthorized = false; }],
  ['TLS hostname alias', (m) => { m.tls.postgres.identityHost = 'localhost'; }],
  ['TLS cert private path', (m) => { m.tls.https.ca.file.path = `${m.paths.privateRoot}\\private.pem`; }],
  ['TLS CA equals leaf', (m) => { m.tls.https.leaf = structuredClone(m.tls.https.ca); }],
  ['TLS zero size', (m) => { m.tls.postgres.ca.file.size = 0; }],
  ['TLS secret key', (m) => { m.tls.https.privateKey = 'PRIVATE_SENTINEL'; }],
  ['Chromium version', (m) => { m.chromium.version = '146.0.0.0'; }],
  ['Chromium changed trust anchor', (m) => { m.chromium.trust.caDerSha256 = 'e'.repeat(64); }],
  ['Chromium ignored errors', (m) => { m.chromium.ignoreHTTPSErrors = true; }],
  ['Chromium custom args', (m) => { m.chromium.args = ['--ignore-certificate-errors']; }],
  ['Chromium trust database', (m) => { m.chromium.trust.databaseVersion = 2; }],
  ['Chromium trust bytes', (m) => { m.chromium.trust.trustMetadataHex = '00'; }],
  ['Chromium executable escape', (m) => { m.chromium.executable.path = 'C:\\other\\chrome.exe'; }],
  ['loopback bypass', (m) => { m.chromium.proxyBypass = 'localhost'; }],
  ['QUIC', (m) => { m.chromium.quic = true; }],
  ['foreign app origin', (m) => { m.policy.appOrigin = 'https://foreign.invalid'; }],
  ['worker enablement', (m) => { m.policy.workers = 'enabled'; }],
  ['provider enablement', (m) => { m.policy.providers = 'enabled'; }],
  ['mail enablement', (m) => { m.policy.mail = 'enabled'; }], ['push enablement', (m) => { m.policy.push = 'enabled'; }],
  ['trust all proxies', (m) => { m.policy.forwarding = 'trust-all'; }],
  ['ordinary environment', (m) => { m.policy.nodeEnv = 'test'; }],
  ['wrong actor zone', (m) => { m.policy.actorTimezone = 'UTC'; }],
  ['unbounded probe', (m) => { m.timeouts.dependencyProbeMs = 2001; }],
  ['probe exceeds run', (m) => { m.timeouts.runMs = 1; }],
  ['file traversal', (m) => { m.build.artifacts[1].relativePath = 'public/../private'; }],
  ['file native alias', (m) => { m.build.artifacts[1].relativePath = 'public/CON.txt'; }],
  ['file URI encoding', (m) => { m.build.artifacts[1].relativePath = 'public/%2e%2e/private'; }],
  ['file duplicate', (m) => { m.build.artifacts[1].relativePath = 'index.js'; }],
  ['missing server output', (m) => { m.build.artifacts[0].role = 'client-asset'; }],
  ['negative file size', (m) => { m.build.artifacts[0].size = -1; }],
  ['zero file hash', (m) => { m.build.artifacts[0].sha256 = '0'.repeat(64); }],
  ['UNC root', (m) => { m.paths.runRoot = '\\\\host\\share'; }],
  ['root ADS', (m) => { m.paths.pgdataRoot += ':stream'; }],
  ['root short alias', (m) => { m.paths.pgdataRoot = 'C:\\SYNTHE~1\\pgdata'; }],
  ['root outside run', (m) => { m.paths.pgdataRoot = 'C:\\outside'; }],
  ['build inside PGDATA', (m) => { m.paths.buildRoot = `${m.paths.pgdataRoot}\\code`; }],
  ['browser runtime equals profile', (m) => { m.paths.browserRuntimeRoot = m.paths.browserProfileRoot; }],
]) test(`self-consistent but invalid declarations refuse: ${name}`, () => {
  const value = manifestFixture(); change(value);
  assert.throws(() => readProductionManifest(canonicalJson(value), untrustedPair(value)), /PRODUCTION_MANIFEST_REFUSED/);
});

test('all root cross-pairs reject equality, case aliases and either nesting direction independently of file pins', () => {
  const names = ['buildRoot', 'browserRuntimeRoot', 'browserProfileRoot', 'pgdataRoot', 'publicTlsRoot', 'privateRoot'];
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
    for (const direction of [0, 1]) for (const nested of [false, true]) {
      const paths = manifestFixture().paths; const [left, right] = direction ? [names[b], names[a]] : [names[a], names[b]];
      paths[left] = paths[right].replace('Synthetic', 'synthetic') + (nested ? '\\nested' : '');
      assert.throws(() => validatePaths(paths), /PRODUCTION_MANIFEST_REFUSED/, `${left}/${right}/${nested}`);
    }
  }
});

test('all ordinary/default/reused ports refuse even when endpoint data and supplied projections agree', () => {
  for (const port of [0, 80, 443, 5000, 5432, 55432, 6379, 65536, 1.5]) {
    const value = manifestFixture(); value.endpoints.backend.port = port;
    assert.throws(() => readProductionManifest(canonicalJson(value), untrustedPair(value)), /PRODUCTION_MANIFEST_REFUSED/);
  }
});

test('the parser cannot authenticate the origin of self-consistent replacement pins', () => {
  const value = manifestFixture(); value.build.commitSha = 'e'.repeat(40);
  const record = readProductionManifest(canonicalJson(value), untrustedPair(value));
  assert.equal(record.document.build.commitSha, value.build.commitSha);
  assert.equal(record.certifications.executionAuthorized, false); assert.equal(record.certifications.runtimeDependencyIdentity, false);
});

test('malformed canonical input, unknown expectation fields and hostile getters refuse without payload output', () => {
  const text = canonicalJson(manifestFixture());
  for (const input of [text + ' ', '{"version":1,"version":1}', ' '.repeat(256 * 1024 + 1), 'null', '{"x":1.5}']) {
    assert.throws(() => readProductionManifest(input, approvedFixturePins), /PRODUCTION_MANIFEST_REFUSED/);
  }
  for (const pins of [{}, { ...approvedFixturePins, secret: 'PRIVATE_SENTINEL' }]) assert.throws(() => readProductionManifest(text, pins), /PRODUCTION_MANIFEST_REFUSED/);
  let reads = 0;
  const pins = { ...approvedFixturePins }; Object.defineProperty(pins, 'expectedManifestSha256', { get() { reads++; throw new Error('PRIVATE_SENTINEL'); } });
  assert.throws(() => readProductionManifest(text, pins), /PRODUCTION_MANIFEST_REFUSED/); assert.equal(reads, 0);
});

test('canonical copy refuses symbols, sparse/hidden arrays, cycles, prototypes and declared bounds', () => {
  const symbol = { okay: 1 }; symbol[Symbol('hidden')] = 'PRIVATE_SENTINEL';
  const array = [1]; Object.defineProperty(array, 'hidden', { value: 'PRIVATE_SENTINEL' });
  const cycle = {}; cycle.next = cycle;
  let depth = 1; for (let index = 0; index < 11; index++) depth = { next: depth };
  for (const value of [symbol, array, cycle, depth, new Array(2), Object.create({ inherited: 1 }),
    'x'.repeat(2049), Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i])), null, undefined, Infinity]) {
    assert.throws(() => canonicalJson(value), /PRODUCTION_MANIFEST_REFUSED/);
  }
});

test('caller proxies cannot execute traps while expected values are copied', () => {
  let traps = 0;
  const pins = new Proxy({ ...approvedFixturePins }, { ownKeys(target) { traps++; return Reflect.ownKeys(target); } });
  assert.throws(() => readProductionManifest(canonicalJson(manifestFixture()), pins), /PRODUCTION_MANIFEST_REFUSED/);
  assert.equal(traps, 0);
});

test('Windows superscript COM/LPT device aliases refuse lexically without any native path access', () => {
  for (const family of ['COM', 'com', 'CoM', 'LPT', 'lpt', 'LpT']) {
    for (const digit of ['\u00b9', '\u00b2', '\u00b3']) for (const extension of ['', '.txt', '.exe']) {
      const value = manifestFixture(); value.paths.buildRoot = `C:\\Synthetic\\${family}${digit}${extension}\\build`;
      assert.throws(() => readProductionManifest(canonicalJson(value), untrustedPair(value)), /PRODUCTION_MANIFEST_REFUSED/, `${family}${digit}${extension}`);
    }
  }
});

test('old independent pins reject mutation and each changed expected identity/projection', () => {
  const value = manifestFixture(); value.build.artifacts[0].sha256 = 'e'.repeat(64);
  assert.throws(() => readProductionManifest(canonicalJson(value), approvedFixturePins), /PRODUCTION_MANIFEST_REFUSED/);
  for (const key of Object.keys(approvedFixturePins)) {
    const pins = { ...approvedFixturePins, [key]: key.endsWith('Sha256') ? 'e'.repeat(64) : 'changed' };
    assert.throws(() => readProductionManifest(canonicalJson(manifestFixture()), pins), /PRODUCTION_MANIFEST_REFUSED/);
  }
});
