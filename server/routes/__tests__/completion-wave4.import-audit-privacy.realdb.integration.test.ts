/**
 * #367 review follow-ups: import audit rows on private accounts, real HTTP against real Postgres.
 * Synthetic data only.
 *
 * - P2-1: an Account Detail import whose account goes private after the pre-lock read still writes
 *   its summary audit row with no household id (the locked, current account decides).
 * - P2-2: the wizard's transaction_import audit row has no household id on a private account, and
 *   "CSV wins" still recognises an exact retry of its last statement from that row, so a purchase
 *   added since the first upload is kept.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { accountRepository } from "../../repositories/AccountRepository";

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const detailRows = [
  { date: "2026-08-03", merchant: "Synthetic wave4 grocer", amount: "-30.00" },
  { date: "2026-08-07", merchant: "Synthetic wave4 salary", amount: "250.00" },
];
const wizardRows = detailRows.map(row => ({ Date: row.date, Amount: row.amount, Merchant: row.merchant }));
const mapping = { date: "Date", amount: "Amount", merchant: "Merchant" };
type Strategy = "prioritize_coppercoin" | "prioritize_csv";

const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
const detailImport = (accountId: string) => auth(request(app).post(`/api/accounts/${accountId}/transactions/import`))
  .send({ adjustBalance: true, transactions: detailRows, possibleDuplicateDecisions: [] });
const wizardBody = (targetAccountId: string, strategy: Strategy) =>
  ({ targetAccountId, strategy, mapping, categoryMapping: {}, dateFormat: "auto", rows: wizardRows });
const wizardPreview = (accountId: string, strategy: Strategy) =>
  auth(request(app).post("/api/import/preview")).send(wizardBody(accountId, strategy));
const wizardExecute = (accountId: string, strategy: Strategy) =>
  auth(request(app).post("/api/import/execute")).send({ ...wizardBody(accountId, strategy), previewCurrency: currency });

async function newAccount(options: { isPrivate?: boolean } = {}) {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic wave4 cheque",
    type: "checking", isAsset: true, currency, balance: "1000.00", initialBalance: "1000.00",
    isPrivate: options.isPrivate ?? false }).returning();
  return account.id;
}

async function importAudit(accountId: string) {
  const audit = await pool.query<{ household_id: string | null }>(
    "SELECT household_id FROM audit_logs WHERE entity_type = 'transaction_import' AND entity_id = $1 ORDER BY created_at, id", [accountId]);
  return audit.rows;
}

describe("import audit rows on private accounts (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `wave4-${userId}@example.invalid`;
    const password = "SyntheticWaveFour123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic wave4 imports", currency });
    await db.insert(users).values({ id: userId, email, username: `wave4-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM data_imports WHERE user_id=$1", [userId]);
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("Account Detail: an account made private after the pre-lock read gets a summary audit row with no household (P2-1)", async () => {
    const accountId = await newAccount();
    const findTarget = accountRepository.findByIdWithVisibility.bind(accountRepository);
    const cut = vi.spyOn(accountRepository, "findByIdWithVisibility").mockImplementationOnce(async (...args) => {
      const staleTarget = await findTarget(...args);
      expect(staleTarget?.isPrivate).toBe(false);
      await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
      return staleTarget;
    });
    try {
      const imported = await detailImport(accountId).expect(200);
      // The first read is the service's pre-lock target read (the cut); posting rows reads the account again.
      expect(cut).toHaveBeenCalled();
      expect(imported.body.data).toMatchObject({ imported: 2 });
    } finally { cut.mockRestore(); }
    expect(await importAudit(accountId)).toEqual([{ household_id: null }]);
  });

  it("wizard: the import audit row on a private account has no household (P2-2)", async () => {
    const accountId = await newAccount({ isPrivate: true });
    const imported = await wizardExecute(accountId, "prioritize_coppercoin").expect(200);
    expect(imported.body).toMatchObject({ imported: 2 });
    expect(await importAudit(accountId)).toEqual([{ household_id: null }]);
  });

  it("wizard CSV wins on a private account: an exact retry keeps a purchase added since the first upload (P2-2)", async () => {
    const accountId = await newAccount({ isPrivate: true });
    await wizardExecute(accountId, "prioritize_csv").expect(200);
    const purchaseId = randomUUID();
    await db.insert(transactions).values({ id: purchaseId, householdId, accountId, ownerUserId: userId, type: "expense",
      date: "2026-08-05", name: "Synthetic wave4 later purchase", amount: "12.00", currency, isPrivate: false });

    const again = await wizardPreview(accountId, "prioritize_csv").expect(200);
    expect(again.body.removals).toEqual([]);
    const retried = await wizardExecute(accountId, "prioritize_csv").expect(200);
    expect(retried.body).toMatchObject({ imported: 0, duplicate: 2, deleted: 0 });
    const kept = await pool.query("SELECT id FROM transactions WHERE id = $1 AND deleted_at IS NULL", [purchaseId]);
    expect(kept.rowCount).toBe(1);
    expect(await importAudit(accountId)).toEqual([{ household_id: null }, { household_id: null }]);
  });
});
