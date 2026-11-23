/**
 * NEW-39: the database itself refuses a second tag whose name differs only by case in
 * one household (uq_tags_household_name), including for writers that bypass the
 * service's lock. The migration's preflight refuses existing duplicates with counts
 * only, and never merges or renames them. Real Postgres; synthetic households.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { households, tags } from "@shared/schema";
import { db } from "../../../db";
import { withTransaction } from "../../../utils/withTransaction";
import { getPostgresError } from "../../../utils/postgresError";
import { ConflictError } from "../../../core/errors";
import { StorageTagModule } from "../../../storage/StorageTagModule";
import { TAG_NAME_TAKEN } from "../tags.name-guard";

const MIGRATION = path.resolve(process.cwd(), "..", "migrations", "0048_new39_tags_scoped_unique.sql");
const statements = readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
let first: string;
let second: string;

async function failure(work: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try { await work; return {}; } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return { code: getPostgresError(error)?.code, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

beforeAll(async () => {
  const rows = await db.insert(households).values([{ name: "NEW-39 synthetic A" }, { name: "NEW-39 synthetic B" }]).returning({ id: households.id });
  [first, second] = rows.map((row) => row.id);
});
afterAll(async () => {
  await db.delete(tags).where(inArray(tags.householdId, [first, second]));
  await db.delete(households).where(inArray(households.id, [first, second]));
});

describe("NEW-39 tag scoped uniqueness (real Postgres)", () => {
  it("refuses a case-only duplicate in one household, archived or not, and allows it in another", async () => {
    await db.insert(tags).values({ householdId: first, name: "Synthetic Groceries", isArchived: true });
    const duplicate = await failure(db.insert(tags).values({ householdId: first, name: "SYNTHETIC groceries" }));
    expect(duplicate.code).toBe("23505");
    await db.insert(tags).values({ householdId: second, name: "synthetic groceries" });
    const names = await db.select({ householdId: tags.householdId }).from(tags)
      .where(and(inArray(tags.householdId, [first, second]), sql`lower(${tags.name}) = 'synthetic groceries'`));
    expect(names).toHaveLength(2);
  });

  it("the legacy storage rename onto a case-only duplicate is a 409 conflict, not a raw unique violation", async () => {
    // No live caller today (the API renames through tagService); the legacy writer must still not leak a 23505.
    const [, travel] = await db.insert(tags).values([{ householdId: first, name: "Synthetic Food" }, { householdId: first, name: "Synthetic Travel" }])
      .returning({ id: tags.id });
    const rename = new StorageTagModule().updateTag(travel.id, first, { name: "synthetic FOOD" });
    await expect(rename).rejects.toBeInstanceOf(ConflictError);
    await expect(rename).rejects.toMatchObject({ statusCode: 409, message: TAG_NAME_TAKEN });
    expect((await db.select({ name: tags.name }).from(tags).where(eq(tags.id, travel.id)))[0].name).toBe("Synthetic Travel");
  });

  it("the migration preflight refuses existing duplicates with counts only and leaves them untouched", async () => {
    const outcome = await failure(withTransaction(async (tx) => {
      await tx.execute(sql`DROP INDEX "uq_tags_household_name"`);
      await tx.insert(tags).values([{ householdId: second, name: "Synthetic Quokka" }, { householdId: second, name: "synthetic QUOKKA" }]);
      for (const statement of statements) await tx.execute(sql.raw(statement));
    }));
    expect(outcome.message).toMatch(/^NEW-39: 1 household tag name group\(s\) \(2 tags\)/);
    expect(outcome.message).not.toMatch(/quokka/i);
    const index = await db.execute(sql`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_tags_household_name'`);
    expect(index.rows).toHaveLength(1);
    expect(await db.select().from(tags).where(and(eq(tags.householdId, second), sql`lower(${tags.name}) = 'synthetic quokka'`))).toEqual([]);
  });
});
