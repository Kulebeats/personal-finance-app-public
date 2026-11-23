#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadTestTarget, resolveTestDatabaseUrl, parseConnection, markerFor, verifyDatabaseTarget } from '../server/testing/test-target.mjs';

// Bounded synthetic marker tamper proof. No business rows or shared targets.
const target = loadTestTarget();
const connection = parseConnection(resolveTestDatabaseUrl(process.env));
const admin = parseConnection(process.env.TEST_DATABASE_ADMIN_URL, 'TEST_DATABASE_ADMIN_URL');
assert.equal(admin.host, connection.host);
assert.equal(admin.port, connection.port);
assert.equal(admin.database, 'postgres');
await verifyDatabaseTarget();
const { default: pg } = await import('pg');
const client = new pg.Client(admin);
await client.connect();
const guard = new URL('../server/testing/postgres-guard.mjs', import.meta.url).href;
const core = new URL('../server/testing/test-target.mjs', import.meta.url).href;
function worker(foreign) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import pg from 'pg';
    import { installPostgresGuard } from ${JSON.stringify(guard)};
    import { prepareTestEnvironment, parseConnection } from ${JSON.stringify(core)};
    const environment = prepareTestEnvironment();
    await installPostgresGuard(environment);
    const config = parseConnection(process.env.TEST_DATABASE_URL);
    const foreign = ${foreign};
    const promiseClient = new pg.Client(config);
    if (foreign) await assert.rejects(promiseClient.connect(), /persisted synthetic run marker/);
    else { await promiseClient.connect(); assert.equal((await promiseClient.query('SELECT 41 + 1 AS answer')).rows[0].answer, 42); }
    await promiseClient.end();
    let calls = 0;
    const callbackClient = new pg.Client(config);
    await new Promise((resolve, reject) => callbackClient.connect((error) => {
      calls++; if (foreign ? !error?.message.includes('persisted synthetic run marker') : error) return reject(error ?? new Error('marker accepted')); resolve();
    }));
    assert.equal(calls, 1); await callbackClient.end();
    const pool = new pg.Pool(config);
    if (foreign) await assert.rejects(pool.query('SELECT 42 AS answer'), /persisted synthetic run marker/);
    else assert.equal((await pool.query('SELECT 42 AS answer')).rows[0].answer, 42);
    await pool.end();
  `], { cwd: new URL('../', import.meta.url), env: { ...process.env, PFA_TEST_MODE: 'database' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
}
try {
  worker(false);
  await client.query(`COMMENT ON DATABASE "${target.database}" IS 'pfa-synthetic-test:foreign-run'`);
  worker(true);
} finally {
  await client.query(`COMMENT ON DATABASE "${target.database}" IS '${markerFor(target)}'`);
  await client.end();
}
await verifyDatabaseTarget();
console.log(JSON.stringify({ status: 'verified', database: target.database, port: target.port,
  checks: ['promise', 'callback-once', 'pool', 'foreign-marker-refused'], markerRestored: true }));
