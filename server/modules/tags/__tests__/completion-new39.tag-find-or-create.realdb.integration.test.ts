/**
 * NEW-39: the find-or-create tag writers under a concurrent first writer.
 *
 * Another transaction has inserted the tag but not committed when the writer starts.
 * The writer must wait for it, then reuse that tag, never fail on the unique index
 * uq_tags_household_name. A plain create that loses the same race is a 409.
 * Real Postgres; the holder is a second pooled connection.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../../db";
import { pendingReceipts, tags, transactionTags } from "@shared/schema";
import { tagWriteRepository } from "../../../repositories/TagWriteRepository";
import { receiptTransactionService } from "../../../services/receipt/transaction.service";
import { withTransaction } from "../../../utils/withTransaction";
import { ConflictError } from "../../../core/errors";
import { tagService } from "../tags.service";
import { a, actors, ids, reset, start, stop } from "./completion-r04.tags.fixture";

const WAIT_LIMIT_MS = 8000;

/** Resolve once some backend is waiting on the holder's locks. */
async function waiterBlockedBy(holderPid: number): Promise<void> {
  const limit = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < limit) {
    const { rows } = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [holderPid]);
    if (rows.length) return;
  }
  throw new Error("No synthetic writer waited on the holder");
}

/** Run `writer` while another transaction holds an uncommitted tag of `name`, then commit it. */
async function raceFirstWriter<T>(name: string, holdTagNameLock: boolean, writer: () => Promise<T>) {
  const holder = await pool.connect();
  try {
    const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await holder.query("BEGIN");
    if (holdTagNameLock) await holder.query("SELECT pg_advisory_xact_lock(1952540526, hashtext($1))", [a]);
    const { rows: [first] } = await holder.query<{ id: string }>(
      "INSERT INTO tags (household_id, name, usage_count) VALUES ($1, $2, 0) RETURNING id", [a, name]);
    const pending = writer().then((value) => ({ value }), (error: unknown) => ({ error }));
    await waiterBlockedBy(holderPid);
    await holder.query("COMMIT");
    return { firstId: first.id, outcome: await pending };
  } catch (error) {
    await holder.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    holder.release();
  }
}

const tagsNamed = (name: string) => db.select().from(tags)
  .where(and(eq(tags.householdId, a), sql`lower(${tags.name}) = lower(${name})`));

describe("NEW-39 find-or-create tag writers", () => {
  beforeAll(start, 20000); beforeEach(reset); afterAll(stop);
  afterEach(() => db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a)));

  it("receipt match reuses a Receipt Import tag another transaction committed first", async () => {
    const owner = actors.get("owner")!.id, receiptId = randomUUID();
    await db.insert(pendingReceipts).values({ id: receiptId, householdId: a, uploadedBy: owner, filename: "r.png",
      originalFilename: "r.png", mimeType: "image/png", size: 1, storagePath: `uploads/receipts/${a}/r.png` });

    const { firstId, outcome } = await raceFirstWriter("receipt import", false,
      () => receiptTransactionService.linkReceiptToTransaction(receiptId, ids.sharedTx, a, owner, { skipAmountValidation: true }));

    expect(outcome).toEqual({ value: true });
    const rows = await tagsNamed("Receipt Import");
    expect(rows.map((row) => row.id)).toEqual([firstId]);
    expect(rows[0].usageCount).toBe(1);
    const links = await db.select().from(transactionTags).where(eq(transactionTags.transactionId, ids.sharedTx));
    expect(links.map((link) => link.tagId)).toContain(firstId);
  });

  it("receipt match never applies a Receipt Import tag that belongs to someone outside the household", async () => {
    const owner = actors.get("owner")!.id, receiptId = randomUUID();
    await db.insert(tags).values({ householdId: a, name: "receipt import", memberSpecific: true, memberId: actors.get("outsider")!.id });
    await db.insert(pendingReceipts).values({ id: receiptId, householdId: a, uploadedBy: owner, filename: "r.png",
      originalFilename: "r.png", mimeType: "image/png", size: 1, storagePath: `uploads/receipts/${a}/r.png` });

    await expect(receiptTransactionService.linkReceiptToTransaction(receiptId, ids.sharedTx, a, owner, { skipAmountValidation: true }))
      .rejects.toBeInstanceOf(ConflictError);

    const [tag] = await tagsNamed("Receipt Import");
    expect(await db.select().from(transactionTags).where(eq(transactionTags.tagId, tag.id))).toEqual([]);
  });

  it("statement import waits on the tag-name lock and reuses the tag committed first", async () => {
    const member = actors.get("member")!.id;

    const { firstId, outcome } = await raceFirstWriter("Statement Tag", true,
      () => withTransaction((tx) => tagWriteRepository.prepareImport(tx, a, member, ["statement tag"]).then(() => "prepared")));

    expect(outcome).toEqual({ value: "prepared" });
    expect((await tagsNamed("Statement Tag")).map((row) => row.id)).toEqual([firstId]);
  });

  it("a create that loses the race to the unique index is a 409, not a raw database error", async () => {
    const { outcome } = await raceFirstWriter("Race Tag", false,
      () => tagService.createTag({ householdId: a, name: "RACE TAG" }));

    expect("error" in outcome && outcome.error).toBeInstanceOf(ConflictError);
    expect(await tagsNamed("Race Tag")).toHaveLength(1);
  });

  it("default tags skip a name the household has archived, in any case", async () => {
    await db.insert(tags).values({ householdId: a, name: "groceries", isArchived: true });

    const result = await tagService.createDefaultTags(a);

    expect(result.skipped).toBe(1);
    expect(await tagsNamed("Groceries")).toHaveLength(1);
  });
});
