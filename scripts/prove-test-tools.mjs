#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareTestEnvironment, parseConnection, verifyDatabaseTarget } from '../server/testing/test-target.mjs';
import { installNetworkGuard } from '../server/testing/network-guard.mjs';
import { installPostgresGuard } from '../server/testing/postgres-guard.mjs';

const environment = prepareTestEnvironment();
assert.equal(environment.mode, 'database');
installNetworkGuard(environment);
await installPostgresGuard(environment);
const target = await verifyDatabaseTarget();
const { default: pg } = await import('pg');
const client = new pg.Client(parseConnection(process.env.TEST_DATABASE_URL));
await client.connect();
const email = `synthetic-${target.runId}@example.invalid`;
const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
assert.equal(existing.rows.length, 0, 'Proof requires absent run-scoped fixture; it never replaces existing data');
const password = randomBytes(24).toString('base64url');
function tool(operation, fixturePassword = password) {
  return spawnSync(process.execPath, ['scripts/protected-test-tool.mjs', operation], {
    env: { ...process.env, TEST_FIXTURE_PASSWORD: fixturePassword }, encoding: 'utf8', timeout: 15000,
  });
}
let fixture;
try {
  const diagnostic = tool('diagnose');
  assert.equal(diagnostic.status, 0);
  assert.equal(JSON.parse(diagnostic.stdout).markerVerified, true);
  const create = tool('fixture');
  assert.equal(create.status, 0, create.stderr);
  fixture = JSON.parse(create.stdout);
  assert.equal(fixture.created, true);
  const { rows: [stored] } = await client.query(`SELECT u.username, u.password_hash, u.email_verified, m.role, h.name,
    (SELECT count(*)::int FROM user_display_settings WHERE user_id = u.id) AS display_rows,
    (SELECT count(*)::int FROM household_preferences WHERE household_id = h.id) AS preference_rows
    FROM users u JOIN household_members m ON m.user_id = u.id JOIN households h ON h.id = m.household_id WHERE u.id = $1`, [fixture.userId]);
  assert.equal(stored.username, `synthetic-${target.runId}`);
  assert.equal(stored.email_verified, true);
  assert.equal(stored.role, 'owner');
  assert.equal(stored.name, `Synthetic Test Household ${target.runId}`);
  assert.equal(stored.display_rows, 1);
  assert.equal(stored.preference_rows, 1);
  const { default: bcrypt } = await import('bcryptjs');
  assert.equal(await bcrypt.compare(password, stored.password_hash), true);
  const replay = tool('fixture');
  assert.equal(replay.status, 0);
  assert.deepEqual(JSON.parse(replay.stdout), { ...fixture, created: false });
  const conflict = tool('fixture', randomBytes(24).toString('base64url'));
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /no reset performed/);
  const unchanged = await client.query('SELECT password_hash FROM users WHERE id = $1', [fixture.userId]);
  assert.equal(unchanged.rows[0].password_hash, stored.password_hash);
  for (const output of [diagnostic, create, replay, conflict]) assert.ok(!(output.stdout + output.stderr).includes(password));
  console.log(JSON.stringify({ database: target.database, runId: target.runId, diagnostic: 'passed', fixtureReadback: 'passed', replay: 'passed', conflictingPasswordRefused: true, credentialsLogged: false }));
} finally {
  if (fixture) {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM households WHERE id = $1 AND name = $2', [fixture.householdId, `Synthetic Test Household ${target.runId}`]);
      await client.query('DELETE FROM users WHERE id = $1 AND email = $2', [fixture.userId, email]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  await client.end();
}
