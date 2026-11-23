import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import type { PoolConfig } from "pg";

type DatabaseSslEnv = {
  [key: string]: unknown;
  NODE_ENV?: string; DATABASE_URL?: string; PFA_TEST_MODE?: string;
  DATABASE_SSL?: string; DATABASE_SSL_REJECT_UNAUTHORIZED?: string;
  DATABASE_SSL_CA_CERT?: string; DATABASE_SSL_CA_FILE?: string;
};
export type DatabaseTlsIssue = { variable: string; message: string };
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Do not pass connectionString to pg: its parser overrides explicit ssl. */
function databaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must be a PostgreSQL connection URL"); }
  if (value !== value.trim() || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname || !url.username || !url.pathname.slice(1) || url.hash || value.includes("#")) {
    throw new Error("DATABASE_URL requires an explicit PostgreSQL host, user, database and no fragment");
  }
  if (url.port && (!Number.isInteger(+url.port) || +url.port < 1 || +url.port > 65535)) {
    throw new Error("DATABASE_URL port must be between 1 and 65535");
  }
  const entries = [...url.searchParams];
  // Existing sslmode=require URLs are accepted with stronger verify-full policy.
  // Every other libpq/routing/file override needs explicit operator config.
  if (entries.length > 1 || entries.some(([key, mode]) => key !== "sslmode" || !["require", "verify-full"].includes(mode))) {
    throw new Error("DATABASE_URL supports only sslmode=require or verify-full; remove routing/TLS query overrides and configure DATABASE_SSL_CA_CERT/FILE explicitly");
  }
  return url;
}

/** Pure policy validation shared by startup schema and pool construction. */
export function databaseTlsIssues(env: DatabaseSslEnv): DatabaseTlsIssue[] {
  const issues: DatabaseTlsIssue[] = [];
  if (env.NODE_ENV && !["development", "production", "test"].includes(env.NODE_ENV)) {
    issues.push({ variable: "NODE_ENV", message: "Database TLS policy requires a known NODE_ENV" });
  }
  let url: URL | undefined;
  if (env.DATABASE_URL) {
    try { url = databaseUrl(env.DATABASE_URL); }
    catch (error) { issues.push({ variable: "DATABASE_URL", message: (error as Error).message }); }
  }
  for (const flag of ["DATABASE_SSL", "DATABASE_SSL_REJECT_UNAUTHORIZED"] as const) {
    if (env[flag] && !["true", "false"].includes(env[flag]!)) issues.push({ variable: flag, message: `${flag} must be true or false` });
  }
  if (env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
    issues.push({ variable: "DATABASE_SSL_REJECT_UNAUTHORIZED", message: "Database certificate verification cannot be disabled" });
  }
  if (env.DATABASE_SSL === "false") {
    const guardedTest = env.NODE_ENV === "test" && ["unit", "database"].includes(env.PFA_TEST_MODE ?? "");
    if (env.NODE_ENV === "production" || !url || !loopback.has(url.hostname) ||
        (env.NODE_ENV === "test" && !guardedTest)) {
      issues.push({ variable: "DATABASE_SSL", message: "DATABASE_SSL=false is restricted to explicit local development or guarded test mode; production requires verified TLS" });
    }
    if (env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" || env.DATABASE_SSL_CA_CERT || env.DATABASE_SSL_CA_FILE || url?.search) {
      issues.push({ variable: "DATABASE_SSL_REJECT_UNAUTHORIZED", message: "TLS/CA options require DATABASE_SSL to be enabled" });
    }
  }
  if (env.DATABASE_SSL_CA_CERT !== undefined && env.DATABASE_SSL_CA_FILE !== undefined) {
    issues.push({ variable: "DATABASE_SSL_CA_FILE", message: "Set only one database CA source: DATABASE_SSL_CA_CERT or DATABASE_SSL_CA_FILE" });
  }
  return issues;
}

function readCaBundle(env: DatabaseSslEnv): string | undefined {
  let pem = env.DATABASE_SSL_CA_CERT;
  if (env.DATABASE_SSL_CA_FILE !== undefined) {
    try { pem = fs.readFileSync(env.DATABASE_SSL_CA_FILE, "utf8"); }
    catch { throw new Error("DATABASE_SSL_CA_FILE could not be read"); }
  }
  if (pem === undefined) return undefined; // Node's trusted CA store remains active.
  pem = pem.replace(/\\n/g, "\n").trim();
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  try {
    if (!blocks?.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) throw new Error();
    for (const block of blocks) if (!new X509Certificate(block).ca) throw new Error();
  } catch { throw new Error("DATABASE_SSL_CA_CERT/FILE must contain valid CA certificates only"); }
  return pem;
}

export function resolveDatabaseSsl(env: DatabaseSslEnv = process.env): PoolConfig["ssl"] {
  const issues = databaseTlsIssues(env);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.variable}: ${issue.message}`).join("\n"));
  const url = env.DATABASE_URL ? databaseUrl(env.DATABASE_URL) : undefined;
  const guardedLocalTest = env.NODE_ENV === "test" && ["unit", "database"].includes(env.PFA_TEST_MODE ?? "") &&
    url && loopback.has(url.hostname);
  const implicitGuardedPlaintext = guardedLocalTest && !env.DATABASE_SSL && !env.DATABASE_SSL_REJECT_UNAUTHORIZED &&
    env.DATABASE_SSL_CA_CERT === undefined && env.DATABASE_SSL_CA_FILE === undefined && !url?.search;
  if (env.DATABASE_SSL === "false" || implicitGuardedPlaintext) {
    if (env.DATABASE_SSL_CA_CERT !== undefined || env.DATABASE_SSL_CA_FILE !== undefined || url?.search) {
      throw new Error("DATABASE_SSL: guarded plaintext cannot contain TLS/CA options; explicitly enable verified TLS to use them");
    }
    return false; // Explicit false prevents ambient PGSSLMODE from replacing it.
  }
  const ca = readCaBundle(env);
  // pg omits host/servername when upgrading numeric sockets. Bind identity to
  // the configured endpoint rather than Node's fallback socket identity.
  const identity = url ? { checkServerIdentity: (_hostname: string, cert: Parameters<typeof checkServerIdentity>[1]) =>
    checkServerIdentity(url.hostname.replace(/^\[|\]$/g, ""), cert) } : {};
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}), ...identity };
}

/**
 * OPS-011: a test process gets a pool only after prepareTestEnvironment
 * (server/testing/test-target.mjs) has pinned DATABASE_URL to the verified
 * disposable target (database mode) or to a closed port (unit mode). A runner
 * that skips the protected configs (`vitest --no-config`, an ad hoc --config,
 * or a script run with NODE_ENV=test) would otherwise connect to whatever
 * database the ambient .env names.
 *
 * Called where the application pool is constructed (server/db.ts), not inside
 * resolveDatabaseConnection: that builder stays a pure env-to-config policy so
 * its TLS rules can be tested with synthetic environments.
 */
/**
 * The closed endpoint prepareTestEnvironment pins in unit mode (port 1, a
 * database name no real server holds). Kept in step with test-target.mjs.
 */
export const UNIT_TEST_DATABASE_URL = "postgresql://disabled:disabled@127.0.0.1:1/pfa_unit_database_disabled";

export function assertProtectedTestProcess(env: DatabaseSslEnv = process.env): void {
  const isTestProcess = env.NODE_ENV === "test" || Boolean(env.VITEST);
  if (!isTestProcess) return;
  const mode = env.PFA_TEST_MODE;
  // A-18: each mode binds the endpoint, so markers set by hand outside the
  // launcher cannot pass an ambient DATABASE_URL through in unit mode.
  const isBoundEndpoint = mode === "database"
    ? env.DATABASE_URL === env.TEST_DATABASE_URL
    : env.DATABASE_URL === UNIT_TEST_DATABASE_URL;
  const isPrepared = (mode === "unit" || mode === "database") && env.PFA_TEST_OUTBOUND === "deny" && isBoundEndpoint;
  if (!isPrepared) {
    throw new Error("REFUSING TEST TARGET: a test process reached the database without the protected test " +
      "environment. Run tests through the npm scripts (scripts/run-protected-tests.mjs); the ambient DATABASE_URL is never used.");
  }
}

export function resolveDatabaseConnection(env: DatabaseSslEnv = process.env): PoolConfig & {
  host: string; port: number; database: string; user: string; password: string;
} {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const ssl = resolveDatabaseSsl(env);
  const url = databaseUrl(env.DATABASE_URL);
  try {
    const database = decodeURIComponent(url.pathname.slice(1));
    if (/[\/\x00]/.test(database)) throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port ? +url.port : 5432,
      database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl,
    };
  } catch { throw new Error("DATABASE_URL contains an invalid encoded user/password/database field"); }
}
