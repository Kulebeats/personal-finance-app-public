import { sql } from "drizzle-orm";
import { fxRates } from "@shared/schema";
import { db } from "../../db";
import { assertDatabaseIdentity, loadTestTarget } from "../test-target.mjs";

export const POSITIVE_SHARED_FX_CONSTRAINT = "chk_fx_rates_positive";

/** Seed synthetic rows that could have existed before migration 0062. */
export async function insertLegacySharedFxRates(rows: Array<typeof fxRates.$inferInsert>) {
  if (process.env.PFA_TEST_MODE !== "database") {
    throw new Error("Legacy FX fixtures require protected database mode");
  }
  const target = loadTestTarget();
  await db.transaction(async tx => {
    const identity = await tx.execute<{ database: string; host: string; port: number; marker: string }>(sql`
      SELECT current_database() AS database, host(inet_server_addr()) AS host,
        inet_server_port() AS port, shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()
    `);
    assertDatabaseIdentity(identity.rows, target);

    const existing = await tx.execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'fx_rates'::regclass AND conname = ${POSITIVE_SHARED_FX_CONSTRAINT}
    `);
    const definition = existing.rows[0]?.definition;
    if (definition) await tx.execute(sql`ALTER TABLE fx_rates DROP CONSTRAINT chk_fx_rates_positive`);
    await tx.insert(fxRates).values(rows);
    // The historical row and the restored check become visible together.
    if (definition) {
      await tx.execute(sql.raw(`ALTER TABLE fx_rates ADD CONSTRAINT chk_fx_rates_positive ${definition}`));
    }
  });
}
