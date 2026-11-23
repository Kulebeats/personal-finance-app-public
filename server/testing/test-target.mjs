import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const refuse = (message) => { throw new Error(`REFUSING TEST TARGET: ${message}`); };

export function validateManifest(target, runId) {
  if (!target || target.version !== 1 || target.disposable !== true || target.synthetic !== true) {
    refuse('an explicit version 1 disposable synthetic TEST_TARGET_MANIFEST is required');
  }
  if (!loopback.has(target.host)) refuse('manifest host must be explicit loopback');
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) refuse('invalid manifest port');
  if (!/^[a-z][a-z0-9]{7,31}$/.test(target.runId ?? '') || target.runId !== runId) {
    refuse('TEST_RUN_ID must match the manifest run marker (8-32 lowercase alphanumeric characters)');
  }
  if (typeof target.database !== 'string' || target.database.length > 63 ||
      !/^pfa_(completion|ci)_[a-z0-9_]+_test$/.test(target.database) ||
      !target.database.includes(`_${target.runId}_test`)) {
    refuse('database must be a unique pfa_completion/pfa_ci disposable name ending in _<runId>_test');
  }
  if (target.server) {
    let origin;
    try { origin = new URL(target.server.origin); } catch { refuse('invalid server origin'); }
    if (origin.protocol !== 'http:' || !loopback.has(origin.hostname) || !origin.port ||
        origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
        origin.origin !== target.server.origin) refuse('server origin must be an exact loopback http origin with explicit port');
    if (+origin.port === target.port) refuse('server and database ports must differ');
  }
  return Object.freeze({ ...target, server: target.server && Object.freeze({ ...target.server }) });
}

export function loadTestTarget(env = process.env) {
  let target = env.TEST_TARGET;
  if (!target) {
    if (!env.TEST_TARGET_MANIFEST) refuse('TEST_TARGET_MANIFEST is required; ambient .env is never loaded');
    try { target = JSON.parse(readFileSync(env.TEST_TARGET_MANIFEST, 'utf8')); }
    catch { refuse('TEST_TARGET_MANIFEST must name a readable JSON manifest'); }
  }
  return validateManifest(target, env.TEST_RUN_ID);
}

export function parseConnection(url, label = 'TEST_DATABASE_URL') {
  if (typeof url !== 'string' || !url || url !== url.trim()) refuse(`${label} must be explicitly set`);
  let parsed;
  try { parsed = new URL(url); } catch { refuse(`${label} is not a valid connection URL`); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) refuse(`${label} must use postgres protocol`);
  if (url.includes('?') || url.includes('#')) refuse(`${label} query/fragment overrides are forbidden`);
  if (!loopback.has(parsed.hostname)) refuse(`${label} host must be loopback`);
  if (!parsed.port || !parsed.username || !/^\/[a-z][a-z0-9_]*$/.test(parsed.pathname)) {
    refuse(`${label} requires explicit port, user and plain unencoded database name`);
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''), port: +parsed.port,
    database: parsed.pathname.slice(1), user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password), ssl: false,
    connectionTimeoutMillis: 3000,
  };
}

export function resolveTestDatabaseUrl(env) {
  if (!env.TEST_DATABASE_URL) refuse('TEST_DATABASE_URL is required; DATABASE_URL fallback is forbidden');
  const target = loadTestTarget(env);
  const connection = parseConnection(env.TEST_DATABASE_URL);
  if (connection.host !== target.host.replace(/^\[|\]$/g, '') || connection.port !== target.port ||
      connection.database !== target.database) refuse('URL host/port/database must match the manifest target exactly');
  return env.TEST_DATABASE_URL;
}

export function assertNotDevDatabase(url, _ambient, env = process.env) {
  resolveTestDatabaseUrl({ ...env, TEST_DATABASE_URL: url });
}

export function markerFor(target) { return `pfa-synthetic-test:v1:${target.runId}:${target.database}`; }

export function assertDatabaseIdentity(rows, target) {
  if (rows.length !== 1 || rows[0].database !== target.database || rows[0].marker !== markerFor(target) ||
      +rows[0].port !== target.port || !loopback.has(rows[0].host)) {
    refuse('database identity or persisted synthetic run marker does not match; no test writes are permitted');
  }
}

export async function verifyDatabaseTarget(env = process.env) {
  const url = resolveTestDatabaseUrl(env);
  const target = loadTestTarget(env);
  const { default: pg } = await import('pg');
  const client = new pg.Client(parseConnection(url));
  try {
    await client.connect();
    const { rows } = await client.query(`SELECT current_database() AS database,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`);
    assertDatabaseIdentity(rows, target);
  } finally { await client.end(); }
  return target;
}

// Vite transforms static new URL(asset, import.meta.url) expressions in jsdom.
// Resolve this Node-only fixture as a filesystem path in every test worker.
const emptyDotenv = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'empty.env');
const outboundCredentials = /^(?:PG[A-Z_]*$|SMTP_|VAPID_|GEMINI_|ANTHROPIC_|OPENAI_|GOOGLE_API_KEY$|POSTHOG_|SENDGRID_|RESEND_|MAILGUN_|AWS_|S3_|REDIS_URL$)/;

export function prepareTestEnvironment(env = process.env, { defaultUnit = false } = {}) {
  const mode = env.PFA_TEST_MODE ?? (defaultUnit ? 'unit' : undefined);
  if (!['unit', 'database'].includes(mode)) refuse('set PFA_TEST_MODE=unit or database explicitly');
  const target = mode === 'database' ? loadTestTarget(env) : undefined;
  const url = mode === 'database' ? resolveTestDatabaseUrl(env) : '';
  for (const key of Object.keys(env)) if (outboundCredentials.test(key)) env[key] = '';
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SMTP_HOST',
    'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
    'REDIS_URL', 'POSTHOG_API_KEY']) env[key] = '';
  env.DOTENV_CONFIG_PATH = emptyDotenv;
  env.DOTENV_CONFIG_OVERRIDE = 'false';
  env.DATABASE_URL = url || 'postgresql://disabled:disabled@127.0.0.1:1/pfa_unit_database_disabled';
  env.PFA_TEST_MODE = mode;
  env.PFA_TEST_OUTBOUND = 'deny';
  env.NODE_ENV = 'test';
  env.SESSION_SECRET ||= 'synthetic-test-session-secret-no-real-use';
  env.CRON_SECRET ||= 'synthetic-test-cron-secret-no-real-use';
  return { mode, target };
}
