#!/usr/bin/env node
/**
 * Create (if absent) the dedicated server-test database and push the schema.
 *
 * The server suite must never run against the dev database — it deletes users
 * and households in cleanup. `server/vitest.config.ts` derives `<dbname>_test`
 * and refuses to run against anything not test-scoped; this script creates that
 * database so the refusal has an easy fix.
 *
 * Usage:  npm run db:test:setup
 */

import { spawnSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const ambient = process.env.DATABASE_URL;
if (!ambient) {
  console.error('DATABASE_URL is not set; nothing to derive a test database from.');
  process.exit(1);
}

const target = process.env.TEST_DATABASE_URL ?? deriveTestUrl(ambient);

function deriveTestUrl(url) {
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, '');
  if (/(^|_)test(_|$)/.test(name)) return url;
  u.pathname = `/${name}_test`;
  return u.toString();
}

const targetName = new URL(target).pathname.replace(/^\//, '');
const ambientName = new URL(ambient).pathname.replace(/^\//, '');

if (targetName === ambientName) {
  console.error(
    `Refusing to proceed: the test database resolved to "${targetName}", the same database ` +
      'DATABASE_URL uses. Point TEST_DATABASE_URL at a dedicated database.'
  );
  process.exit(1);
}

// Connect to the maintenance DB on the same server to issue CREATE DATABASE.
const adminUrl = new URL(target);
adminUrl.pathname = '/postgres';

const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();

const { rows } = await client.query('select 1 from pg_database where datname = $1', [
  targetName,
]);

if (rows.length > 0) {
  console.log(`Test database "${targetName}" already exists.`);
} else {
  // Identifier can't be parameterised; targetName is derived from our own URL,
  // and the quoting below is the standard escape for a quoted identifier.
  await client.query(`create database "${targetName.replace(/"/g, '""')}"`);
  console.log(`Created test database "${targetName}".`);
}

await client.end();

// Push the current schema into it. drizzle-kit reads DATABASE_URL.
console.log(`Pushing schema to "${targetName}"...`);
const push = spawnSync('npx', ['drizzle-kit', 'push'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: target },
});

if (push.status !== 0) {
  console.error('drizzle-kit push failed.');
  process.exit(push.status ?? 1);
}

console.log(`\nReady. Server tests will use "${targetName}".`);
