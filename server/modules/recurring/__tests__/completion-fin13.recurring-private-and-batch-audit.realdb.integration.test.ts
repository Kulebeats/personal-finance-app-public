/**
 * FIN-13 follow-ups (review of #362), recurring. REAL HTTP against real
 * Postgres, synthetic data only.
 *
 * - A rule created from a transaction on a private account keeps the household
 *   off its audit row, as create-with-transaction already does, so members who
 *   read the household's audit trail do not see the private source.
 * - POST /api/recurring/process posts each occurrence in its own transaction
 *   (each audited there), so its run summary cannot share one transaction with
 *   them. When the summary row cannot be written the response says so instead
 *   of reporting a clean run.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const trigger = `fin13_batch_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const as = (role: "owner" | "member") => ({
  post: (path: string) => request(app).post(path).set("Cookie", actors.get(role)!.cookie),
});

/** Makes this household's next recurring_batch audit insert fail, as a broken audit store would. */
async function blockBatchAudit() {
  await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN
      IF NEW.household_id = '${a}'::uuid AND NEW.entity_type = 'recurring_batch' THEN RAISE EXCEPTION 'Synthetic FIN-13 audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

async function unblockBatchAudit() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}

const clearAudits = () => pool.query("delete from audit_logs where household_id=$1 or user_id = any($2::uuid[])",
  [a, [...actors.values()].map(({ id }) => id)]);
const batchAudits = async () =>
  (await pool.query("select * from audit_logs where household_id=$1 and entity_type='recurring_batch'", [a])).rows;

async function clearRules() {
  await pool.query("delete from recurring_transaction_links where recurring_transaction_id in (select id from recurring_transactions where household_id=$1)", [a]);
  await db.update(transactions).set({ isRecurring: false, recurringTransactionId: null }).where(eq(transactions.householdId, a));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
}

/** A ZMW rule due in the past, created over HTTP so its denomination is proven. */
async function dueRule(): Promise<string> {
  const response = await as("member").post("/api/recurring").send({
    accountId: ids.sharedAccount, type: "expense", name: "FIN-13 due rent", frequency: "monthly", nextDueDate: "2026-11-01",
    amount: { amount: "25.00", currency: "ZMW" },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

describe("FIN-13 follow-ups: recurring audit rows", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clearRules();
    await reset();
    await clearAudits();
  });
  afterEach(async () => {
    await unblockBatchAudit();
    await clearRules();
  });
  afterAll(async () => {
    await unblockBatchAudit();
    await clearAudits();
    await stop();
  });

  it("a rule created from a transaction on a private account has no household on its audit row", async () => {
    const response = await as("owner").post(`/api/recurring/transaction/${ids.privateTx}`).send({ frequency: "monthly" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const ruleId = response.body.data.recurringRule.id as string;

    const { rows } = await pool.query("select * from audit_logs where entity_type='recurring_rule' and entity_id=$1", [ruleId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", household_id: null, user_id: actors.get("owner")!.id });
  });

  it("a processed run writes one summary row and reports it recorded", async () => {
    await dueRule();
    const response = await as("member").post("/api/recurring/process").send({});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ created: 1, auditRecorded: true });

    const rows = await batchAudits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "PROCESS", user_id: actors.get("member")!.id });
    expect(rows[0].details).toMatchObject({ processed: 1, created: 1, errors: 0 });
  });

  it("a run whose summary row cannot be written says so, and keeps the posted occurrence", async () => {
    const ruleId = await dueRule();
    await blockBatchAudit();
    const response = await as("member").post("/api/recurring/process").send({});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ created: 1, auditRecorded: false });

    expect(await batchAudits()).toEqual([]);
    const posted = await db.select().from(transactions).where(eq(transactions.recurringTransactionId, ruleId));
    expect(posted).toHaveLength(1);
  });
});
