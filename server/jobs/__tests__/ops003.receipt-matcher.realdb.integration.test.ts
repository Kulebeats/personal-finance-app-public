/**
 * OPS-003, REAL DB: the scheduled job receipts.match, run the way the
 * scheduler runs it (runScheduledJob with the real advisory locks and job
 * journal), matches a queued receipt and journals the run. A receipt whose
 * match throws closes the run as a partial failure, and a completed period is
 * not run again. The unit test (ops003.receipt-matcher.test.ts) mocks the
 * queue and the journal; this one does not.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobs, outboxEvents, pendingReceipts, transactions } from "@shared/schema";
import { db, pool } from "../../db";
import { SCHEDULED_RUN_PREFIX } from "../../core/scheduling/jobJournal";
import { SCHEDULED_JOBS } from "../../core/scheduling/jobRegistry";
import { runScheduledJob } from "../../core/scheduling/scheduledJob";
import { a, actors, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

/** A slot no other test or real schedule uses, so its period starts empty. */
const NOW = new Date("2001-03-14T04:00:00.250Z");
const PERIOD = "receipts.match@2001-03-14T04:00:00.000Z";
const JOURNAL_NAME = `${SCHEDULED_RUN_PREFIX}receipts.match`;
const BLOCK_TRIGGER = "block_ops003_receipt_link";

let receiptId: string;
let transactionId: string;

const receiptJob = () => {
  const job = SCHEDULED_JOBS.find((candidate) => candidate.name === "receipts.match");
  if (!job) throw new Error("receipts.match is not registered with the scheduler");
  return job;
};

async function dropBlock() {
  await pool.query(`drop trigger if exists ${BLOCK_TRIGGER} on audit_logs`);
  await pool.query(`drop function if exists ${BLOCK_TRIGGER}()`);
}

async function clean() {
  await db.delete(jobs).where(and(eq(jobs.name, JOURNAL_NAME), eq(jobs.idempotencyKey, PERIOD)));
  await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  await pool.query("delete from audit_logs where household_id=$1 or (entity_type='transaction' and entity_id=$2)",
    [a, transactionId ?? null]);
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
}

/** One posted expense and one queued receipt whose OCR amount matches it. */
async function seed() {
  receiptId = randomUUID(); transactionId = randomUUID();
  await db.insert(transactions).values({
    id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    date: "2026-11-10", name: "raw bank text 0042", amount: "25.00", type: "expense", isPrivate: false,
  });
  await db.insert(pendingReceipts).values({
    id: receiptId, householdId: a, uploadedBy: actors.get("owner")!.id, filename: "r.png", originalFilename: "r.png",
    mimeType: "image/png", size: 10, storagePath: `receipts/${receiptId}.png`, ocrStatus: "completed",
    ocrData: { amount: "25.00" }, nextMatchAt: new Date(0),
  });
}

const journal = () => db.select({ status: jobs.status, lastError: jobs.lastError, result: jobs.result })
  .from(jobs).where(and(eq(jobs.name, JOURNAL_NAME), eq(jobs.idempotencyKey, PERIOD)));
const storedReceipt = async () => {
  const [row] = await db.select({ matchStatus: pendingReceipts.matchStatus, matchedTransactionId: pendingReceipts.matchedTransactionId })
    .from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
  return row;
};

describe("receipts.match under the real scheduler runner and journal (OPS-003, real DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await dropBlock(); await clean(); await reset(); await seed(); });
  afterAll(async () => { await dropBlock(); await clean(); await stop(); });

  it("links the queued receipt and journals the period as completed", async () => {
    const outcome = await runScheduledJob(receiptJob(), undefined, NOW);

    expect(outcome).toMatchObject({ status: "completed" });
    expect(await storedReceipt()).toEqual({ matchStatus: "matched", matchedTransactionId: transactionId });
    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", lastError: null });
    expect(rows[0].result).toMatchObject({ failed: 0 });
    expect(Number((rows[0].result as Record<string, unknown>).matched)).toBeGreaterThanOrEqual(1);
  });

  it("does not run a completed period again", async () => {
    await runScheduledJob(receiptJob(), undefined, NOW);
    // A new queued receipt, due now: a second run of the same period must leave it alone.
    await seed();

    expect(await runScheduledJob(receiptJob(), undefined, NOW)).toEqual({ status: "skipped", reason: "PERIOD_DONE" });
    expect(await storedReceipt()).toEqual({ matchStatus: "pending", matchedTransactionId: null });
    expect(await journal()).toHaveLength(1);
  });

  it("journals a receipt whose link fails as a partial failure, and leaves the receipt unmatched", async () => {
    await pool.query(`create or replace function ${BLOCK_TRIGGER}() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'receipt' and new.entity_id = '${receiptId}' then raise exception 'link blocked for test'; end if;
        return new;
      end $$`);
    await pool.query(`create trigger ${BLOCK_TRIGGER} before insert on audit_logs for each row execute function ${BLOCK_TRIGGER}()`);

    const outcome = await runScheduledJob(receiptJob(), undefined, NOW);

    expect(outcome).toMatchObject({ status: "failed", errorCode: "PARTIAL_FAILURE" });
    expect(await storedReceipt()).toEqual({ matchStatus: "pending", matchedTransactionId: null });
    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", lastError: "PARTIAL_FAILURE" });
    expect(Number((rows[0].result as Record<string, unknown>).failed)).toBeGreaterThanOrEqual(1);
  });
});
