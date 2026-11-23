/**
 * Import review follow-ups, real HTTP against real Postgres. Synthetic data only.
 *
 * - R2-01: a "skip" decision is bound to the ledger row the member was shown,
 *   exactly as a "post" is. When that row changes or disappears between review
 *   and execute, the skip is refused with the same 409 IMPORT_REVIEW_REQUIRED a
 *   stale post gets, on both import screens; an unchanged match is skipped.
 * - Defect 10: the Account Detail import audit row carries its total as a
 *   MoneyDto, and no household id when the target account is private.
 * - R2 P2: a wizard file with no currency column is bound to the account
 *   currency its preview showed; a change before execute is refused.
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

interface ReviewItem { row: number; matchesTransactionId: string }
interface PreviewRow { ordinal: number; status: string; candidate?: { id: string } }

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const detailRows = [
  { date: "2026-07-03", merchant: "Synthetic wave3 grocer", amount: "-30.00" },
  { date: "2026-07-07", merchant: "Synthetic wave3 salary", amount: "250.00" },
];
const wizardRows = detailRows.map(row => ({ Date: row.date, Amount: row.amount, Merchant: row.merchant }));
const mapping = { date: "Date", amount: "Amount", merchant: "Merchant" };

const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
const detailImport = (accountId: string, possibleDuplicateDecisions: Array<ReviewItem & { decision: "post" | "skip" }> = []) =>
  auth(request(app).post(`/api/accounts/${accountId}/transactions/import`))
    .send({ adjustBalance: true, transactions: detailRows, possibleDuplicateDecisions });
const wizardBody = (targetAccountId: string) =>
  ({ targetAccountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto", rows: wizardRows });
const wizardPreview = (accountId: string) => auth(request(app).post("/api/import/preview")).send(wizardBody(accountId));
const wizardExecute = (accountId: string, extra: Record<string, unknown> = {}) =>
  auth(request(app).post("/api/import/execute")).send({ ...wizardBody(accountId), ...extra });
const removeTransaction = (id: string) => auth(request(app).delete(`/api/transactions/${id}`)).expect(200);

async function newAccount(options: { isPrivate?: boolean } = {}) {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic wave3 cheque",
    type: "checking", isAsset: true, currency, balance: "1000.00", initialBalance: "1000.00",
    isPrivate: options.isPrivate ?? false }).returning();
  return account.id;
}

async function ledger(accountId: string) {
  const [account] = await db.select({ balance: accounts.balance, currency: accounts.currency }).from(accounts)
    .where(eq(accounts.id, accountId));
  const live = await pool.query<{ id: string; amount: string; currency: string }>(
    "SELECT id, amount, currency FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY date, id", [accountId]);
  const imports = await pool.query("SELECT id FROM data_imports WHERE account_id=$1", [accountId]);
  return { balance: account.balance, currency: account.currency, live: live.rows, imports: imports.rowCount };
}

/** The wizard's bound decisions for every candidate in a preview. */
const boundRows = (rows: PreviewRow[]) => rows.flatMap(row => row.candidate ? [{ ordinal: row.ordinal, candidateId: row.candidate.id }] : []);

describe("import review binding, audit privacy and preview currency (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `wave3-${userId}@example.invalid`;
    const password = "SyntheticWaveThree123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic wave3 imports", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `wave3-${userId}`,
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

  it("wizard: a skip bound to an unchanged candidate is applied (R2-01 control)", async () => {
    const accountId = await newAccount();
    await detailImport(accountId).expect(200);
    const posted = await ledger(accountId);
    const draft = await wizardPreview(accountId).expect(200);
    const skipRows = boundRows(draft.body.rows);
    expect(skipRows.map(row => row.candidateId)).toEqual(posted.live.map(row => row.id));

    const skipped = await wizardExecute(accountId, { skipRowOrdinals: [1, 2], skipRows }).expect(200);
    expect(skipped.body).toMatchObject({ imported: 0, skipped: 2 });
    expect((await ledger(accountId)).live).toEqual(posted.live);
  });

  it("wizard: a skip whose reviewed candidate disappeared is refused like a stale post (R2-01)", async () => {
    const accountId = await newAccount();
    await detailImport(accountId).expect(200);
    const draft = await wizardPreview(accountId).expect(200);
    const skipRows = boundRows(draft.body.rows);
    await removeTransaction(skipRows[0].candidateId);
    const before = await ledger(accountId);

    for (const decisions of [{ skipRowOrdinals: [1, 2], skipRows }, { skipRowOrdinals: [1, 2] }]) {
      const refused = await wizardExecute(accountId, decisions).expect(409);
      expect(refused.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
      expect(await ledger(accountId)).toEqual(before);
    }
  });

  it("Account Detail: a skip whose reviewed match disappeared is refused like a stale post (R2-01)", async () => {
    const accountId = await newAccount();
    await wizardExecute(accountId).expect(200);
    const held = await detailImport(accountId).expect(409);
    const review: ReviewItem[] = held.body.error.details.possibleDuplicates;
    expect(review.map(item => item.row)).toEqual([1, 2]);
    await removeTransaction(review[0].matchesTransactionId);
    const before = await ledger(accountId);

    const skips = review.map(item => ({ row: item.row, matchesTransactionId: item.matchesTransactionId, decision: "skip" as const }));
    const refused = await detailImport(accountId, skips).expect(409);
    expect(refused.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(refused.body.error.details.possibleDuplicates.map((item: ReviewItem) => item.row)).toEqual([2]);
    expect(await ledger(accountId)).toEqual(before);
  });

  it("Account Detail: the audit row on a private account has no household and a MoneyDto total (defect 10)", async () => {
    const accountId = await newAccount({ isPrivate: true });
    const imported = await detailImport(accountId).expect(200);
    const total = { amount: "220.00", currency };
    expect(imported.body.data).toMatchObject({ imported: 2, totalAmount: total });
    const audit = await pool.query<{ household_id: string | null; total: unknown }>(
      `SELECT household_id, details->'newValue'->'totalAmount' AS total FROM audit_logs
        WHERE entity_type = 'transaction_import' AND entity_id = $1`, [accountId]);
    expect(audit.rows).toEqual([{ household_id: null, total }]);
  });

  it("wizard: a file with no currency column is refused when the account currency changed after its preview (R2 P2)", async () => {
    const accountId = await newAccount();
    const draft = await wizardPreview(accountId).expect(200);
    expect(draft.body.accountCurrency).toBe(currency);
    await auth(request(app).put(`/api/accounts/${accountId}`)).send({ currency: "ZMW" }).expect(200);

    const refused = await wizardExecute(accountId, { previewCurrency: draft.body.accountCurrency }).expect(409);
    expect(refused.body.error.message).toMatch(/account currency changed/i);
    expect(await ledger(accountId)).toEqual({ balance: "1000.00", currency: "ZMW", live: [], imports: 0 });

    // Reviewed again in the new currency, it posts there.
    const again = await wizardPreview(accountId).expect(200);
    expect(again.body.accountCurrency).toBe("ZMW");
    await wizardExecute(accountId, { previewCurrency: again.body.accountCurrency }).expect(200);
    const after = await ledger(accountId);
    expect(after.live.map(row => row.currency)).toEqual(["ZMW", "ZMW"]);
  });
});
