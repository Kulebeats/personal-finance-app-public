import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, digest, readProducerIntent, readPublishedBundle, readRestoreAuthorization } from './contracts.mjs';
import { fixture } from './fixture.mjs';

test('separate pinned producer, published output and restore approval produce immutable records', () => {
  const data = fixture();
  const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  assert.equal(Object.isFrozen(producer.document.source), true);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  const restore = readRestoreAuthorization(canonicalJson(data.authorization), producer, bundle, data.restorePins);
  assert.equal(restore.document.authorization.bundleSha256, digest(canonicalJson(data.bundle)));
  assert.throws(() => { producer.document.source.database = 'finance_app'; }, TypeError);
  data.intent.source.database = 'finance_app';
  assert.notEqual(producer.document.source.database, data.intent.source.database);
});

test('colocated hashes cannot substitute for independently pinned provenance', () => {
  const data = fixture();
  assert.throws(() => readProducerIntent(canonicalJson(data.intent), { expectedIntentSha256: digest(canonicalJson(data.intent)) }), /RECOVERY_REFUSED/);
  const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  assert.throws(() => readRestoreAuthorization(canonicalJson(data.authorization), producer, bundle, {}), /RECOVERY_REFUSED/);
});

for (const [label, change] of [
  ['unknown flag', (d) => { d.intent.args = ['--clean']; }],
  ['intent output hash circularity', (d) => { d.intent.expectedArchiveSha256 = 'a'.repeat(64); }],
  ['same database', (d) => { d.intent.restore = structuredClone(d.intent.source); }],
  ['DNS host', (d) => { d.intent.source.host = 'localhost'; }],
  ['shared port', (d) => { d.intent.source.port = 5432; }],
  ['reserved DB', (d) => { d.intent.source.database = 'postgres'; }],
  ['URL database', (d) => { d.intent.source.database = 'postgres://user@127.0.0.1/db'; }],
  ['bad hash', (d) => { d.intent.schemaSha256 = 'not-a-hash'; }],
  ['unknown tool', (d) => { d.intent.tools.dump.name = 'psql'; }],
  ['tool option injection', (d) => { d.intent.tools.dump.path = '--help'; }],
  ['path traversal', (d) => { d.intent.artifactRoot += '/../../outside'; }],
]) test(`producer rejects ${label} even with a newly colocated digest`, () => {
  const data = fixture(); change(data);
  data.producerPins.expectedIntentSha256 = digest(canonicalJson(data.intent));
  assert.throws(() => readProducerIntent(canonicalJson(data.intent), data.producerPins), /RECOVERY_REFUSED/);
});

test('mutation, duplicate/noncanonical keys and oversized input fail before approval', () => {
  const data = fixture();
  data.intent.databaseUser = 'different_user';
  assert.throws(() => readProducerIntent(canonicalJson(data.intent), data.producerPins), /RECOVERY_REFUSED/);
  assert.throws(() => readProducerIntent('{"version":1,"version":1}', data.producerPins), /RECOVERY_REFUSED/);
  assert.throws(() => readProducerIntent(' '.repeat(1024 * 1024 + 1), data.producerPins), /RECOVERY_REFUSED/);
  const hostile = {}; Object.defineProperty(hostile, 'secret', { get() { throw new Error('PRIVATE_SENTINEL'); }, enumerable: true });
  assert.throws(() => canonicalJson(hostile), /RECOVERY_REFUSED/);
});

test('bundle refuses incomplete, foreign producer, unsafe blob and wrong byte hash claims', () => {
  const data = fixture(); const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  for (const change of [
    (b) => { b.state = 'incomplete'; }, (b) => { b.producerIntentSha256 = 'e'.repeat(64); },
    (b) => { b.objects[0].file = '../outside'; }, (b) => { b.objects[0].sha256 = 'bad'; },
    (b) => { b.objects[0].size = -1; }, (b) => { b.objects[0].sourceVersion = { kind: 'unknown' }; },
  ]) { const bundle = structuredClone(data.bundle); change(bundle); assert.throws(() => readPublishedBundle(canonicalJson(bundle), producer), /RECOVERY_REFUSED/); }
});

test('restore rejects changed output, stale authority, wrong baseline and authorizations', () => {
  const data = fixture(); const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  for (const change of [
    (a) => { a.archiveSha256 = 'e'.repeat(64); }, (a) => { a.security.watermarkAt = '2026-10-14T00:00:00.000Z'; },
    (a) => { a.template0BaselineSha256 = 'f'.repeat(64); }, (a) => { a.restoreTargetSha256 = a.sourceTargetSha256; },
    (a) => { a.approvalRef = 'unreviewed'; }, (a) => { a.security.mode = 'replay-stub'; },
  ]) { const authorization = structuredClone(data.authorization); change(authorization);
    const pins = { ...data.restorePins, expectedAuthorizationSha256: digest(canonicalJson(authorization)) };
    assert.throws(() => readRestoreAuthorization(canonicalJson(authorization), producer, bundle, pins), /RECOVERY_REFUSED/); }
});

test('JSON arrays cannot masquerade as scalar run, tool, user or object identities', () => {
  for (const change of [
    (d) => { d.intent.runId = [d.intent.runId]; },
    (d) => { d.intent.tools.dump.version = [d.intent.tools.dump.version]; },
    (d) => { d.intent.databaseUser = [d.intent.databaseUser]; },
  ]) {
    const data = fixture(); change(data);
    const pins = { ...data.producerPins, expectedIntentSha256: digest(canonicalJson(data.intent)), tools: data.intent.tools, databaseUser: data.intent.databaseUser };
    assert.throws(() => readProducerIntent(canonicalJson(data.intent), pins), /RECOVERY_REFUSED/);
  }
  const data = fixture(); const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  data.bundle.objects[0].key = [data.bundle.objects[0].key];
  assert.throws(() => readPublishedBundle(canonicalJson(data.bundle), producer), /RECOVERY_REFUSED/);
});

test('recovery watermark outside the 24 hour cut and authority interval refuses even with matching new pins', () => {
  const data = fixture(); const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  for (const time of ['2026-10-16T01:01:00.001Z', '2026-10-15T01:00:59.999Z']) {
    const authorization = structuredClone(data.authorization);
    authorization.recoveryAsOfAt = time; authorization.security.watermarkAt = time; authorization.issuedAt = time;
    const pins = { ...data.restorePins, expectedAuthorizationSha256: digest(canonicalJson(authorization)), recoveryAsOfAt: time };
    assert.throws(() => readRestoreAuthorization(canonicalJson(authorization), producer, bundle, pins), /RECOVERY_REFUSED/);
  }
});
