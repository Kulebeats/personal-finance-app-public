import { describe, it, expect } from "vitest";
import { resolveTestDatabaseUrl, assertNotDevDatabase, type TestTarget } from "../test-database";

const target: TestTarget = {
  version: 1, disposable: true, synthetic: true, host: "127.0.0.1", port: 55432,
  database: "pfa_completion_r00_regression123_test", runId: "regression123",
};
const safe = "postgresql://fixture:synthetic@127.0.0.1:55432/pfa_completion_r00_regression123_test";
const env = { TEST_DATABASE_URL: safe, TEST_TARGET: target, TEST_RUN_ID: target.runId };

describe("explicit disposable database contract", () => {
  it("accepts an exact manifest-bound synthetic target", () => {
    expect(resolveTestDatabaseUrl(env)).toBe(safe);
    expect(() => assertNotDevDatabase(safe, undefined, env)).not.toThrow();
  });
  it("never derives or trusts an ambient DATABASE_URL", () => {
    for (const DATABASE_URL of [safe, "postgres://fixture@localhost:5432/finance_app"]) {
      expect(() => resolveTestDatabaseUrl({ DATABASE_URL })).toThrow(/TEST_DATABASE_URL/);
    }
  });
  it("requires the manifest and matching run marker", () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: safe })).toThrow(/TEST_TARGET_MANIFEST/);
    expect(() => resolveTestDatabaseUrl({ ...env, TEST_RUN_ID: "foreignrun" })).toThrow(/run marker/);
  });
  it.each(["finance_app", "finance_app_test", "prod_test", "pfa_test", ""])('refuses unmanaged database %s', (database) => {
    expect(() => resolveTestDatabaseUrl({ ...env, TEST_TARGET: { ...target, database } })).toThrow(/database/);
  });
  it.each(["db.internal", "example.invalid", "0.0.0.0", "127.1.2.3"])('refuses unapproved host %s', (host) => {
    expect(() => resolveTestDatabaseUrl({ ...env, TEST_TARGET: { ...target, host } })).toThrow(/host/);
  });
  it.each(["?host=example.invalid", "?port=5432", "?sslmode=require", "?", "#", "#fragment"])('rejects connection override %s', (suffix) => {
    expect(() => resolveTestDatabaseUrl({ ...env, TEST_DATABASE_URL: safe + suffix })).toThrow(/query\/fragment/);
  });
  it.each(["%66inance_app", "%2Ffinance_app", "pfa_test%00", "pfa_test/other"])('rejects encoded or malformed database %s', (database) => {
    expect(() => resolveTestDatabaseUrl({ ...env, TEST_DATABASE_URL: safe.replace(target.database, database) })).toThrow(/unencoded/);
  });
  it("never echoes connection credentials in refusals", () => {
    try { resolveTestDatabaseUrl({ ...env, TEST_DATABASE_URL: safe + "?host=example.invalid" }); }
    catch (error) { expect(String(error)).not.toContain("synthetic@"); }
  });
});
