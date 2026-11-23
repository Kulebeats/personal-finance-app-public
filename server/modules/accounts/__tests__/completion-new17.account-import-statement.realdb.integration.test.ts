/**
 * NEW-17 (D13) on the account-detail import: row identity is the statement
 * (its parsed rows) plus the row ordinal, as on the main import path. The same
 * file twice is idempotent. An identical purchase in a DIFFERENT statement is
 * never silently dropped and never silently posted (A-01): the file is refused
 * with 409 IMPORT_REVIEW_REQUIRED until the member decides, and a "post"
 * decision bound to the match it was shown posts it and names the match. Rows
 * stored under the earlier content-only key still replay for the file that
 * wrote them, and every attempt leaves one honest `data_imports` row.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { Money } from "../../../core/money";
import { accountImportRowKey, importOccurrenceKey, importRequestFingerprint } from "../../../services/import/identity";
import { recordImportBatch } from "../../../services/import/batch";

interface ImportRow { date: string; merchant: string; amount: string; notes?: string }
interface Decision { row: number; matchesTransactionId: string; decision: "post" | "skip" }
interface ReviewItem { row: number; matchesTransactionId: string; match: { name: string; date: string; type: string; amount: { amount: string; currency: string } } }
interface HistoryRow {
  identity_version: string; status: string; record_count: number; imported_count: number; duplicate_count: number;
  failed_count: number; row_outcomes: Array<{ ordinal: number; outcome: string; transactionId?: string; possibleDuplicateOf?: string }>;
}

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
const importFile = (accountId: string, rows: ImportRow[], possibleDuplicateDecisions: Decision[] = []) =>
  auth(request(app).post(`/api/accounts/${accountId}/transactions/import`)).send({ adjustBalance: true, transactions: rows, possibleDuplicateDecisions });

/** A-01: the file is held back for review first; the member then chooses to post every flagged row. */
async function importPostingFlagged(accountId: string, rows: ImportRow[]) {
  const before = await ledger(accountId);
  const held = await importFile(accountId, rows).expect(409);
  expect(held.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
  expect(await ledger(accountId)).toEqual(before);
  const review: ReviewItem[] = held.body.error.details.possibleDuplicates;
  const res = await importFile(accountId, rows, review.map(item => ({ row: item.row,
    matchesTransactionId: item.matchesTransactionId, decision: "post" as const }))).expect(200);
  return { review, res };
}

async function newAccount() {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic NEW-17 account import",
    type: "checking", isAsset: true, currency, balance: "500.00", initialBalance: "500.00" }).returning();
  return account.id;
}

async function ledger(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const rows = await pool.query<{ id: string; date: string; name: string; amount: string; type: string }>(
    "SELECT id, to_char(date, 'YYYY-MM-DD') AS date, name, amount, type FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY date, name, id",
    [accountId]);
  return { balance: account.balance, rows: rows.rows };
}

async function history(accountId: string): Promise<HistoryRow[]> {
  return (await pool.query<HistoryRow>("SELECT * FROM data_imports WHERE account_id=$1 ORDER BY created_at, id", [accountId])).rows;
}

const isGrocer = (name: string) => name.toLowerCase() === "synthetic grocer";

/** The keys and history fingerprint an import before this change wrote (content and occurrence only). */
function legacyIdentity(accountId: string, rows: ImportRow[]) {
  const seen = new Map<string, number>();
  const keys = rows.map(row => {
    const base = accountImportRowKey(householdId, accountId, { ...row, amount: new Money(row.amount, currency).toString() });
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return importOccurrenceKey(base, occurrence);
  });
  return { keys, fingerprint: importRequestFingerprint(["account-csv:v1", accountId.toLowerCase(), "posted", keys]) };
}

/**
 * Leave the state an import before this change left: the history row the
 * earlier engine wrote for this file (a v1 attempt that stopped before any
 * row), then the file posted through the real route under its v1 keys. Stored
 * keys are immutable (owner-intent evidence), so they cannot be rewritten later.
 */
async function importAsLegacy(accountId: string, rows: ImportRow[]) {
  const { keys, fingerprint } = legacyIdentity(accountId, rows);
  await db.transaction(tx => recordImportBatch(tx, { householdId, userId, accountId, source: "account_csv",
    identityVersion: "account-csv:v1", fingerprint, strategy: "posted", recordCount: rows.length, status: "failed",
    counts: { imported: 0, duplicate: 0, skipped: 0, failed: 1, deleted: 0 }, errors: [], outcomes: [{ ordinal: 1, outcome: "failed" }] }));
  expect((await importFile(accountId, rows).expect(200)).body.data).toMatchObject({ imported: rows.length, skipped: 0 });
  const stored = await pool.query<{ key: string }>(
    "SELECT idempotency_key AS key FROM transactions WHERE account_id=$1 AND deleted_at IS NULL", [accountId]);
  expect(stored.rows.map(row => row.key).sort()).toEqual([...keys].sort());
}

const statementA: ImportRow[] = [
  { date: "2026-05-04", merchant: "Synthetic grocer", amount: "-25.00" },
  { date: "2026-05-04", merchant: "Synthetic grocer", amount: "-25.00" },
  { date: "2026-05-06", merchant: "Synthetic salary", amount: "300.00" },
];
/** A later statement that holds a genuinely identical purchase, spelled differently, and a new one. */
const statementB: ImportRow[] = [
  { date: "2026-05-04", merchant: "Synthetic grocer", amount: "-25" },
  { date: "2026-05-09", merchant: "Synthetic pharmacy", amount: "-12.40" },
];

describe("NEW-17 account-detail import identity (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `new17-acct-${userId}@example.invalid`;
    const password = "SyntheticAccountImport123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic NEW-17 account import", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `new17-acct-${userId}`,
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

  it("imports the same file twice as one set of rows", async () => {
    const accountId = await newAccount();
    expect((await importFile(accountId, statementA).expect(200)).body.data).toMatchObject({ imported: 3, skipped: 0, possibleDuplicates: [] });
    const after = await ledger(accountId);
    expect(after.balance).toBe("750.00");
    expect((await importFile(accountId, statementA).expect(200)).body.data).toMatchObject({ imported: 0, skipped: 3, possibleDuplicates: [] });
    expect(await ledger(accountId)).toEqual(after);
  });

  it("holds an identical purchase from a different statement for review, then posts it on the member's decision", async () => {
    const accountId = await newAccount();
    await importFile(accountId, statementA).expect(200);
    const existing = (await ledger(accountId)).rows.filter(row => isGrocer(row.name));
    // A-01 (changed from "posted and flagged"): nothing posts until the member decides on row 1.
    const { review, res } = await importPostingFlagged(accountId, statementB);
    expect(review).toHaveLength(1);
    const matched = existing.find(row => row.id === review[0].matchesTransactionId)!;
    expect(matched).toBeDefined();
    expect(review).toEqual([{ row: 1, matchesTransactionId: matched.id,
      match: { name: matched.name, date: "2026-05-04", type: "expense", amount: { amount: "25.00", currency } } }]);
    expect(res.body.data).toMatchObject({ imported: 2, skipped: 0, reviewSkipped: 0 });
    // One flag, against one of the earlier identical purchases; the row is posted, not dropped.
    expect(res.body.data.possibleDuplicates).toEqual([{ row: 1, transactionId: expect.any(String), matchesTransactionId: expect.any(String) }]);
    expect(res.body.data.possibleDuplicates[0].matchesTransactionId).toBe(matched.id);
    const after = await ledger(accountId);
    expect(after.rows.filter(row => isGrocer(row.name))).toHaveLength(3);
    expect(after.balance).toBe("712.60");
    // The flagged row is the one this import posted.
    expect(after.rows.map(row => row.id)).toContain(res.body.data.possibleDuplicates[0].transactionId);
    // Replaying statement B is then exact: nothing new and nothing flagged again.
    expect((await importFile(accountId, statementB).expect(200)).body.data).toMatchObject({ imported: 0, skipped: 2, possibleDuplicates: [] });
  });

  it("still replays a file imported under the earlier key, and flags rather than drops a new statement's match against it", async () => {
    const accountId = await newAccount();
    await importAsLegacy(accountId, statementA);
    const before = await ledger(accountId);
    expect((await importFile(accountId, statementA).expect(200)).body.data).toMatchObject({ imported: 0, skipped: 3 });
    expect(await ledger(accountId)).toEqual(before);
    const { res } = await importPostingFlagged(accountId, statementB);
    expect(res.body.data).toMatchObject({ imported: 2, skipped: 0, possibleDuplicates: [expect.objectContaining({ row: 1 })] });
    expect((await ledger(accountId)).rows.filter(row => isGrocer(row.name))).toHaveLength(3);
  });

  it("records each attempt in data_imports with the counts, outcomes and flags it returned", async () => {
    const accountId = await newAccount();
    await importFile(accountId, statementA).expect(200);
    // The held-back attempt writes no history row; the decided one does.
    const second = (await importPostingFlagged(accountId, statementB)).res.body.data;
    await importFile(accountId, statementB).expect(200);
    const records = await history(accountId);
    expect(records).toHaveLength(3);
    expect(records.map(record => [record.identity_version, record.status, record.record_count, record.imported_count,
      record.duplicate_count, record.failed_count])).toEqual([
      ["account-csv:v2", "completed", 3, 3, 0, 0],
      ["account-csv:v2", "completed", 2, 2, 0, 0],
      ["account-csv:v2", "completed", 2, 0, 2, 0],
    ]);
    expect(records[1].row_outcomes).toEqual([
      { ordinal: 1, outcome: "imported", transactionId: second.possibleDuplicates[0].transactionId,
        possibleDuplicateOf: second.possibleDuplicates[0].matchesTransactionId },
      { ordinal: 2, outcome: "imported", transactionId: expect.any(String) },
    ]);
    expect(records[2].row_outcomes.map(outcome => outcome.outcome)).toEqual(["duplicate", "duplicate"]);
  });
});
