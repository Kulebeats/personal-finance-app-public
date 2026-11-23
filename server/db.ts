import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, defaults as pgDefaults } from "pg";
import * as schema from "@shared/schema";
import { assertProtectedTestProcess, resolveDatabaseConnection } from "./dbSsl";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * NEW-15: one clock for `timestamp without time zone` columns — UTC wall time.
 * Drizzle writes JS dates as UTC; DB `now()`/`defaultNow()` writes the wall
 * time of the session zone. Pinning every session to UTC (the startup option
 * overrides the server and database default) and serialising raw
 * node-postgres Date parameters as UTC puts all three writers on one clock.
 */
export const UTC_SESSION_OPTION = "-c TimeZone=UTC";
pgDefaults.parseInputDatesAsUTC = true;

// OPS-011: a test process that skipped the protected test environment never
// gets a pool for the ambient database.
assertProtectedTestProcess();

// Create connection pool for PostgreSQL
export const pool = new Pool({
  ...resolveDatabaseConnection(),
  options: [process.env.PGOPTIONS, UTC_SESSION_OPTION].filter(Boolean).join(" "),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create Drizzle instance
export const db = drizzle(pool, { schema });
