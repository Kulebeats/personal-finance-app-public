import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, readProducerIntent, readPublishedBundle, readRestoreAuthorization } from './contracts.mjs';
import { planCapture, planRestore } from './plan.mjs';
import { fixture } from './fixture.mjs';

function records() {
  const data = fixture();
  const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  const restore = readRestoreAuthorization(canonicalJson(data.authorization), producer, bundle, data.restorePins);
  const runtime = { passfile: `${data.intent.credentialRoot}\\pgpass.conf`, temporaryRoot: `${data.intent.credentialRoot}\\tmp`, systemRoot: 'C:\\Windows' };
  return { data, producer, bundle, restore, runtime };
}

test('capture plans only explicit native argv, minimal environment and an unpublished partial file', () => {
  const { data, producer, runtime } = records();
  const plan = planCapture(producer, runtime);
  assert.deepEqual(plan.argv, [
    '--host', '127.0.0.1', '--port', '55432', '--username', 'pfa_campaign', '--dbname', data.intent.source.database,
    '--no-password', '--format=custom', '--no-comments', '--no-privileges', '--file', `${data.intent.artifactRoot}\\database.dump.partial`,
  ]);
  assert.deepEqual(plan.env, {
    PGPASSFILE: runtime.passfile, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'pfa-recovery-r19recover20261015a1',
    SystemRoot: runtime.systemRoot, TEMP: runtime.temporaryRoot, TMP: runtime.temporaryRoot,
  });
  assert.equal(plan.executable, data.intent.tools.dump.path);
  assert.equal(plan.expectedBinarySha256, data.intent.tools.dump.sha256);
  assert.equal(plan.timeoutMs, 600000);
  assert.equal(plan.shell, false);
  assert.equal(plan.target.database, data.intent.source.database);
  assert.equal(plan.expectedMarker, `pfa-synthetic-test:v1:${data.intent.source.runId}:${data.intent.source.database}`);
});

test('restore requires later authorization and plans no create, clean, comments or ownership', () => {
  const { data, restore, runtime } = records(); const plan = planRestore(restore, runtime);
  assert.deepEqual(plan.argv, [
    '--host', '127.0.0.1', '--port', '55432', '--username', 'pfa_campaign', '--dbname', data.intent.restore.database,
    '--no-password', '--no-owner', '--no-privileges', '--no-comments', '--exit-on-error', '--single-transaction',
    `${data.intent.artifactRoot}\\database.dump`,
  ]);
  assert.equal(plan.expectedArchiveSha256, data.bundle.database.sha256);
  assert.equal(plan.authorizationSha256, data.restorePins.expectedAuthorizationSha256);
  assert.equal(plan.target.database, data.intent.restore.database);
  assert.equal(plan.expectedMarker, `pfa-synthetic-test:v1:${data.intent.restore.runId}:${data.intent.restore.database}`);
  assert.equal(plan.quarantine, true);
  assert.equal(plan.executable, data.intent.tools.restore.path);
});

test('plans remain immutable, unexecuted expectations rather than actual preflight certifications', () => {
  const { producer, restore, runtime } = records();
  for (const plan of [planCapture(producer, runtime), planRestore(restore, runtime)]) {
    assert.deepEqual(plan.certifications, { filesystemIdentity: false, liveDatabaseIdentity: false, actualBinaryHash: false, executionAuthorized: false });
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.env), true);
    assert.equal(Object.isFrozen(plan.argv), true);
    assert.throws(() => { plan.argv.push('--clean'); }, TypeError);
    assert.throws(() => { plan.env.PGHOST = 'external.invalid'; }, TypeError);
  }
  runtime.passfile = 'C:\\elsewhere';
  assert.notEqual(planCapture(producer, records().runtime).env.PGPASSFILE, runtime.passfile);
});

test('caller cannot forge, clone, substitute or widen validated stage records', () => {
  const { producer, bundle, restore, runtime } = records();
  for (const invalid of [producer.document, structuredClone(producer), bundle, restore, null]) {
    assert.throws(() => planCapture(invalid, runtime), /RECOVERY_REFUSED/);
  }
  for (const invalid of [producer, bundle, structuredClone(restore)]) assert.throws(() => planRestore(invalid, runtime), /RECOVERY_REFUSED/);
});

test('runtime path aliases, escapes, custom flags and environment injection fail closed', () => {
  const { producer, runtime } = records();
  for (const change of [
    (r) => { r.args = ['--clean']; }, (r) => { r.PGHOST = 'external.invalid'; },
    (r) => { delete r.systemRoot; }, (r) => { r.passfile = 'postgres://user@127.0.0.1/db'; },
    (r) => { r.passfile = 'C:\\outside\\pgpass'; }, (r) => { r.passfile += '\\..\\escape'; },
    (r) => { r.passfile = '\\\\server\\share\\pgpass'; }, (r) => { r.passfile += ':stream'; },
    (r) => { r.passfile = r.temporaryRoot; }, (r) => { r.temporaryRoot += '\\NUL'; },
    (r) => { r.temporaryRoot = 'C:\\Owned\\privat~1\\tmp'; }, (r) => { r.systemRoot = '/Windows'; },
  ]) { const input = { ...runtime }; change(input); assert.throws(() => planCapture(producer, input), /RECOVERY_REFUSED/); }
});

test('ambient routing and credential variables never enter planned environment', () => {
  const { producer, runtime } = records();
  const old = process.env.PGOPTIONS;
  process.env.PGOPTIONS = '-c search_path=PRIVATE_SENTINEL';
  try {
    const plan = planCapture(producer, runtime);
    assert.equal(JSON.stringify(plan).includes('PRIVATE_SENTINEL'), false);
    for (const key of ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSWORD', 'DATABASE_URL', 'PATH']) {
      assert.equal(Object.hasOwn(plan.env, key), false);
    }
  } finally { if (old === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = old; }
});
