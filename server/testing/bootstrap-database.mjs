import { fileURLToPath } from 'node:url';
import { loadTestTarget, resolveTestDatabaseUrl, parseConnection, markerFor, verifyDatabaseTarget } from './test-target.mjs';

/** Creation is confined to the explicit maintenance endpoint and absent synthetic DB. */
export async function bootstrapTestDatabase(env = process.env) {
  const target = loadTestTarget(env);
  const connection = parseConnection(resolveTestDatabaseUrl(env));
  const admin = parseConnection(env.TEST_DATABASE_ADMIN_URL, 'TEST_DATABASE_ADMIN_URL');
  if (admin.host !== connection.host || admin.port !== connection.port || admin.database !== 'postgres') {
    throw new Error('REFUSING TEST TARGET: admin must be explicit postgres on the manifest host/port');
  }
  // Import drivers only after every static check. Never use ambient PG* defaults.
  const { default: pg } = await import('pg');
  const client = new pg.Client(admin);
  let created = false;
  try {
    await client.connect();
    const endpoint = await client.query('SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port');
    const actual = endpoint.rows[0];
    if (actual.database !== 'postgres' || !['127.0.0.1', '::1'].includes(actual.host) || +actual.port !== target.port) {
      throw new Error('REFUSING TEST TARGET: maintenance endpoint identity mismatch');
    }
    const { rows } = await client.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", [target.database]);
    if (rows.length && rows[0].marker !== markerFor(target)) {
      throw new Error('REFUSING TEST TARGET: existing database has no matching marker; adoption is forbidden');
    }
    if (!rows.length) {
      await client.query(`CREATE DATABASE "${target.database}"`);
      created = true;
      await client.query(`COMMENT ON DATABASE "${target.database}" IS '${markerFor(target)}'`);
    }
  } finally { await client.end(); }
  await verifyDatabaseTarget(env);
  const [{ drizzle }, { migrate }] = await Promise.all([
    import('drizzle-orm/node-postgres'), import('drizzle-orm/node-postgres/migrator'),
  ]);
  const pool = new pg.Pool(connection);
  try {
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../migrations/', import.meta.url)) });
    const { rows } = await pool.query('SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations');
    return { database: target.database, host: target.host, port: target.port, runId: target.runId, created, migrations: rows[0].applied };
  } finally { await pool.end(); }
}
