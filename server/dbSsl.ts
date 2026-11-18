import fs from "node:fs";
import type { PoolConfig } from "pg";

type DatabaseSslEnv = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  DATABASE_SSL?: string;
  DATABASE_SSL_REJECT_UNAUTHORIZED?: string;
  DATABASE_SSL_CA_CERT?: string;
  DATABASE_SSL_CA_FILE?: string;
};

function isExplicitTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function isExplicitFalse(value: string | undefined): boolean {
  return value?.toLowerCase() === "false";
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function readCaBundle(env: DatabaseSslEnv): string | undefined {
  if (env.DATABASE_SSL_CA_CERT) {
    return normalizePem(env.DATABASE_SSL_CA_CERT);
  }

  if (env.DATABASE_SSL_CA_FILE) {
    try {
      return normalizePem(fs.readFileSync(env.DATABASE_SSL_CA_FILE, "utf8"));
    } catch (error) {
      throw new Error(
        `DATABASE_SSL_CA_FILE could not be read: ${env.DATABASE_SSL_CA_FILE}`,
        { cause: error },
      );
    }
  }

  return undefined;
}

// TLS resolution: managed Postgres (e.g. Render) requires SSL, while local dev
// over localhost does not. Enable SSL in production by default; `DATABASE_SSL`
// overrides explicitly ("true"/"false") for cases like a local prod-mode smoke test.
export function resolveDatabaseSsl(
  env: DatabaseSslEnv = process.env,
): PoolConfig["ssl"] {
  const enabled =
    isExplicitTrue(env.DATABASE_SSL) ||
    (!isExplicitFalse(env.DATABASE_SSL) && env.NODE_ENV === "production");

  if (!enabled) return undefined;

  const rejectUnauthorized = isExplicitTrue(
    env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  );
  const ca = readCaBundle(env);

  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}
