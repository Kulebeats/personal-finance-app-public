/**
 * SCP-337: linkReceiptToTransaction must be atomic + race-safe — REAL DB.
 *
 * The bug: the receipt status flip + "Receipt Import" tag add ran as read-then-
 * write with no transaction or lock, so a manual match racing the auto-match cron
 * could double-link a receipt and double-tag the transaction. The fix locks the
 * receipt row FOR UPDATE and re-checks matchStatus inside one transaction.
 *
 * These tests fire two genuinely concurrent links against real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq, and, inArray } from "drizzle-orm";
import {
  accounts,
  transactions,
  pendingReceipts,
  tags,
  transactionTags,
  users,
  households,
} from "@shared/schema";
import { receiptTransactionService } from "../transaction.service";
import { ConflictError } from "../../../utils/errorHandler";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

// The cron's auto-match and a manual match share this code path; the goal-sync
// side effect of transaction writes is irrelevant here, so silence its noise.
vi.mock("../../GoalAccountAssignmentService", () => ({
  goalAccountAssignmentService: { syncGoalsForAccount: vi.fn() },
}));

describe("linkReceiptToTransaction race safety (SCP-337)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const user = createTestUser({
      email: `scp337r-${stamp}@example.com`,
      username: `scp337r-${stamp}`,
    });
    const hh = createTestHousehold(user.id, { name: `scp337r-${stamp}` });
    householdId = hh.id;
    userId = user.id;

    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "scp337r-checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
    });
  });

  afterAll(async () => {
    try {
      const txnRows = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.householdId, householdId));
      const txnIds = txnRows.map((r) => r.id);
      if (txnIds.length > 0) {
        await db
          .delete(transactionTags)
          .where(inArray(transactionTags.transactionId, txnIds));
      }
      await db.delete(tags).where(eq(tags.householdId, householdId));
      await db
        .delete(pendingReceipts)
        .where(eq(pendingReceipts.householdId, householdId));
      await db.delete(transactions).where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-337 receipt cleanup error", error);
    }
  });

  async function seedTransaction(name: string): Promise<string> {
    const id = randomUUID();
    await db.insert(transactions).values({
      id,
      householdId,
      accountId,
      ownerUserId: userId,
      date: "2026-01-10",
      name,
      amount: "42.00",
      currency: "ZMW",
      type: "expense",
    });
    return id;
  }

  async function seedReceipt(): Promise<string> {
    const id = randomUUID();
    await db.insert(pendingReceipts).values({
      id,
      householdId,
      uploadedBy: userId,
      filename: `r-${id.slice(0, 8)}.jpg`,
      originalFilename: "receipt.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      storagePath: `/uploads/r-${id.slice(0, 8)}.jpg`,
      // ocrData null → amount validation skipped (focus on the race, not OCR).
    });
    return id;
  }

  const receiptImportTagLinks = async (txnId: string): Promise<number> => {
    const [tag] = await db
      .select()
      .from(tags)
      .where(
        and(eq(tags.householdId, householdId), eq(tags.name, "Receipt Import"))
      )
      .limit(1);
    if (!tag) return 0;
    return (
      await db
        .select()
        .from(transactionTags)
        .where(
          and(
            eq(transactionTags.transactionId, txnId),
            eq(transactionTags.tagId, tag.id)
          )
        )
    ).length;
  };

  const receiptStatus = async (receiptId: string) => {
    const [row] = await db
      .select({
        matchStatus: pendingReceipts.matchStatus,
        matchedTransactionId: pendingReceipts.matchedTransactionId,
      })
      .from(pendingReceipts)
      .where(eq(pendingReceipts.id, receiptId))
      .limit(1);
    return row;
  };

  it("does not double-link or double-tag when two matches race the SAME transaction", async () => {
    const txnId = await seedTransaction("race-same");
    const receiptId = await seedReceipt();

    const results = await Promise.allSettled([
      receiptTransactionService.linkReceiptToTransaction(
        receiptId,
        txnId,
        householdId,
        userId
      ),
      receiptTransactionService.linkReceiptToTransaction(
        receiptId,
        txnId,
        householdId,
        userId
      ),
    ]);

    // Linking the same receipt to the same transaction twice is idempotent —
    // both resolve, neither errors.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const status = await receiptStatus(receiptId);
    expect(status.matchStatus).toBe("matched");
    expect(status.matchedTransactionId).toBe(txnId);

    // The transaction is tagged exactly once — no double-tag.
    expect(await receiptImportTagLinks(txnId)).toBe(1);
  });

  it("links to only ONE transaction when two matches race DIFFERENT transactions", async () => {
    const txnA = await seedTransaction("race-A");
    const txnB = await seedTransaction("race-B");
    const receiptId = await seedReceipt();

    const [resA, resB] = await Promise.allSettled([
      receiptTransactionService.linkReceiptToTransaction(
        receiptId,
        txnA,
        householdId,
        userId
      ),
      receiptTransactionService.linkReceiptToTransaction(
        receiptId,
        txnB,
        householdId,
        userId
      ),
    ]);

    // Exactly one wins; the loser is rejected with a ConflictError (receipt taken).
    const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
    const rejected = [resA, resB].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );

    // The receipt is matched to exactly one transaction, and only that one is tagged.
    const status = await receiptStatus(receiptId);
    expect([txnA, txnB]).toContain(status.matchedTransactionId);
    const winner = status.matchedTransactionId as string;
    const loser = winner === txnA ? txnB : txnA;
    expect(await receiptImportTagLinks(winner)).toBe(1);
    expect(await receiptImportTagLinks(loser)).toBe(0);
  });
});
