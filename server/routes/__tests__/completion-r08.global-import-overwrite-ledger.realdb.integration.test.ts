/**
 * R08 old-caller oracle: the currently supported explicit prioritize_csv operation
 * replaces one owner-visible manual purchase on one canonical day. It starts with
 * a genuine HTTP posting; no fabricated historical balance or legacy import key.
 * Also exercises financial retries of the existing endpoint and fail-closed reversal.
 * Run only through the campaign's protected disposable-database runner.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts,
  categories,
  auditLogs,
  householdMembers,
  households,
  merchants,
  outboxEvents,
  transactions,
  users,
} from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { reviewedRemovalsFrom } from "../../testing/fixtures/import-overwrite-review";

interface AccountState {
  balance: string;
  initialBalance: string;
  currency: string;
  type: string;
  isAsset: boolean;
}
interface TransactionState {
  id: string;
  accountId: string;
  ownerUserId: string | null;
  amount: string;
  currency: string | null;
  type: string;
  source: string | null;
  date: string;
  notes: string | null;
  deletedAt: Date | null;
}
interface AuditState {
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
}

const householdId = randomUUID();
const userId = randomUUID();
const accountId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

async function readAccount(): Promise<AccountState> {
  const result = await pool.query<AccountState>(
    'SELECT balance, initial_balance AS "initialBalance", currency, type, is_asset AS "isAsset" FROM accounts WHERE id = $1 AND household_id = $2',
    [accountId, householdId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

async function readTransactions(): Promise<TransactionState[]> {
  const result = await pool.query<TransactionState>(
    'SELECT id, account_id AS "accountId", owner_user_id AS "ownerUserId", amount, currency, type, source, date::text AS date, notes, deleted_at AS "deletedAt" FROM transactions WHERE account_id = $1 AND household_id = $2 ORDER BY id',
    [accountId, householdId],
  );
  return result.rows;
}

describe("R08 global CSV overwrite of genuine positive-debt history", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = "r08-global-overwrite-" + userId + "@example.invalid";
    const password = "SyntheticGlobalOverwrite123!";
    await db.insert(households).values({
      id: householdId,
      name: "Synthetic R08 global overwrite",
      currency: "ZMW",
    });
    await db.insert(users).values({
      id: userId,
      email,
      username: "r08-global-overwrite-" + userId,
      passwordHash: await hashPassword(password),
      emailVerified: true,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "owner",
    });
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      ownerUserId: userId,
      name: "Synthetic R08 USD card",
      type: "credit",
      isAsset: false,
      isPrivate: false,
      currency,
      balance: "100.00",
      initialBalance: "100.00",
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("replaces expense 10 with expense 15, soft-deletes the original, and ends at debt 115", async () => {
    expect(await readAccount()).toEqual({
      balance: "100.00",
      initialBalance: "100.00",
      currency,
      type: "credit",
      isAsset: false,
    });
    const created = await request(app)
      .post("/api/transactions")
      .set("Cookie", cookie)
      .set("X-Capital-Subject", userId)
      .set("X-Capital-Household", householdId)
      .send({
        accountId,
        date: "2026-01-10",
        name: "Synthetic manual card purchase",
        type: "expense",
        amount: { amount: "10.00", currency },
        notes: "Original genuine posting",
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(created.body.success).toBe(true);
    const originalRows = await readTransactions();
    expect(originalRows).toHaveLength(1);
    const originalId = originalRows[0].id;
    expect.soft(originalId).toBe(created.body.data.id);
    expect.soft(originalRows[0]).toMatchObject({
      accountId,
      ownerUserId: userId,
      amount: "10.00",
      currency,
      type: "expense",
      source: "manual",
      date: "2026-01-10",
      deletedAt: null,
    });
    const beforeOverwrite = await readAccount();
    // Preserve the real pre-overwrite state and still diagnose the old caller
    // if the first manual liability posting already violates positive-debt signs.
    expect.soft(beforeOverwrite, "persisted debt after genuine expense-10 posting").toEqual({
      balance: "110.00",
      initialBalance: "100.00",
      currency,
      type: "credit",
      isAsset: false,
    });

    const overwriteBody = {
      targetAccountId: accountId,
      strategy: "prioritize_csv",
      mapping: {
        date: "Date",
        amount: "Amount",
        merchant: "Merchant",
        description: "Notes",
      },
      categoryMapping: {},
      dateFormat: "auto",
      rows: [{
        Date: "2026-01-10",
        Amount: "-15.00",
        Merchant: "Synthetic replacement card purchase",
        Notes: "Explicit current overwrite operation",
      }],
    };
    // A-02: the member reviews the preview, which lists the manual purchase this overwrite removes.
    const reviewedRemovals = await reviewedRemovalsFrom(request(app).post("/api/import/preview").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(overwriteBody));
    expect(reviewedRemovals.map(row => row.id)).toEqual([originalId]);
    const overwritten = await request(app)
      .post("/api/import/execute")
      .set("Cookie", cookie)
      .set("X-Capital-Subject", userId)
      .set("X-Capital-Household", householdId)
      .send({ ...overwriteBody, reviewedRemovals })
      .expect(200);
    expect.soft(overwritten.body).toEqual({
      importId: expect.any(String),
      replayed: false,
      imported: 1,
      duplicate: 0,
      skipped: 0,
      failed: 0,
      deleted: 1,
      errors: [],
    });

    const finalRows = await readTransactions();
    expect(finalRows).toHaveLength(2);
    const originals = finalRows.filter(row => row.id === originalId);
    const replacements = finalRows.filter(row => row.id !== originalId);
    expect(originals).toHaveLength(1);
    expect(replacements).toHaveLength(1);
    expect.soft(originals[0]).toMatchObject({
      id: originalId,
      amount: "10.00",
      currency,
      type: "expense",
      source: "manual",
    });
    expect.soft(originals[0].deletedAt).toBeInstanceOf(Date);
    expect.soft(replacements[0]).toMatchObject({
      accountId,
      ownerUserId: userId,
      amount: "15.00",
      currency,
      type: "expense",
      source: "csv_import",
      date: "2026-01-10",
      notes: "Explicit current overwrite operation",
      deletedAt: null,
    });
    expect.soft(await readAccount(), "persisted debt after reversing 10 and posting 15").toEqual({
      balance: "115.00",
      initialBalance: "100.00",
      currency,
      type: "credit",
      isAsset: false,
    });

    const audits = await pool.query<AuditState>(
      'SELECT action, entity_type AS "entityType", entity_id AS "entityId", user_id AS "userId" FROM audit_logs WHERE household_id = $1',
      [householdId],
    );
    expect.soft(audits.rows).toEqual(expect.arrayContaining([
      { action: "CREATE", entityType: "transaction", entityId: originalId, userId },
      { action: "DELETE", entityType: "transaction", entityId: originalId, userId },
      { action: "CREATE", entityType: "transaction", entityId: replacements[0].id, userId },
      { action: "CREATE", entityType: "transaction_import", entityId: accountId, userId },
    ]));
  });

  async function testAccount(isAsset: boolean, balance: string) {
    const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic overwrite control",
      type: isAsset ? "checking" : "credit", isAsset, currency, balance, initialBalance: balance }).returning();
    return account.id;
  }

  /** Executes as a member who accepted the preview: a CSV-wins import carries the removals it listed (A-02). */
  async function overwrite(targetAccountId: string, rows: Array<{ Date: string; Amount: string; Merchant: string }>,
    options: { strategy?: string; expect?: number } = {}) {
    const strategy = options.strategy ?? "prioritize_csv";
    const send = (path: string) => request(app).post(path).set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
    const body = { targetAccountId, strategy, mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
      categoryMapping: {}, dateFormat: "auto", rows };
    const reviewedRemovals = strategy === "prioritize_csv" ? await reviewedRemovalsFrom(send("/api/import/preview").send(body)) : [];
    const res = await send("/api/import/execute").send({ ...body, reviewedRemovals });
    if (options.expect !== undefined) expect(res.status, JSON.stringify(res.body)).toBe(options.expect);
    return res;
  }

  async function ledger(id: string) {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, id)).orderBy(transactions.id);
    const effects = await pool.query(`SELECT id, action FROM audit_logs WHERE household_id=$1 AND entity_type='transaction'
      AND entity_id IN (SELECT id FROM transactions WHERE account_id=$2) ORDER BY id`, [householdId, id]);
    const events = await pool.query(`SELECT id,event_type FROM outbox_events WHERE household_id=$1
      AND aggregate_id IN (SELECT id FROM transactions WHERE account_id=$2) ORDER BY id`, [householdId, id]);
    return { account, rows, audits: effects.rows, events: events.rows };
  }

  it("preserves two identical statement purchases and their effects on an exact overwrite retry", async () => {
    const id = await testAccount(false, "100.00");
    const row = { Date: "2026-02-01", Amount: "-10.00", Merchant: "Synthetic repeated purchase" };
    const first = await overwrite(id, [row, row], { expect: 200 });
    expect(first.body).toMatchObject({ imported: 2, skipped: 0, deleted: 0 });
    const saved = await ledger(id);
    expect(saved.account.balance).toBe("120.00");
    expect(saved.rows).toHaveLength(2);
    expect(new Set(saved.rows.map(r => r.idempotencyKey)).size).toBe(2);
    expect(saved.audits).toHaveLength(2);
    expect(saved.events.filter(e => e.event_type === "transaction.created")).toHaveLength(2);
    const retry = await overwrite(id, [row, row], { expect: 200 });
    // NEW-17: the replayed file's rows are recognised by identity and reported as duplicates.
    expect(retry.body).toMatchObject({ imported: 0, duplicate: 2, skipped: 0, deleted: 0 });
    expect(await ledger(id)).toEqual(saved);
    // A different file is a different batch (D13): it replaces the range and the ledger
    // ends at the same single purchase and balance as before NEW-17.
    const smaller = await overwrite(id, [row], { expect: 200 });
    expect(smaller.body).toMatchObject({ imported: 1, duplicate: 0, skipped: 0, deleted: 2 });
    const reduced = await ledger(id);
    expect(reduced.rows.filter(r => !r.deletedAt)).toHaveLength(1);
    expect(reduced.account.balance).toBe("110.00");
  });

  it("offers the matching prior purchase as the candidate and keeps an additional purchase of the same amount", async () => {
    const id = await testAccount(false, "100.00");
    const first = { Date: "2026-02-01", Amount: "-10.00", Merchant: "First purchase" };
    const next = { ...first, Merchant: "Another shop" };
    await overwrite(id, [first], { strategy: "prioritize_coppercoin", expect: 200 });
    // NEW-17: same-day same-amount is a candidate for review, matched to the same merchant first.
    const draft = await request(app).post("/api/import/preview").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ targetAccountId: id, strategy: "prioritize_coppercoin", mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
        categoryMapping: {}, dateFormat: "auto", rows: [next, first] }).expect(200);
    expect(draft.body.rows.map((row: { status: string; candidate?: { reason: string } }) => [row.status, row.candidate?.reason]))
      .toEqual([["new", undefined], ["candidate", "same_merchant"]]);
    const added = await request(app).post("/api/import/execute").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ targetAccountId: id, strategy: "prioritize_coppercoin", mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
        categoryMapping: {}, dateFormat: "auto", rows: [next, first], skipRowOrdinals: [2],
        skipRows: [{ ordinal: 2, candidateId: draft.body.rows[1].candidate.id }] }).expect(200);
    expect(added.body).toMatchObject({ imported: 1, duplicate: 0, skipped: 1, deleted: 0 });
    const saved = await ledger(id);
    expect(saved.rows.map(row => row.name).sort()).toEqual(["Another shop", "First purchase"]);
    expect(saved.account.balance).toBe("120.00");
  });

  it("rolls back overwrite when a mapped category belongs to another household", async () => {
    const id = await testAccount(false, "100.00");
    await overwrite(id, [{ Date: "2026-02-01", Amount: "-10.00", Merchant: "Original shop" }], { expect: 200 });
    const before = await ledger(id);
    const [foreign] = await db.insert(households).values({ name: "Synthetic separate household", currency }).returning();
    try {
      const [category] = await db.insert(categories).values({ householdId: foreign.id, name: "Other household", displayOrder: 0 }).returning();
      const foreignBody = { targetAccountId: id, strategy: "prioritize_csv", mapping: { date: "Date", amount: "Amount", category: "Category" },
        categoryMapping: { Food: category.id }, rows: [{ Date: "2026-02-01", Amount: "-15.00", Category: "Food" }] };
      // A-02: reviewed, so the overwrite runs and the foreign category is what refuses it.
      const reviewedRemovals = await reviewedRemovalsFrom(request(app).post("/api/import/preview").set("Cookie", cookie)
        .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(foreignBody));
      expect(reviewedRemovals).toHaveLength(1);
      await request(app).post("/api/import/execute").set("Cookie", cookie)
        .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
        .send({ ...foreignBody, reviewedRemovals }).expect(404);
      expect(await ledger(id)).toEqual(before);
    } finally { await db.delete(households).where(eq(households.id, foreign.id)); }
  });

  it("refuses to reverse an undocumented historical credit purchase", async () => {
    const id = await testAccount(false, "100.00");
    await db.insert(transactions).values({ householdId, accountId: id, ownerUserId: userId, date: "2026-02-01",
      type: "expense", amount: "10.00", currency, source: "manual", name: "Unknown historical effect" });
    const before = await ledger(id);
    const result = await overwrite(id, [{ Date: "2026-02-01", Amount: "-15.00", Merchant: "Replacement" }]);
    expect([400, 409, 422]).toContain(result.status);
    expect(await ledger(id)).toEqual(before);
  });

  it("refuses an overwrite that would leave spent income overdrawn", async () => {
    const id = await testAccount(true, "0.00");
    async function post(date: string, type: "expense" | "income", value: string) {
      await request(app).post("/api/transactions").set("Cookie", cookie)
        .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
        .send({ accountId: id, type, amount: { amount: value, currency }, date, name: "Synthetic " + type }).expect(201);
    }
    await post("2026-02-01", "income", "100.00");
    await post("2026-02-02", "expense", "95.00");
    const before = await ledger(id);
    expect(before.account.balance).toBe("5.00");
    const result = await overwrite(id, [{ Date: "2026-02-01", Amount: "10.00", Merchant: "Smaller income" }]);
    expect([400, 409, 422]).toContain(result.status);
    expect(await ledger(id)).toEqual(before);
  });
});
