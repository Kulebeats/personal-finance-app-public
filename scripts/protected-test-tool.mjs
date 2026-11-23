#!/usr/bin/env node
import { prepareTestEnvironment, parseConnection, verifyDatabaseTarget } from '../server/testing/test-target.mjs';
import { installNetworkGuard } from '../server/testing/network-guard.mjs';
import { installPostgresGuard } from '../server/testing/postgres-guard.mjs';

async function run() {
  const environment = prepareTestEnvironment();
  if (environment.mode !== 'database') throw new Error('REFUSING TEST TARGET: diagnostic/fixture tools require database mode');
  const operation = process.argv[2];
  if (!['diagnose', 'fixture'].includes(operation)) throw new Error('REFUSING TEST TARGET: choose diagnose or fixture');
  const password = process.env.TEST_FIXTURE_PASSWORD;
  if (operation === 'fixture' && (!password || password.length < 12 || password.length > 72)) {
    throw new Error('REFUSING TEST TARGET: fixture requires an explicit TEST_FIXTURE_PASSWORD of 12-72 characters');
  }
  installNetworkGuard(environment);
  await installPostgresGuard(environment);
  const target = await verifyDatabaseTarget();
  const { default: pg } = await import('pg');
  const client = new pg.Client(parseConnection(process.env.TEST_DATABASE_URL));
  await client.connect();
  try {
    if (operation === 'diagnose') {
      const { rows } = await client.query(`SELECT count(*)::int AS tables FROM information_schema.tables
        WHERE table_schema = 'public'`);
      return { operation, database: target.database, runId: target.runId, markerVerified: true, tables: rows[0].tables };
    }
    const { default: bcrypt } = await import('bcryptjs');
    const email = `synthetic-${target.runId}@example.invalid`;
    const username = `synthetic-${target.runId}`;
    const name = `Synthetic Test Household ${target.runId}`;
    const hash = await bcrypt.hash(password, 12);
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pfa-synthetic-fixture:${target.runId}`]);
      const existing = await client.query('SELECT id, username, password_hash FROM users WHERE email = $1', [email]);
      if (existing.rows.length) {
        const user = existing.rows[0];
        const memberships = await client.query(`SELECT h.id FROM household_members m JOIN households h ON h.id = m.household_id
          WHERE m.user_id = $1 AND m.role = 'owner' AND h.name = $2`, [user.id, name]);
        if (user.username !== username || memberships.rows.length !== 1 || !await bcrypt.compare(password, user.password_hash)) {
          throw new Error('REFUSING TEST TARGET: existing synthetic fixture identity or credentials differ; no reset performed');
        }
        await client.query('COMMIT');
        return { operation, database: target.database, runId: target.runId, created: false, userId: user.id, householdId: memberships.rows[0].id };
      }
      const { rows: [user] } = await client.query(`INSERT INTO users
        (username, email, password_hash, full_name, display_name, timezone, email_verified)
        VALUES ($1, $2, $3, 'Synthetic Test User', 'Synthetic Test User', 'Africa/Lusaka', true) RETURNING id`, [username, email, hash]);
      const { rows: [household] } = await client.query(`INSERT INTO households (name, currency) VALUES ($1, 'ZMW') RETURNING id`, [name]);
      await client.query(`INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')`, [household.id, user.id]);
      await client.query('INSERT INTO user_display_settings (user_id) VALUES ($1)', [user.id]);
      await client.query('INSERT INTO household_preferences (household_id) VALUES ($1)', [household.id]);
      await client.query('COMMIT');
      return { operation, database: target.database, runId: target.runId, created: true, userId: user.id, householdId: household.id };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { await client.end(); }
}

try { console.log(JSON.stringify(await run())); }
catch (error) {
  console.error(error.message?.startsWith('REFUSING TEST TARGET:') ? error.message : 'Protected synthetic test tool failed; no connection or credential details are logged.');
  process.exitCode = 1;
}
