import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTestDatabaseUrl } from '../test-database.ts';

const manifest = {
  version: 1,
  disposable: true,
  synthetic: true,
  host: '127.0.0.1',
  port: 5432,
  database: 'pfa_completion_r00_run20261015_test',
  runId: 'run20261015',
  server: { origin: 'http://127.0.0.1:5127' },
};
const safe = 'postgresql://synthetic:fixture@127.0.0.1:5432/pfa_completion_r00_run20261015_test';
const resolve = (url, target = manifest) => resolveTestDatabaseUrl({
  TEST_DATABASE_URL: url,
  TEST_TARGET: target,
  TEST_RUN_ID: 'run20261015',
});

test('R00 refuses ambient DATABASE_URL instead of deriving or trusting a test substring', () => {
  assert.throws(() => resolveTestDatabaseUrl({ DATABASE_URL: safe }), /TEST_DATABASE_URL/);
});

test('R00 refuses an explicit URL without a disposable manifest and run marker', () => {
  assert.throws(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: safe }), /manifest|TEST_TARGET/i);
});

test('R00 refuses remote hosts before a client can be constructed', () => {
  assert.throws(() => resolve(safe.replace('127.0.0.1', 'db.example.invalid'), {
    ...manifest, host: 'db.example.invalid',
  }), /loopback|host/i);
});

test('R00 refuses the real finance_app even if a manifest labels it disposable', () => {
  assert.throws(() => resolve(safe.replace(manifest.database, 'finance_app'), {
    ...manifest, database: 'finance_app',
  }), /database|disposable/i);
});

test('R00 refuses query and fragment connection overrides', () => {
  for (const override of ['?host=db.example.invalid', '?dbname=finance_app', '#unsafe']) {
    assert.throws(() => resolve(safe + override), /query|fragment|override/i);
  }
});

test('R00 refuses a missing or foreign run marker', () => {
  assert.throws(() => resolve(safe, { ...manifest, runId: '' }), /run/i);
  assert.throws(() => resolve(safe, { ...manifest, runId: 'different' }), /run/i);
});

test('R00 binds host, port and database exactly to the manifest', () => {
  assert.throws(() => resolve(safe.replace(':5432/', ':5433/')), /port|target/i);
  assert.throws(() => resolve(safe.replace('127.0.0.1', 'localhost')), /host|target/i);
  assert.throws(() => resolve(safe.replace('r00_', 'r01_')), /database|target/i);
});

test('R00 accepts a fully matched explicit synthetic target', () => {
  assert.equal(resolve(safe), safe);
});
