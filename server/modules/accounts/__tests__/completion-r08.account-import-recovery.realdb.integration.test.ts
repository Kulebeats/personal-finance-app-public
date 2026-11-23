import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, householdMembers, households, tags, users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { lockTransactionCreateGrant } from "../../../repositories/TransactionCreateBoundary";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { analyticsCache } from "../../../services/AnalyticsCache";
/** FIN-04: the import's total is a MoneyDto in the account currency, never a plain number. */
const usd = (whole: string) => ({ amount: `${whole}.00`, currency: "USD" });

const householdId = randomUUID(), userId = randomUUID();
let app: Awaited<ReturnType<typeof getTestApp>>, cookie: string;
let accountId: string, tagId: string, tagName: string;

function importRow() {
  return request(app).post("/api/accounts/" + accountId + "/transactions/import")
    .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
    .send({ adjustBalance: true, transactions: [{ date: "2026-11-02", merchant: "Synthetic CSV recovery",
      amount: "-10.00", tags: tagName }] });
}
async function state() {
  return {
    account: (await pool.query("SELECT balance,initial_balance,currency FROM accounts WHERE id=$1 AND household_id=$2", [accountId, householdId])).rows,
    rows: (await pool.query(`SELECT id,amount,currency,type,source,posted_balance_delta,posting_mode,posted_account_is_asset,deleted_at
      FROM transactions WHERE account_id=$1 AND household_id=$2 ORDER BY id`, [accountId, householdId])).rows,
    links: (await pool.query(`SELECT tt.transaction_id,tt.tag_id FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id
      WHERE t.account_id=$1 AND t.household_id=$2 ORDER BY tt.transaction_id,tt.tag_id`, [accountId, householdId])).rows,
    tag: (await pool.query("SELECT id,usage_count FROM tags WHERE id=$1 AND household_id=$2", [tagId, householdId])).rows,
    creates: (await pool.query(`SELECT a.id FROM audit_logs a JOIN transactions t ON t.id=a.entity_id
      WHERE t.account_id=$1 AND a.household_id=$2 AND a.entity_type='transaction' AND a.action='CREATE'`, [accountId, householdId])).rows,
    events: (await pool.query(`SELECT e.id FROM outbox_events e JOIN transactions t ON t.id=e.aggregate_id
      WHERE t.account_id=$1 AND e.household_id=$2 AND e.event_type='transaction.created'`, [accountId, householdId])).rows,
  };
}
async function assertOneDebit() {
  const saved = await state();
  expect(saved.account).toEqual([{ balance: "90.00", initial_balance: "100.00", currency: "USD" }]);
  expect(saved.rows).toHaveLength(1);
  expect(saved.rows[0]).toMatchObject({ amount: "10.00", currency: "USD", type: "expense", source: "csv_import",
    posted_balance_delta: "-10.00", posting_mode: "posted", posted_account_is_asset: true, deleted_at: null });
  expect(saved.creates).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  return saved;
}
async function assertRecovered(originalId: string) {
  const saved = await assertOneDebit();
  expect(saved.rows[0].id).toBe(originalId);
  expect(saved.links).toEqual([{ transaction_id: originalId, tag_id: tagId }]);
  expect(saved.tag).toEqual([{ id: tagId, usage_count: 1 }]);
}

describe("R08 account CSV recovery after committed cash and tag-count failures", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = "r08-import-recovery-" + userId + "@example.invalid", password = "SyntheticImportRecovery123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic import recovery" });
    await db.insert(users).values({ id: userId, email, username: "r08-import-recovery-" + userId,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);
  beforeEach(async () => {
    accountId = randomUUID(); tagId = randomUUID(); tagName = "Recovery " + tagId;
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId, name: "Synthetic recovery cash",
      type: "checking", isAsset: true, isPrivate: false, currency: "USD", balance: "100.00", initialBalance: "100.00" });
    await db.insert(tags).values({ id: tagId, householdId, name: tagName, usageCount: 0 });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    // Each statement is fixture-scoped, on one leased cleanup transaction.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM outbox_events WHERE household_id=$1 OR payload->>'userId'=$2", [householdId, userId]);
      await client.query("DELETE FROM audit_logs WHERE household_id=$1 OR user_id=$2", [householdId, userId]);
      await client.query("DELETE FROM security_audit_logs WHERE user_id=$1 OR target_user_id=$1", [userId]);
      await client.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1', [userId]);
      await client.query("DELETE FROM households WHERE id=$1", [householdId]);
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  it("reports committed cash and tags after a required cache refusal, skips retry, and preserves deliberate later tag removal", async () => {
    const original = analyticsCache.invalidateEndpoint.bind(analyticsCache);
    let attempted = false, committedWitness = false;
    const fault = vi.spyOn(analyticsCache, "invalidateEndpoint").mockImplementation(async (...args) => {
      if (args[1] !== householdId || attempted) return original(...args);
      attempted = true;
      // Financial work is real. The cache fault is injected only AFTER its SQL
      // receipt and the account debit are visible from an independent connection.
      const saved = await assertOneDebit();
      expect(saved.links).toEqual([{ transaction_id: saved.rows[0].id, tag_id: tagId }]);
      expect(saved.tag).toEqual([{ id: tagId, usage_count: 1 }]);
      committedWitness = saved.rows.length === 1;
      throw new Error("R08_SYNTHETIC_REQUIRED_CACHE_REFUSAL");
    });
    try {
      const failed = await importRow();
      expect(attempted).toBe(true);
      expect(committedWitness).toBe(true);
      expect.soft(failed.status).toBe(500);
      expect.soft(failed.body).toMatchObject({ success: false, error: { code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
        imported: 1, skipped: 0, totalAmount: usd("-10"), failedRow: 1, remaining: 0,
      } } });
    } finally { fault.mockRestore(); }
    const first = await assertOneDebit();
    const retried = await importRow().expect(200);
    expect(retried.body).toMatchObject({ success: true, data: { imported: 0, skipped: 1, totalAmount: usd("0") } });
    await assertRecovered(first.rows[0].id);
    await importRow().expect(200);
    await assertRecovered(first.rows[0].id);
    // A later explicit tag removal is new user intent, not failed import work.
    await request(app).delete("/api/tags/transaction/" + first.rows[0].id + "/" + tagId)
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).expect(200);
    const removed = await assertOneDebit();
    expect(removed.links).toEqual([]);
    expect(removed.tag).toEqual([{ id: tagId, usage_count: 0 }]);
    const afterRemovalReplay = await importRow().expect(200);
    expect(afterRemovalReplay.body).toMatchObject({ success: true, data: { imported: 0, skipped: 1, totalAmount: usd("0") } });
    const retained = await assertOneDebit();
    expect(retained.rows[0].id).toBe(first.rows[0].id);
    expect(retained.links).toEqual([]);
    expect(retained.tag).toEqual([{ id: tagId, usage_count: 0 }]);
  });

  it("admits both financial operations when a tagged import queues behind an ordinary posting's grant", async () => {
    let tagged: Promise<request.Response> | undefined;
    try {
      await db.transaction(async tx => {
        const actor = { householdId, userId };
        await lockTransactionCreateGrant(tx, householdId, { createActor: actor });
        const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        const pid = Number(result.rows[0].pid);
        tagged = importRow().then(response => response);
        const deadline = Date.now() + 10000;
        let queued = false;
        while (!queued && Date.now() < deadline) {
          const witness = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS queued", [pid]);
          queued = witness.rows[0].queued;
          if (!queued) await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(queued).toBe(true);
        await transactionRepository.createWithinTransaction(tx, { householdId, ownerUserId: userId, accountId,
          date: "2026-11-02", type: "expense", amount: "1.00", currency: "USD", source: "manual", name: "Synthetic ordinary posting" },
          { createActor: actor });
      });
    } finally {
      if (tagged) expect((await tagged).status).toBe(200);
    }
    const saved = await state();
    expect(saved.account[0].balance).toBe("89.00");
    expect(saved.rows).toHaveLength(2);
    expect(saved.tag).toEqual([{ id: tagId, usage_count: 1 }]);
  }, 30000);

  it("rolls a reached real tag-count SQL failure back and repairs its tag on an exact retry with one debit", async () => {
    const suffix = randomUUID().replace(/-/g, "");
    const name = "r08_tag_fail_" + suffix, sequence = "r08_tag_seen_" + suffix;
    try {
      await pool.query(`CREATE SEQUENCE ${sequence}`);
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $r08_tag$
        BEGIN
          IF NEW.household_id='${householdId}'::uuid AND NEW.id='${tagId}'::uuid
            AND NEW.usage_count > OLD.usage_count THEN
            PERFORM nextval('${sequence}'::regclass);
            RAISE EXCEPTION 'R08_SYNTHETIC_TAG_COUNT_INSERT_FAILURE';
          END IF;
          RETURN NEW;
        END $r08_tag$`);
      await pool.query(`CREATE TRIGGER ${name} AFTER UPDATE OF usage_count ON tags FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      expect((await pool.query<{ is_called: boolean }>(`SELECT is_called FROM ${sequence}`)).rows[0].is_called).toBe(false);
      const failed = await importRow();
      expect((await pool.query<{ is_called: boolean }>(`SELECT is_called FROM ${sequence}`)).rows[0].is_called).toBe(true);
      expect.soft(failed.status).toBe(500);
      expect.soft(failed.body).toMatchObject({ success: false, error: { code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
        imported: 0, skipped: 0, totalAmount: usd("0"), failedRow: 1,
      } } });
      const failedState = await state();
      expect.soft(failedState.account).toEqual([{ balance: "100.00", initial_balance: "100.00", currency: "USD" }]);
      expect.soft(failedState.rows).toEqual([]);
      expect.soft(failedState.links).toEqual([]);
      expect.soft(failedState.tag).toEqual([{ id: tagId, usage_count: 0 }]);
      expect.soft(failedState.creates).toEqual([]);
      expect.soft(failedState.events).toEqual([]);
    } finally {
      try { await pool.query(`DROP TRIGGER IF EXISTS ${name} ON tags`); }
      finally {
        try { await pool.query(`DROP FUNCTION IF EXISTS ${name}()`); }
        finally { await pool.query(`DROP SEQUENCE IF EXISTS ${sequence}`); }
      }
    }
    const retried = await importRow().expect(200);
    expect(retried.body).toMatchObject({ success: true, data: { imported: 1, skipped: 0, totalAmount: usd("-10") } });
    const originalId = (await assertOneDebit()).rows[0].id;
    await assertRecovered(originalId);
    await importRow().expect(200);
    await assertRecovered(originalId);
  });
});
