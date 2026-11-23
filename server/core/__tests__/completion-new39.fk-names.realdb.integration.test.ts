/**
 * NEW-39: foreign keys carry explicit names under Postgres's 63-byte identifier limit, so
 * the database's names match the drizzle snapshot exactly instead of being silently
 * truncated. The rename migration keeps each FK's delete rule, is a no-op on a second run,
 * and refuses an FK that has neither its old nor its new name. Real Postgres catalog.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../db";
import { withTransaction } from "../../utils/withTransaction";

const MIGRATIONS = path.resolve(process.cwd(), "..", "migrations");
const RENAME_SQL = readFileSync(path.join(MIGRATIONS, "0049_new39_fk_names.sql"), "utf8");
const renames = [...RENAME_SQL.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'\)/g)]
  .map(([, table, oldName, newName]) => ({ table, oldName, newName }));

interface SnapshotForeignKey { name: string; onDelete?: string }
interface Snapshot { tables: Record<string, { name: string; foreignKeys: Record<string, SnapshotForeignKey> }> }
const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number }[] };
const latestIdx = String(journal.entries.at(-1)!.idx).padStart(4, "0");
const snapshot = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", `${latestIdx}_snapshot.json`), "utf8")) as Snapshot;
const snapshotKeys = Object.values(snapshot.tables).flatMap((table) =>
  Object.values(table.foreignKeys).map((fk) => ({ table: table.name, name: fk.name, onDelete: fk.onDelete ?? "no action" })));

const DELETE_RULES: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

async function foreignKeys(): Promise<Map<string, string>> {
  const result = await db.execute<{ table_name: string; name: string; rule: string }>(sql`
    SELECT t.relname AS table_name, c.conname AS name, c.confdeltype AS rule
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.contype = 'f' AND t.relnamespace = 'public'::regnamespace`);
  return new Map(result.rows.map((row) => [`${row.table_name}.${row.name}`, DELETE_RULES[row.rule] ?? row.rule]));
}

async function failure(work: Promise<unknown>): Promise<string> {
  try { await work; return "resolved"; } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
}

describe("NEW-39 explicit foreign-key names (real Postgres)", () => {
  it("no foreign key in the latest snapshot is longer than 63 characters", () => {
    expect(renames).toHaveLength(14);
    expect(snapshotKeys.filter((fk) => fk.name.length > 63).map((fk) => fk.name)).toEqual([]);
  });

  it("each renamed foreign key exists under its new name with its delete rule, and no truncated name is left", async () => {
    const live = await foreignKeys();
    for (const { table, oldName, newName } of renames) {
      const expected = snapshotKeys.find((fk) => fk.table === table && fk.name === newName);
      expect(expected, newName).toBeDefined();
      expect(live.get(`${table}.${newName}`), newName).toBe(expected!.onDelete);
      expect(live.has(`${table}.${oldName.slice(0, 63)}`), oldName).toBe(false);
    }
  });

  it("a second run changes nothing, and a missing foreign key is refused, not skipped", async () => {
    const before = await foreignKeys();
    await db.execute(sql.raw(RENAME_SQL));
    expect(await foreignKeys()).toEqual(before);

    const [first] = renames;
    const message = await failure(withTransaction(async (tx) => {
      await tx.execute(sql.raw(`ALTER TABLE "${first.table}" DROP CONSTRAINT "${first.newName}"`));
      await tx.execute(sql.raw(RENAME_SQL));
    }));
    expect(message).toBe(`NEW-39: foreign key ${first.newName} on ${first.table} has neither its old nor its new name`);
    expect(await foreignKeys()).toEqual(before);
  });
});
