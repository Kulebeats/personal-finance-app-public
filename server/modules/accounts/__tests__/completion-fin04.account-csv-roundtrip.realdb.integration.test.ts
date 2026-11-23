/**
 * FIN-04: an account's own transaction CSV export, re-imported into the same
 * account, gives back the same rows (direction, amount, currency and effect on
 * the balance), for an asset account and for a liability account.
 * Real Postgres, real HTTP, signed session; rows come from the normal create path.
 * Rows are keyed by date: the create path tidies merchant names, which is not
 * what this test is about.
 *
 * R2-03: the statement text the export writes (the original statement and the
 * notes) comes back byte for byte through the production client parser, even
 * when the exporter neutralised it as a possible formula or it has edge spaces.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { parseTransactionCsv } from "../../../../client/src/components/accounts/parseTransactionCsv";

const householdId = randomUUID();
const userId = randomUUID();
const currency = "ZMW";
const OPENING = "100.00";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

interface RowState { date: string; type: string; amount: string; currency: string | null; delta: string | null }

const signed = () => ({ Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId });

async function newAccount(type: "checking" | "credit"): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: `FIN04 ${type}`, type,
    currency, isAsset: type === "checking", initialBalance: OPENING, balance: OPENING });
  return id;
}

async function rowsOf(accountId: string): Promise<RowState[]> {
  const result = await pool.query<RowState>(
    `SELECT date::text AS date, type, amount, currency, posted_balance_delta AS delta
       FROM transactions WHERE account_id = $1 AND deleted_at IS NULL ORDER BY date`, [accountId]);
  return result.rows;
}

async function balanceOf(accountId: string): Promise<string> {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
  return row.balance;
}

async function create(accountId: string, type: "income" | "expense", name: string, date: string, amount: string) {
  await request(app).post("/api/transactions").set(signed())
    .send({ accountId, type, name, date, amount: { amount, currency } }).expect(201);
}

/** The account export layout: Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags. */
function parseExport(csv: string) {
  const [header, ...lines] = csv.trim().split("\n");
  expect(header).toBe("Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags");
  return lines.map(line => {
    const [date, merchant, category, , originalStatement, notes, amount] = line.split(",");
    return { date, merchant, amount, category: category || undefined,
      originalStatement: originalStatement || undefined, notes: notes || undefined };
  });
}

async function roundTrip(accountId: string) {
  const before = await rowsOf(accountId);
  const balance = await balanceOf(accountId);
  const exported = await request(app).get(`/api/accounts/${accountId}/transactions/export`).set(signed()).expect(200);
  const csvRows = parseExport(exported.text);

  // Same account, emptied back to its opening balance.
  await db.delete(transactions).where(eq(transactions.accountId, accountId));
  await db.update(accounts).set({ balance: OPENING }).where(eq(accounts.id, accountId));

  const imported = await request(app).post(`/api/accounts/${accountId}/transactions/import`).set(signed())
    .send({ adjustBalance: true, transactions: csvRows }).expect(200);
  expect(imported.body.data).toMatchObject({ imported: before.length, skipped: 0 });
  return { before, balance, csvRows, after: await rowsOf(accountId), afterBalance: await balanceOf(accountId),
    totalAmount: imported.body.data.totalAmount as unknown };
}

interface StoredText { date: string; name: string; original_name: string | null; notes: string | null }

async function storedText(accountId: string): Promise<StoredText[]> {
  const result = await pool.query<StoredText>(
    `SELECT date::text AS date, name, original_name, notes FROM transactions
       WHERE account_id = $1 AND deleted_at IS NULL ORDER BY date`, [accountId]);
  return result.rows;
}

describe("FIN-04 account CSV export re-imports with the same signs", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `fin04-${userId}@example.invalid`;
    const password = "SyntheticFin04Signs123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic FIN04", currency });
    await db.insert(users).values({ id: userId, email, username: `fin04-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
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

  it("round-trips an asset account: expenses stay expenses, income stays income", async () => {
    const accountId = await newAccount("checking");
    await create(accountId, "income", "FIN04 salary", "2026-03-01", "1500.00");
    await create(accountId, "expense", "FIN04 groceries", "2026-03-02", "58.12");
    expect(await balanceOf(accountId)).toBe("1541.88");

    const trip = await roundTrip(accountId);
    expect(trip.csvRows.map(row => [row.date, row.amount])).toEqual([
      ["2026-03-02", "-58.12"], ["2026-03-01", "1500.00"],
    ]);
    expect(trip.before.map(row => [row.date, row.type, row.amount, row.currency, row.delta])).toEqual([
      ["2026-03-01", "income", "1500.00", currency, "1500.00"],
      ["2026-03-02", "expense", "58.12", currency, "-58.12"],
    ]);
    expect(trip.after).toEqual(trip.before);
    expect(trip.afterBalance).toBe(trip.balance);
    // The import's total leaves as a MoneyDto in the response and in its audit row, never a float.
    const total = { amount: "1441.88", currency };
    expect(trip.totalAmount).toEqual(total);
    const audit = await pool.query<{ total: unknown }>(`SELECT details->'newValue'->'totalAmount' AS total FROM audit_logs
      WHERE entity_type = 'transaction_import' AND entity_id = $1`, [accountId]);
    expect(audit.rows).toEqual([{ total }]);
  });

  it("stores formula-like and space-edged statement text exactly as it was exported (R2-03)", async () => {
    const accountId = await newAccount("checking");
    await create(accountId, "expense", "R2-03 refund", "2026-03-05", "12.00");
    await create(accountId, "income", "R2-03 deposit", "2026-03-06", "3.00");
    const text = [
      { date: "2026-03-05", original: "-Refund =SUM(A1)", notes: "  two leading spaces\nand a trailing newline\n" },
      { date: "2026-03-06", original: "@BANK +REF 42", notes: "+ added by hand " },
    ];
    for (const row of text) {
      await pool.query("UPDATE transactions SET original_name = $3, notes = $4 WHERE account_id = $1 AND date = $2",
        [accountId, row.date, row.original, row.notes]);
    }
    const source = await storedText(accountId);

    const exported = await request(app).get(`/api/accounts/${accountId}/transactions/export`).set(signed()).expect(200);
    // The export keeps its formula protection.
    expect(exported.text).toContain("'-Refund =SUM(A1)");
    expect(exported.text).toContain("'@BANK +REF 42");
    const csvRows = parseTransactionCsv(exported.text, "auto");
    expect(csvRows.map(row => [row.date, row.originalStatement, row.notes])).toEqual(
      text.slice().reverse().map(row => [row.date, row.original, row.notes]));

    await db.delete(transactions).where(eq(transactions.accountId, accountId));
    await db.update(accounts).set({ balance: OPENING }).where(eq(accounts.id, accountId));
    const imported = await request(app).post(`/api/accounts/${accountId}/transactions/import`).set(signed())
      .send({ adjustBalance: true, transactions: csvRows }).expect(200);
    expect(imported.body.data).toMatchObject({ imported: 2, skipped: 0 });
    const stored = await storedText(accountId);
    expect(stored.map(row => [row.date, row.original_name, row.notes]))
      .toEqual(source.map(row => [row.date, row.original_name, row.notes]));
    // The merchant is tidied by the create path, but never gains the export's apostrophe.
    expect(stored.every(row => !row.name.startsWith("'"))).toBe(true);
  });

  it("round-trips a liability account: a card purchase stays an expense that raises the debt", async () => {
    const accountId = await newAccount("credit");
    await create(accountId, "expense", "FIN04 card purchase", "2026-03-03", "40.00");
    await create(accountId, "income", "FIN04 card refund", "2026-03-04", "5.50");
    expect(await balanceOf(accountId)).toBe("134.50");

    const trip = await roundTrip(accountId);
    expect(trip.csvRows.map(row => [row.date, row.amount])).toEqual([
      ["2026-03-04", "5.50"], ["2026-03-03", "-40.00"],
    ]);
    expect(trip.before.map(row => [row.date, row.type, row.amount, row.currency, row.delta])).toEqual([
      ["2026-03-03", "expense", "40.00", currency, "40.00"],
      ["2026-03-04", "income", "5.50", currency, "-5.50"],
    ]);
    expect(trip.after).toEqual(trip.before);
    expect(trip.afterBalance).toBe(trip.balance);
  });
});
