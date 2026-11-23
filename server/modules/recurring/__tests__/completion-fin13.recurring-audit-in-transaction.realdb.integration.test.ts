/**
 * FIN-13 / NEW-32 (recurring): each recurring rule write and its audit row
 * commit in one transaction. A write produces exactly one audit row, and when
 * the audit insert fails the write is rolled back, never committed unlogged.
 *
 * Writers: create, update, delete, link, unlink and create-from-transaction.
 * The lifecycle actions, pattern confirmation and create-with-transaction
 * already audit inside their transaction and are covered elsewhere. REAL HTTP
 * against real Postgres, synthetic data only. The audit failure is injected
 * by a trigger scoped to this file's household.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const trigger = `fin13_rule_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const member = () => actors.get("member")!;
const send = (method: "post" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", member().cookie);

/** Makes this household's next recurring audit insert fail, as a broken audit store would. */
async function blockRuleAudit() {
  await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN
      IF NEW.household_id = '${a}'::uuid AND NEW.entity_type = 'recurring_rule' THEN RAISE EXCEPTION 'Synthetic FIN-13 audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

async function unblockRuleAudit() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}

async function ruleAudits(ruleId: string) {
  return (await pool.query("select * from audit_logs where entity_type='recurring_rule' and entity_id=$1 order by created_at, id", [ruleId])).rows;
}

const createBody = (name: string) => ({
  accountId: ids.sharedAccount, type: "expense", name, frequency: "monthly", nextDueDate: "2027-06-01",
  amount: { amount: "25.00", currency: "ZMW" },
});

async function createRule(name = "FIN-13 synthetic rent"): Promise<string> {
  const response = await send("post", "/api/recurring").send(createBody(name));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id as string;
}

/** A rule seeded directly, for the link writers (as in the R04 lifecycle suite). */
async function seedRule(): Promise<string> {
  const id = randomUUID();
  await db.insert(recurringTransactions).values({
    id, householdId: a, accountId: ids.sharedAccount, name: "FIN-13 link rule", amount: "11.11",
    type: "expense", frequency: "monthly", startDate: "2026-11-01", nextDueDate: "2026-12-01",
  });
  return id;
}

const readRule = async (id: string) => (await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id)))[0];
const rulesOfHousehold = () => db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a));
const linksOf = (ruleId: string) => db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, ruleId));
const sharedTx = async () => (await db.select().from(transactions).where(eq(transactions.id, ids.sharedTx)))[0];
const link = (ruleId: string) => send("post", `/api/recurring/${ruleId}/link`).send({ transactionId: ids.sharedTx });
const clearAudits = () => pool.query("delete from audit_logs where household_id=$1", [a]);

async function clearRules() {
  await pool.query("delete from recurring_transaction_links where recurring_transaction_id in (select id from recurring_transactions where household_id=$1)", [a]);
  await db.update(transactions).set({ isRecurring: false, recurringTransactionId: null }).where(eq(transactions.householdId, a));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
}

describe("FIN-13: recurring rule writes and their audit rows commit together", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clearRules();
    await reset();
    await clearAudits();
  });
  afterEach(async () => {
    await unblockRuleAudit();
    await clearRules();
  });
  afterAll(async () => {
    await unblockRuleAudit();
    await clearAudits();
    await stop();
  });

  describe("POST /api/recurring", () => {
    it("writes one CREATE row with the rule", async () => {
      const id = await createRule();
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: member().id });
      expect(rows[0].details.newValue).toMatchObject({ name: "FIN-13 synthetic rent", amount: "25.00" });
    });

    it("creates no rule when its audit row cannot be written", async () => {
      await blockRuleAudit();
      expect((await send("post", "/api/recurring").send(createBody("FIN-13 unaudited"))).status).toBe(500);
      expect(await rulesOfHousehold()).toEqual([]);
    });
  });

  describe("PUT /api/recurring/:id", () => {
    it("writes one UPDATE row with the old and new values", async () => {
      const id = await createRule();
      await clearAudits();
      await send("put", `/api/recurring/${id}`).send({ name: "FIN-13 renamed" }).expect(200);
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "UPDATE", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ oldValue: { name: "FIN-13 synthetic rent" }, newValue: { name: "FIN-13 renamed" } });
    });

    it("leaves the rule unchanged when the audit row cannot be written", async () => {
      const id = await createRule();
      await blockRuleAudit();
      expect((await send("put", `/api/recurring/${id}`).send({ name: "FIN-13 renamed" })).status).toBe(500);
      expect((await readRule(id)).name).toBe("FIN-13 synthetic rent");
    });
  });

  describe("DELETE /api/recurring/:id", () => {
    it("writes one DELETE row with the deletion", async () => {
      const id = await createRule();
      await clearAudits();
      await send("delete", `/api/recurring/${id}`).expect(200);
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "DELETE", household_id: a, user_id: member().id });
      expect(rows[0].details.oldValue).toMatchObject({ name: "FIN-13 synthetic rent", accountId: ids.sharedAccount });
      expect(await readRule(id)).toBeUndefined();
    });

    it("keeps the rule when the deletion's audit row cannot be written", async () => {
      const id = await createRule();
      await blockRuleAudit();
      expect((await send("delete", `/api/recurring/${id}`)).status).toBe(500);
      expect(await readRule(id)).toBeDefined();
    });
  });

  describe("POST /api/recurring/:id/link", () => {
    it("writes one LINK row with the link", async () => {
      const id = await seedRule();
      expect((await link(id)).status).toBe(200);
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "LINK", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ transactionId: ids.sharedTx, matchMethod: "manual" });
    });

    it("writes no link when its audit row cannot be written", async () => {
      const id = await seedRule();
      await blockRuleAudit();
      expect((await link(id)).status).toBe(500);
      expect(await linksOf(id)).toEqual([]);
      expect(await sharedTx()).toMatchObject({ isRecurring: false, recurringTransactionId: null });
    });
  });

  describe("DELETE /api/recurring/:id/link/:linkId", () => {
    const linked = async () => {
      const id = await seedRule();
      expect((await link(id)).status).toBe(200);
      const [row] = await linksOf(id);
      await clearAudits();
      return { id, linkId: row.id };
    };

    it("writes one UNLINK row with the unlink", async () => {
      const { id, linkId } = await linked();
      await send("delete", `/api/recurring/${id}/link/${linkId}`).expect(200);
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "UNLINK", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ transactionId: ids.sharedTx, linkId });
    });

    it("keeps the link when the unlink's audit row cannot be written", async () => {
      const { id, linkId } = await linked();
      await blockRuleAudit();
      expect((await send("delete", `/api/recurring/${id}/link/${linkId}`)).status).toBe(500);
      expect((await linksOf(id)).map(row => row.id)).toEqual([linkId]);
      expect(await sharedTx()).toMatchObject({ isRecurring: true, recurringTransactionId: id });
    });
  });

  describe("POST /api/recurring/transaction/:transactionId", () => {
    const fromTransaction = () => send("post", `/api/recurring/transaction/${ids.sharedTx}`).send({ frequency: "monthly" });

    it("writes one CREATE row with the rule", async () => {
      const response = await fromTransaction();
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const id = response.body.data.recurringRule.id as string;
      const rows = await ruleAudits(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: member().id });
      expect(rows[0].details).toMatchObject({ newValue: { source: "transaction", transactionId: ids.sharedTx },
        operation: "createFromTransaction" });
    });

    it("creates no rule and leaves the transaction unlinked when the audit row cannot be written", async () => {
      await blockRuleAudit();
      expect((await fromTransaction()).status).toBe(500);
      expect(await rulesOfHousehold()).toEqual([]);
      expect(await sharedTx()).toMatchObject({ isRecurring: false, recurringTransactionId: null });
    });
  });
});
