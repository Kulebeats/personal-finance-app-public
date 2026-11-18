/**
 * SCP-330: processRecurring must process each due rule ATOMICALLY — REAL DB.
 *
 * Previously processRecurring ran create-txn + create-link + advance-nextDueDate +
 * log-history as four separate writes with no enclosing transaction. A partial
 * failure orphaned the auto transaction AND left nextDueDate un-advanced, so the
 * NEXT run double-created the transaction. The fix wraps all four writes in one
 * withTransaction per rule.
 *
 * These tests run the real service against real Postgres and inject a mid-sequence
 * failure (the last write, logHistory) to prove full rollback: no orphan txn, the
 * rule stays due, and the next run creates exactly one transaction (no double).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  categories,
  categoryGroups,
  transactions,
  recurringTransactions,
  recurringTransactionLinks,
  recurringTransactionHistory,
  users,
  households,
} from "@shared/schema";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { recurringService } from "../RecurringService";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

describe("processRecurring atomicity (SCP-330)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let categoryId: string;
  let categoryGroupId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const user = createTestUser({
      email: `scp330-${stamp}@example.com`,
      username: `scp330-${stamp}`,
    });
    const hh = createTestHousehold(user.id, { name: `scp330-${stamp}` });
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
      name: "scp330-checking",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
    });

    categoryGroupId = randomUUID();
    await db.insert(categoryGroups).values({
      id: categoryGroupId,
      householdId,
      name: "scp330-expenses",
      type: "expenses",
      isArchived: false,
      displayOrder: 0,
    });
    categoryId = randomUUID();
    await db.insert(categories).values({
      id: categoryId,
      householdId,
      groupId: categoryGroupId,
      name: "scp330-subs",
      isArchived: false,
      displayOrder: 0,
    });
  });

  afterAll(async () => {
    try {
      const ruleRows = await db
        .select({ id: recurringTransactions.id })
        .from(recurringTransactions)
        .where(eq(recurringTransactions.householdId, householdId));
      const ruleIds = ruleRows.map((r) => r.id);
      if (ruleIds.length > 0) {
        await db
          .delete(recurringTransactionHistory)
          .where(inArray(recurringTransactionHistory.recurringTransactionId, ruleIds));
        await db
          .delete(recurringTransactionLinks)
          .where(inArray(recurringTransactionLinks.recurringTransactionId, ruleIds));
      }
      await db.delete(transactions).where(eq(transactions.householdId, householdId));
      await db
        .delete(recurringTransactions)
        .where(eq(recurringTransactions.householdId, householdId));
      await db.delete(categories).where(eq(categories.householdId, householdId));
      await db.delete(categoryGroups).where(eq(categoryGroups.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-330 cleanup error", error);
    }
  });

  async function seedRule(nextDueDate: string): Promise<string> {
    const ruleId = randomUUID();
    await db.insert(recurringTransactions).values({
      id: ruleId,
      householdId,
      accountId,
      categoryId,
      name: "scp330-rule",
      amount: "100.00",
      type: "expense",
      frequency: "monthly",
      startDate: "2024-01-01",
      nextDueDate,
      isActive: true,
      isPaused: false,
    });
    return ruleId;
  }

  const txnCountForRule = async (ruleId: string): Promise<number> =>
    (
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.recurringTransactionId, ruleId))
    ).length;

  const nextDueOf = async (ruleId: string): Promise<string> => {
    const [row] = await db
      .select({ nextDueDate: recurringTransactions.nextDueDate })
      .from(recurringTransactions)
      .where(eq(recurringTransactions.id, ruleId))
      .limit(1);
    return row.nextDueDate;
  };

  it("creates one transaction, advances nextDueDate, and does not double-create on rerun", async () => {
    const ruleId = await seedRule("2024-02-01");

    const first = await recurringService.processRecurring(householdId, "2024-02-15");
    expect(first.created).toBe(1);
    expect(await txnCountForRule(ruleId)).toBe(1);
    expect(await nextDueOf(ruleId)).toBe("2024-03-01");

    // Re-run with the same asOf — the rule is no longer due, so nothing happens.
    const second = await recurringService.processRecurring(householdId, "2024-02-15");
    expect(second.created).toBe(0);
    expect(await txnCountForRule(ruleId)).toBe(1); // still exactly one — no double-create
  });

  it("rolls back fully on a mid-sequence failure: no orphan, no double-create next run", async () => {
    const ruleId = await seedRule("2024-02-01");

    // Force the LAST write in the per-rule transaction (logHistory) to fail once.
    const spy = vi
      .spyOn(recurringRepository, "logHistory")
      .mockRejectedValueOnce(new Error("simulated history write failure"));

    const failedRun = await recurringService.processRecurring(householdId, "2024-02-15");

    expect(failedRun.created).toBe(0);
    expect(failedRun.errors.some((e) => e.ruleId === ruleId)).toBe(true);
    // Full rollback: the auto transaction must NOT persist...
    expect(await txnCountForRule(ruleId)).toBe(0);
    // ...and nextDueDate must be un-advanced (rule still due).
    expect(await nextDueOf(ruleId)).toBe("2024-02-01");

    spy.mockRestore();

    // Next run now succeeds and creates EXACTLY ONE transaction (no double from a
    // leftover orphan, no skipped occurrence).
    const retry = await recurringService.processRecurring(householdId, "2024-02-15");
    expect(retry.created).toBe(1);
    expect(await txnCountForRule(ruleId)).toBe(1);
    expect(await nextDueOf(ruleId)).toBe("2024-03-01");
  });
});
