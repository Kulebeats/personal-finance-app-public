import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, auditLogs, dataImports, householdMembers, transactions, users } from "@shared/schema";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { hashPassword } from "../../auth";
import { db, pool } from "../../db";
import { accountRepository } from "../../repositories/AccountRepository";
import * as candidateReads from "../../services/import/candidates";

const password = "SyntheticImportReview123!";
const memberId = randomUUID();
const email = `import-review-${memberId}@example.invalid`;
const date = "2026-07-10";
const visibleName = "Synthetic visible shop";
const hiddenName = "Synthetic private revision";
const rows = [{ date, merchant: visibleName, amount: "-30.00" }];
const mapping = { date: "Date", amount: "Amount", merchant: "Merchant" };
type Strategy = "prioritize_coppercoin" | "prioritize_csv";

let owner: SignedHousehold;
let cookie: string;
const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", memberId)
  .set("X-Capital-Household", owner.householdId);
const detail = (accountId: string, possibleDuplicateDecisions: { row: number; matchesTransactionId: string; decision: "post" | "skip" }[] = []) =>
  auth(request(owner.app).post(`/api/accounts/${accountId}/transactions/import`))
    .send({ transactions: rows, adjustBalance: true, possibleDuplicateDecisions });
const wizard = (accountId: string, strategy: Strategy) =>
  auth(request(owner.app).post("/api/import/preview")).send({
    targetAccountId: accountId, strategy, mapping, categoryMapping: {}, dateFormat: "auto",
    rows: rows.map(row => ({ Date: row.date, Amount: row.amount, Merchant: row.merchant })),
  });

async function seed() {
  const accountId = await insertAccount(owner);
  const transactionId = randomUUID();
  await db.insert(transactions).values({
    id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
    type: "expense", date, name: visibleName, amount: "30.00", isPrivate: false,
  });
  return { accountId, transactionId };
}

describe("A-01/A-02 import review visibility over signed HTTP", () => {
  beforeAll(async () => {
    owner = await createSignedHousehold("import-review-visibility");
    await db.insert(users).values({
      id: memberId, email, username: `review-${memberId}`, passwordHash: await hashPassword(password), emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId: owner.householdId, userId: memberId, role: "member" });
    const response = await request(owner.app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (response.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30_000);

  afterAll(async () => {
    await owner.cleanup(async () => {
      await db.delete(dataImports).where(eq(dataImports.householdId, owner.householdId));
      await db.delete(auditLogs).where(eq(auditLogs.userId, memberId));
      await db.delete(householdMembers).where(eq(householdMembers.userId, memberId));
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [memberId]);
      await pool.query("DELETE FROM \"session\" WHERE sess->>'userId'=$1", [memberId]);
      await db.delete(users).where(eq(users.id, memberId));
    });
  });

  it("renders only the visible candidate snapshot and refuses a skip once the match goes private, revealing nothing", async () => {
    const { accountId, transactionId } = await seed();
    const original = candidateReads.readLedgerCandidates;
    const cut = vi.spyOn(candidateReads, "readLedgerCandidates").mockImplementationOnce(async (...args) => {
      const found = await original(...args);
      expect(found.map(row => row.id)).toContain(transactionId);
      await db.update(transactions).set({ isPrivate: true, name: hiddenName, amount: "731.25" })
        .where(eq(transactions.id, transactionId));
      return found;
    });
    try {
      const first = await detail(accountId).expect(409);
      expect(cut).toHaveBeenCalledOnce();
      expect(first.body.error).toMatchObject({ code: "IMPORT_REVIEW_REQUIRED", details: { possibleDuplicates: [{
        row: 1, matchesTransactionId: transactionId,
        match: { name: visibleName, date, amount: { amount: "30.00", currency: owner.currency } },
      }] } });
      expect(JSON.stringify(first.body)).not.toContain(hiddenName);
      expect(JSON.stringify(first.body)).not.toContain("731.25");
    } finally { cut.mockRestore(); }

    // R2-01 (coordinator ruling, changed from "still honors the skip"): a skip is bound to the match the
    // member saw. That match is now hidden, so the skip is stale and is refused like a stale post; the
    // fresh list is empty, so the 409 says nothing about the hidden row.
    const skipped = await detail(accountId, [{ row: 1, matchesTransactionId: transactionId, decision: "skip" }]).expect(409);
    expect(skipped.body.error).toMatchObject({ code: "IMPORT_REVIEW_REQUIRED", details: { possibleDuplicates: [] } });
    expect(JSON.stringify(skipped.body)).not.toContain(hiddenName);
    expect(JSON.stringify(skipped.body)).not.toContain("731.25");
    const [account] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
    expect(account.balance).toBe("100.00");
    expect(await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, accountId)))
      .toEqual([{ id: transactionId }]);
  });

  it("keeps a committed row's exact replay when a stale skip for its previous candidate is submitted", async () => {
    const { accountId, transactionId } = await seed();
    const held = await detail(accountId).expect(409);
    expect(held.body.error.details.possibleDuplicates[0]).toMatchObject({ row: 1, matchesTransactionId: transactionId });
    const accepted = await detail(accountId, [{ row: 1, matchesTransactionId: transactionId, decision: "post" }]).expect(200);
    expect(accepted.body.data).toMatchObject({ imported: 1, skipped: 0, reviewSkipped: 0 });

    const replay = await detail(accountId, [
      { row: 1, matchesTransactionId: transactionId, decision: "skip" },
      { row: 2, matchesTransactionId: transactionId, decision: "skip" },
    ]).expect(200);
    expect(replay.body.data).toMatchObject({ imported: 0, skipped: 1, reviewSkipped: 0 });
    const [account] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
    expect(account.balance).toBe("70.00");
  });

  it.each(["account", "membership"] as const)("an all-skip detail attempt records nothing after %s access changes", async cutKind => {
    const { accountId, transactionId } = await seed();
    const held = await detail(accountId).expect(409);
    expect(held.body.error.details.possibleDuplicates[0]).toMatchObject({ row: 1, matchesTransactionId: transactionId });
    const memberGrant = and(eq(householdMembers.householdId, owner.householdId), eq(householdMembers.userId, memberId));
    const findTarget = accountRepository.findByIdWithVisibility.bind(accountRepository);
    const cut = vi.spyOn(accountRepository, "findByIdWithVisibility").mockImplementationOnce(async (...args) => {
      const staleTarget = await findTarget(...args);
      expect(staleTarget?.id).toBe(accountId);
      if (cutKind === "account") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
      else await db.update(householdMembers).set({ role: "view_only" }).where(memberGrant);
      return staleTarget;
    });
    try {
      await detail(accountId, [{ row: 1, matchesTransactionId: transactionId, decision: "skip" }])
        .expect(cutKind === "account" ? 404 : 403);
      expect(cut).toHaveBeenCalledOnce();
      expect(await db.select({ id: dataImports.id }).from(dataImports).where(eq(dataImports.accountId, accountId))).toEqual([]);
      expect(await db.select({ id: auditLogs.id }).from(auditLogs)
        .where(and(eq(auditLogs.entityId, accountId), eq(auditLogs.entityType, "transaction_import")))).toEqual([]);
    } finally {
      cut.mockRestore();
      if (cutKind === "membership") await db.update(householdMembers).set({ role: "member" }).where(memberGrant);
    }
  });

  it.each(["prioritize_coppercoin", "prioritize_csv"] as const)("uses current writer, account and transaction privacy in %s", async strategy => {
    const { accountId, transactionId } = await seed();
    const visible = await wizard(accountId, strategy).expect(200);
    if (strategy === "prioritize_coppercoin") {
      expect(visible.body.rows[0]).toMatchObject({ status: "candidate", candidate: { id: transactionId, name: visibleName } });
    } else {
      expect(visible.body.removals).toMatchObject([{ id: transactionId, name: visibleName }]);
    }

    const memberGrant = and(eq(householdMembers.householdId, owner.householdId), eq(householdMembers.userId, memberId));
    const findTarget = accountRepository.findByIdWithVisibility.bind(accountRepository);
    for (const cutKind of ["transaction", "account", "membership"] as const) {
      const cut = vi.spyOn(accountRepository, "findByIdWithVisibility").mockImplementationOnce(async (...args) => {
        const staleTarget = await findTarget(...args);
        expect(staleTarget?.id).toBe(accountId);
        if (cutKind === "transaction") {
          await db.update(transactions).set({ isPrivate: true, name: hiddenName }).where(eq(transactions.id, transactionId));
        } else if (cutKind === "account") {
          await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
        } else {
          await db.update(householdMembers).set({ role: "view_only" }).where(memberGrant);
        }
        return staleTarget;
      });
      try {
        const result = await wizard(accountId, strategy).expect(cutKind === "transaction" ? 200 : 404);
        expect(cut).toHaveBeenCalledOnce();
        expect(JSON.stringify(result.body)).not.toContain(transactionId);
        expect(JSON.stringify(result.body)).not.toContain(hiddenName);
        if (cutKind === "transaction") {
          expect(result.body.rows[0].status).toBe("new");
          expect(result.body.removals).toEqual([]);
        }
      } finally {
        cut.mockRestore();
        if (cutKind === "transaction") await db.update(transactions).set({ isPrivate: false, name: visibleName }).where(eq(transactions.id, transactionId));
        if (cutKind === "account") await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, accountId));
        if (cutKind === "membership") await db.update(householdMembers).set({ role: "member" }).where(memberGrant);
      }
    }
  });
});
