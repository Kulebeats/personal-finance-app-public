/**
 * Test database resolution — keeps the server suite off the dev database.
 *
 * WHY THIS EXISTS: `server/vitest.config.ts` loads the repo `.env`, so
 * `DATABASE_URL` pointed at the DEV database (`finance_app`). The real-DB
 * integration suites create users/households and DELETE them in `afterAll`, so
 * running the server tests destroyed live dev data. Observed 2026-07-20: a
 * hand-made fixture vanished mid-session and a working login started returning
 * 401 with no code change in between.
 *
 * CLAUDE.md already warned "needs a Postgres test DB, NEVER finance_app" — but
 * it was honour-system only, and the workaround was ~20 hand-made
 * `finance_app_<packet>_test` databases littering the local server. This module
 * makes the safe thing automatic and the unsafe thing impossible.
 *
 * @module testing/test-database
 */

/** A database name we consider already test-scoped (CI's `pfa_test`, `finance_app_test`, …). */
function isTestScoped(dbName: string): boolean {
  return /(^|_)test(_|$)/.test(dbName) || /_test$/.test(dbName);
}

export interface ResolveOptions {
  /** Explicit override; wins over everything. */
  TEST_DATABASE_URL?: string;
  /** The ambient (usually dev) connection string. */
  DATABASE_URL?: string;
}

/**
 * Resolve the connection string the server test suite should use.
 *
 * Order:
 *  1. `TEST_DATABASE_URL` — explicit wins, used as-is.
 *  2. `DATABASE_URL` whose database name is ALREADY test-scoped — used as-is.
 *     This is the CI path (`pfa_test`); deriving there would wrongly produce
 *     `pfa_test_test`.
 *  3. Otherwise derive a sibling `<name>_test` database. Local dev
 *     `finance_app` becomes `finance_app_test`, which is the convention the
 *     repo already used by hand.
 *
 * Throws rather than silently falling back, because every failure mode here
 * ends in "the suite quietly wrote to the wrong database".
 */
export function resolveTestDatabaseUrl(env: ResolveOptions): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const ambient = env.DATABASE_URL?.trim();
  if (!ambient) {
    throw new Error(
      'No database configured for tests. Set TEST_DATABASE_URL, or set DATABASE_URL ' +
        'so a sibling <name>_test database can be derived.'
    );
  }

  let url: URL;
  try {
    url = new URL(ambient);
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid connection URL, so no test database could be derived. ' +
        'Set TEST_DATABASE_URL explicitly.'
    );
  }

  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName) {
    throw new Error(
      'DATABASE_URL has no database name, so no test database could be derived. ' +
        'Set TEST_DATABASE_URL explicitly.'
    );
  }

  if (isTestScoped(dbName)) return ambient;

  url.pathname = `/${dbName}_test`;
  return url.toString();
}

/**
 * Fail loudly if the suite is about to run against the developer's database.
 *
 * This is the actual safety net: `resolveTestDatabaseUrl` should never return
 * the dev URL, but an explicit `TEST_DATABASE_URL=...finance_app` (copy-paste,
 * a stale shell export, a misconfigured CI secret) would sail straight through.
 * The suite deletes rows, so a wrong answer here is destructive and silent —
 * exactly the case worth an assertion.
 */
export function assertNotDevDatabase(
  resolvedUrl: string,
  ambientUrl: string | undefined
): void {
  const nameOf = (u: string): string | undefined => {
    try {
      return new URL(u).pathname.replace(/^\//, '') || undefined;
    } catch {
      return undefined;
    }
  };

  const resolved = nameOf(resolvedUrl);
  if (!resolved) return;

  const ambient = ambientUrl ? nameOf(ambientUrl) : undefined;
  const isAmbientDev = !!ambient && !isTestScoped(ambient);

  if (isAmbientDev && resolved === ambient) {
    throw new Error(
      `REFUSING TO RUN: the server test suite is pointed at "${resolved}", which is the ` +
        'database DATABASE_URL uses. These tests DELETE users and households in cleanup ' +
        'and would destroy your data.\n' +
        `Fix: unset TEST_DATABASE_URL to use the derived "${resolved}_test", or point it ` +
        'at a dedicated test database. Create one with: npm run db:test:setup'
    );
  }

  if (!isTestScoped(resolved)) {
    throw new Error(
      `REFUSING TO RUN: "${resolved}" is not a test-scoped database name (expected it to ` +
        'contain "test"). The server suite deletes rows in cleanup.\n' +
        'Fix: point TEST_DATABASE_URL at a dedicated test database, e.g. ' +
        'postgres://user:pass@localhost:5432/finance_app_test — create it with: ' +
        'npm run db:test:setup'
    );
  }
}
