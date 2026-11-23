/**
 * A-02: a "CSV wins" (prioritize_csv) import removes only ledger rows the member
 * reviewed. The preview lists every row the overwrite would remove; execute is
 * bound to that set (ids and versions) and refuses with a 409, writing nothing,
 * when a row was added or changed after the preview.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

interface Removal { id: string; date: string; name: string; type: string; amount: { amount: string; currency: string }; version: string }
type StatementRow = { Date: string; Amount: string; Merchant: string };

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
const mapping = { date: "Date", amount: "Amount", merchant: "Merchant" };
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
const body = (targetAccountId: string, rows: StatementRow[]) =>
  ({ targetAccountId, strategy: "prioritize_csv", mapping, categoryMapping: {}, dateFormat: "auto", rows });

async function preview(accountId: string, rows: StatementRow[]): Promise<Removal[]> {
  const res = await auth(request(app).post("/api/import/preview")).send(body(accountId, rows)).expect(200);
  return res.body.removals;
}

const execute = (accountId: string, rows: StatementRow[], reviewed?: Removal[]) =>
  auth(request(app).post("/api/import/execute")).send({ ...body(accountId, rows),
    ...(reviewed && { reviewedRemovals: reviewed.map(({ id, version }) => ({ id, version })) }) });

async function newAccount() {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic A-02 cheque",
    type: "checking", isAsset: true, currency, balance: "500.00", initialBalance: "500.00" }).returning();
  return account.id;
}

async function postManual(accountId: string, date: string, name: string, amount: string): Promise<string> {
  const res = await auth(request(app).post("/api/transactions")).send({ accountId, date, name, type: "expense",
    amount: { amount, currency }, idempotencyKey: randomUUID() }).expect(201);
  return res.body.data.id;
}

async function ledger(accountId: string) {
  const [account] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
  const live = await pool.query<{ id: string; name: string; amount: string }>(
    "SELECT id, name, amount FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY date, name, id", [accountId]);
  const imports = await pool.query("SELECT id FROM data_imports WHERE account_id=$1", [accountId]);
  return { balance: account.balance, live: live.rows, imports: imports.rowCount };
}

const statement: StatementRow[] = [
  { Date: "2026-04-02", Amount: "-20.00", Merchant: "Synthetic statement grocer" },
  { Date: "2026-04-08", Amount: "-5.00", Merchant: "Synthetic statement cafe" },
];

describe("A-02 CSV-wins import removes only reviewed rows (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `a02-overwrite-${userId}@example.invalid`;
    const password = "SyntheticOverwriteReview123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic A-02 overwrite review", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `a02-overwrite-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM data_imports WHERE user_id=$1", [userId]);
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("lists the rows it will remove, then removes exactly those", async () => {
    const accountId = await newAccount();
    const manualId = await postManual(accountId, "2026-04-05", "Synthetic manual entry", "7.50");
    const outsideId = await postManual(accountId, "2026-04-20", "Synthetic out-of-range entry", "1.00");
    const before = await ledger(accountId);
    const manual = before.live.find(row => row.id === manualId)!;
    const outside = before.live.find(row => row.id === outsideId)!;

    const removals = await preview(accountId, statement);
    expect(removals).toEqual([{ id: manualId, date: "2026-04-05", name: manual.name, type: "expense",
      amount: { amount: "7.50", currency }, version: expect.stringMatching(/^[0-9a-f]{64}$/) }]);

    expect((await execute(accountId, statement, removals).expect(200)).body).toMatchObject({ imported: 2, deleted: 1 });
    const after = await ledger(accountId);
    expect(after.live.filter(row => row.id !== outsideId).map(row => row.name))
      .toEqual(statement.map(row => row.Merchant));
    expect(after.live.find(row => row.id === outsideId)).toEqual(outside);
    expect(after.live.some(row => row.id === manualId)).toBe(false);
    expect(after.balance).toBe("474.00");
  });

  it("refuses with a 409 and writes nothing when a row is added after the preview", async () => {
    const accountId = await newAccount();
    await postManual(accountId, "2026-04-05", "Synthetic reviewed entry", "7.50");
    const removals = await preview(accountId, statement);
    expect(removals).toHaveLength(1);
    const addedId = await postManual(accountId, "2026-04-06", "Synthetic entry added after preview", "3.00");
    const before = await ledger(accountId);

    const refused = await execute(accountId, statement, removals).expect(409);
    expect(refused.body.error.code).toBe("IMPORT_OVERWRITE_CHANGED");
    expect(refused.body.error.details.removals.map((row: Removal) => row.id)).toContain(addedId);
    expect(await ledger(accountId)).toEqual(before);
  });

  it("refuses with a 409 and writes nothing when a reviewed row is edited after the preview", async () => {
    const accountId = await newAccount();
    const manualId = await postManual(accountId, "2026-04-05", "Synthetic entry before edit", "7.50");
    const removals = await preview(accountId, statement);
    await auth(request(app).put(`/api/transactions/${manualId}`)).send({ name: "Synthetic entry edited after preview" }).expect(200);
    const before = await ledger(accountId);

    expect((await execute(accountId, statement, removals).expect(409)).body.error.code).toBe("IMPORT_OVERWRITE_CHANGED");
    expect(await ledger(accountId)).toEqual(before);
  });

  it("refuses an execute that sends no reviewed set when the overwrite would remove rows", async () => {
    const accountId = await newAccount();
    await postManual(accountId, "2026-04-05", "Synthetic unreviewed entry", "7.50");
    const before = await ledger(accountId);

    expect((await execute(accountId, statement).expect(409)).body.error.code).toBe("IMPORT_OVERWRITE_CHANGED");
    expect(await ledger(accountId)).toEqual(before);
  });

  it("still lets an exact retry of an applied overwrite through with the reviewed set it was given", async () => {
    const accountId = await newAccount();
    await postManual(accountId, "2026-04-05", "Synthetic replaced entry", "7.50");
    const removals = await preview(accountId, statement);
    await execute(accountId, statement, removals).expect(200);
    const applied = await ledger(accountId);

    // The reviewed row is already gone; the retry removes nothing, so it is a subset of what was reviewed.
    expect((await execute(accountId, statement, removals).expect(200)).body).toMatchObject({ imported: 0, duplicate: 2, deleted: 0 });
    expect((await ledger(accountId)).live).toEqual(applied.live);
    expect(await preview(accountId, statement)).toEqual([]);
  });
});
