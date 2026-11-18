/**
 * Test-database resolution guard.
 *
 * This logic decides which database the server suite DELETES rows from, so it
 * gets real tests rather than trust. The bug it prevents was observed live on
 * 2026-07-20: server tests ran against dev `finance_app` and wiped a fixture
 * mid-session (a working login started returning 401 with no code change).
 *
 * @module testing/__tests__/test-database.test
 */

import { describe, it, expect } from 'vitest';
import { resolveTestDatabaseUrl, assertNotDevDatabase } from '../test-database';

const DEV = 'postgres://u:p@localhost:5432/finance_app';
const CI = 'postgres://ci:ci@localhost:5432/pfa_test';

describe('resolveTestDatabaseUrl', () => {
  it('derives a sibling _test database from the dev URL', () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: DEV })).toBe(
      'postgres://u:p@localhost:5432/finance_app_test'
    );
  });

  it('leaves an already test-scoped database alone (CI would otherwise get pfa_test_test)', () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: CI })).toBe(CI);
  });

  it('treats an explicit TEST_DATABASE_URL as authoritative', () => {
    const explicit = 'postgres://u:p@db:5432/somewhere_test';
    expect(
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: explicit, DATABASE_URL: DEV })
    ).toBe(explicit);
  });

  it('preserves credentials, host, and port when deriving', () => {
    const out = new URL(
      resolveTestDatabaseUrl({ DATABASE_URL: 'postgres://bob:s3cret@db.internal:6543/prod_data' })
    );
    expect(out.username).toBe('bob');
    expect(out.password).toBe('s3cret');
    expect(out.host).toBe('db.internal:6543');
    expect(out.pathname).toBe('/prod_data_test');
  });

  it('throws rather than silently defaulting when nothing is configured', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/No database configured/i);
  });

  it('throws on a malformed DATABASE_URL instead of guessing', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: 'not-a-url' })).toThrow(
      /not a valid connection URL/i
    );
  });
});

describe('assertNotDevDatabase', () => {
  it('refuses when an explicit override points back at the dev database', () => {
    // The failure mode the derive step cannot catch: a stale shell export or
    // copy-pasted TEST_DATABASE_URL aimed straight at dev.
    expect(() => assertNotDevDatabase(DEV, DEV)).toThrow(/REFUSING TO RUN/);
    expect(() => assertNotDevDatabase(DEV, DEV)).toThrow(/finance_app/);
  });

  it('refuses any database whose name is not test-scoped', () => {
    expect(() =>
      assertNotDevDatabase('postgres://u:p@localhost:5432/staging', DEV)
    ).toThrow(/not a test-scoped database name/i);
  });

  it('names the fix in the error so the failure is actionable', () => {
    expect(() => assertNotDevDatabase(DEV, DEV)).toThrow(/npm run db:test:setup/);
  });

  it('allows the derived test database', () => {
    expect(() =>
      assertNotDevDatabase('postgres://u:p@localhost:5432/finance_app_test', DEV)
    ).not.toThrow();
  });

  it('allows the CI database', () => {
    expect(() => assertNotDevDatabase(CI, CI)).not.toThrow();
  });
});
