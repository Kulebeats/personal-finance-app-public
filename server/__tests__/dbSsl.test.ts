import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProtectedTestProcess, resolveDatabaseConnection, resolveDatabaseSsl } from "../dbSsl";
import { prepareTestEnvironment } from "../testing/test-target.mjs";

const TEST_CA = rootCertificates[0]; // Node's built-in public CA; no network.

const createdPaths: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const createdPath of createdPaths.splice(0)) {
    fs.rmSync(createdPath, { force: true, recursive: true });
  }
});
describe("resolveDatabaseSsl", () => {
  it("defaults to verified TLS in development unless local plaintext is explicit", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "development" })).toEqual({ rejectUnauthorized: true });
  });

  it("enables certificate verification by default in production", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "production" })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("refuses plaintext production even when the endpoint is local", () => {
    expect(() => resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL: "false",
        DATABASE_URL: "postgresql://synthetic@127.0.0.1:55432/pfa_fixture_test",
      })).toThrow(/DATABASE_SSL/);
  });

  it("uses an inline CA bundle when strict verification is enabled", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_CERT: TEST_CA.replace(/\n/g, "\\n"),
      }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: TEST_CA,
    });
  });

  it("uses a mounted CA file when strict verification is enabled", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfa-db-ca-"));
    createdPaths.push(dir);
    const caFile = path.join(dir, "render-postgres-ca.pem");
    fs.writeFileSync(caFile, TEST_CA);

    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_FILE: caFile,
      }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: TEST_CA,
    });
  });

  it("fails fast when a configured CA file cannot be read", () => {
    expect(() =>
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_FILE: path.join(os.tmpdir(), "missing-ca.pem"),
      }),
    ).toThrow("DATABASE_SSL_CA_FILE could not be read");
  });

  it("retains explicitly protected local test plaintext and ignores ambient PGSSLMODE", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "test", PFA_TEST_MODE: "database",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:55432/pfa_fixture_test", PGSSLMODE: "no-verify" })).toBe(false);
  });

  it.each(["production", "development"])("refuses no-verify TLS in %s", (NODE_ENV) => {
    expect(() => resolveDatabaseSsl({ NODE_ENV, DATABASE_SSL_REJECT_UNAUTHORIZED: "false" })).toThrow(/verification/);
  });

  it("rejects malformed/conflicting CA inputs before a connection can be created", () => {
    for (const invalid of ["", "not-a-certificate", "-----BEGIN CERTIFICATE-----\nINVALID\n-----END CERTIFICATE-----"]) {
      expect(() => resolveDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL_CA_CERT: invalid })).toThrow(/CA/);
    }
    expect(() => resolveDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL_CA_CERT: TEST_CA,
      DATABASE_SSL_CA_FILE: "synthetic-not-read.pem" })).toThrow(/one.*CA|CA.*one/);
  });

  it.each(["sslmode=no-verify", "sslmode=disable", "ssl=false", "sslrootcert=private.pem", "host=private.invalid", "options=-c%20search_path%3Dpublic"])("refuses URL override %s", (query) => {
    expect(() => resolveDatabaseSsl({ NODE_ENV: "production", DATABASE_URL: `postgresql://synthetic@db.example.invalid/db?${query}` })).toThrow(/DATABASE_URL/);
  });

  it.each(["require", "verify-full"])("preserves legitimate sslmode=%s URLs with verified TLS and no parser override", (mode) => {
    vi.stubEnv("PGSSLMODE", "no-verify");
    const config = resolveDatabaseConnection({ NODE_ENV: "production",
      DATABASE_URL: `postgresql://synthetic:p%40ss@db.example.invalid:6432/fixture?sslmode=${mode}`, DATABASE_SSL_CA_CERT: TEST_CA });
    expect(config).toMatchObject({ host: "db.example.invalid", port: 6432, database: "fixture", user: "synthetic", password: "p@ss", ssl: { rejectUnauthorized: true, ca: TEST_CA } });
    expect(config.connectionString).toBeUndefined();
    // Constructor only: no network or pg connect; inspect pg's actual selected options.
    expect(Reflect.get(new pg.Client(config), "connectionParameters").ssl).toEqual(config.ssl);
    expect(config.ssl).toMatchObject({ checkServerIdentity: expect.any(Function) });
  });

  it("rejects fragments, duplicate TLS options, encoded database path and remote plaintext", () => {
    for (const suffix of ["#hidden", "?sslmode=require&sslmode=disable", "/bad%2fpath"]) {
      expect(() => resolveDatabaseConnection({ NODE_ENV: "production", DATABASE_URL: `postgresql://synthetic@db.example.invalid/fixture${suffix}` })).toThrow(/DATABASE_URL/);
    }
    expect(() => resolveDatabaseSsl({ NODE_ENV: "development", DATABASE_SSL: "false", DATABASE_URL: "postgresql://synthetic@db.example.invalid/db" })).toThrow(/DATABASE_SSL/);
  });

  it("rejects explicit port zero before pg can replace it with ambient PGPORT", () => {
    vi.stubEnv("PGPORT", "65432");
    expect(() => resolveDatabaseConnection({ NODE_ENV: "production",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:0/fixture" })).toThrow(/port/);
    const config = resolveDatabaseConnection({ NODE_ENV: "production",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:65431/fixture" });
    expect(Reflect.get(new pg.Client(config), "connectionParameters").port).toBe(65431);
  });

  it("does not downgrade an explicit verification request in a guarded local test", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "test", PFA_TEST_MODE: "database",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:55432/pfa_fixture_test", DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }))
      .toMatchObject({ rejectUnauthorized: true, checkServerIdentity: expect.any(Function) });
  });

  it("owned TLS fixture verifies trust and hostname with no external dispatch", () => {
    const fixture = fileURLToPath(new URL("./fixtures/r19-tls-proof.mjs", import.meta.url));
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]
      .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]!]));
    const child = spawnSync(process.execPath, ["--import", "tsx", fixture], { env, encoding: "utf8", timeout: 15000 });
    expect(child.status, child.stderr).toBe(0);
    const report = JSON.parse(child.stdout.trim());
    expect(report).toMatchObject({ host: "127.0.0.1", positiveVerified: true, unknownCARejected: true,
      wrongCARejected: true, wrongHostnameRejected: true, pgNumericVerified: true, pgWrongIdentityRejected: true,
      allowedConnections: 6, externalConnectionAttempts: 0, dnsLookups: 0 });
    expect(report.negativeCodes).toContain("ERR_TLS_CERT_ALTNAME_INVALID");
    console.log(JSON.stringify({ syntheticTLS: report }));
  }, 20000);
});

describe("assertProtectedTestProcess, the pool guard in server/db.ts (OPS-011)", () => {
  // A canary name for the ambient development database: if a refusal ever
  // regresses, the connection config names it and the test fails.
  const CANARY_URL = "postgresql://canary:canary-sentinel@127.0.0.1:1/ops011_canary_dev_db";
  const SAFE_URL = "postgresql://synthetic@127.0.0.1:55432/pfa_ci_ops011_run12345678_test";

  it.each([
    ["NODE_ENV=test with no protected environment", { NODE_ENV: "test" }],
    ["a Vitest worker under NODE_ENV=development (vitest --no-config)", { NODE_ENV: "development", VITEST: "true" }],
    ["PFA_TEST_MODE set by hand without the outbound deny", { NODE_ENV: "test", PFA_TEST_MODE: "database" }],
    ["database mode whose DATABASE_URL is not the verified TEST_DATABASE_URL",
      { NODE_ENV: "test", PFA_TEST_MODE: "database", PFA_TEST_OUTBOUND: "deny", TEST_DATABASE_URL: SAFE_URL }],
    // A-18: unit mode with both markers set by hand, outside the launcher: the
    // ambient DATABASE_URL must not be accepted just because the mode is unit.
    ["unit mode whose DATABASE_URL is not the launcher's closed unit endpoint",
      { NODE_ENV: "test", PFA_TEST_MODE: "unit", PFA_TEST_OUTBOUND: "deny" }],
  ])("refuses %s before naming any database", (_case, env) => {
    expect(() => assertProtectedTestProcess({ ...env, DATABASE_URL: CANARY_URL })).toThrow(/^REFUSING TEST TARGET/);
  });

  it("allows the prepared environments: unit mode and verified database mode", () => {
    expect(() => assertProtectedTestProcess({ NODE_ENV: "test", PFA_TEST_MODE: "unit", PFA_TEST_OUTBOUND: "deny",
      DATABASE_URL: "postgresql://disabled:disabled@127.0.0.1:1/pfa_unit_database_disabled" })).not.toThrow();
    expect(() => assertProtectedTestProcess({ NODE_ENV: "test", PFA_TEST_MODE: "database", PFA_TEST_OUTBOUND: "deny",
      DATABASE_URL: SAFE_URL, TEST_DATABASE_URL: SAFE_URL })).not.toThrow();
  });

  it("accepts the unit endpoint the protected launcher pins (A-18), with no connection made", () => {
    const env: Record<string, string | undefined> = { PFA_TEST_MODE: "unit", DATABASE_URL: CANARY_URL };
    prepareTestEnvironment(env);
    expect(env.DATABASE_URL).not.toBe(CANARY_URL);
    expect(() => assertProtectedTestProcess(env)).not.toThrow();
  });

  it("lets a production process through, and leaves the TLS policy builder pure for synthetic environments", () => {
    expect(() => assertProtectedTestProcess({ NODE_ENV: "production", DATABASE_URL: CANARY_URL })).not.toThrow();
    expect(resolveDatabaseConnection({ NODE_ENV: "test", DATABASE_URL: CANARY_URL }).database).toBe("ops011_canary_dev_db");
  });
});
