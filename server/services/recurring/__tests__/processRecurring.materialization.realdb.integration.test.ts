/**
 * Packet R5: recurring materialization must be LOCKED, IDEMPOTENT and AUDITED — REAL DB.
 *
 * Audit finding (main): RecurringProcessingService.processRecurring read due rules
 * UNLOCKED under READ COMMITTED and advanced them with no FOR UPDATE and no
 * conditional guard, so overlapping / retried cron runs DOUBLE-CREATED the auto
 * transactions and DOUBLE-APPLIED the balance delta. The ledger transactions it
 * created also got NO BusinessAuditService rows (Rule 9 violation).
 *
 * These tests run the real service against real Postgres:
 *  (a) concurrency — two overlapping processRecurring runs for the same due rule
 *      must materialize it EXACTLY once (one transaction row, one balance delta,
 *      nextDueDate advanced once). Fails on old code with 2 rows / doubled balance.
 *  (b) audit — each materialized transaction must have an auditLogs row. Fails on
 *      old code (absent).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq, and, inArray } from "drizzle-orm";
import {
  accounts,
  categories,
  categoryGroups,
  transactions,
  recurringTransactions,
  recurringTransactionLinks,
  recurringTransactionHistory,
  auditLogs,
  users,
  households,
} from "@shared/schema";
import { recurringService } from "../RecurringService";
// RecurringProcessingService.RECURRING_CATCH_UP_LIMIT: missed occurrences one trusted run may book.
const RECURRING_CATCH_UP_LIMIT = 12;
import { Money } from "../../../core/money";
import { recordRecurringDenomination } from "../RecurringDenomination";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

describe("processRecurring materialization: locks, idempotency, audit (R5) — REAL DB", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let categoryId: string;
  let categoryGroupId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const user = createTestUser({
      email: `r5-${stamp}@example.com`,
      username: `r5-${stamp}`,
    });
    const hh = createTestHousehold(user.id, { name: `r5-${stamp}` });
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
      name: "r5-checking",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
    });

    categoryGroupId = randomUUID();
    await db.insert(categoryGroups).values({
      id: categoryGroupId,
      householdId,
      name: "r5-expenses",
      type: "expenses",
      isArchived: false,
      displayOrder: 0,
    });
    categoryId = randomUUID();
    await db.insert(categories).values({
      id: categoryId,
      householdId,
      groupId: categoryGroupId,
      name: "r5-subs",
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
          .where(
            inArray(recurringTransactionHistory.recurringTransactionId, ruleIds),
          );
        await db
          .delete(recurringTransactionLinks)
          .where(
            inArray(recurringTransactionLinks.recurringTransactionId, ruleIds),
          );
      }
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db
        .delete(recurringTransactions)
        .where(eq(recurringTransactions.householdId, householdId));
      await db.delete(categories).where(eq(categories.householdId, householdId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("R5 cleanup error", error);
      throw error;
    }
  });

  // Per-test isolation: processRecurring is HOUSEHOLD-WIDE, so a rule left due by
  // a prior test would be re-processed here. Wipe rules/txns/audit and reset the
  // account balance between tests.
  afterEach(async () => {
    const ruleRows = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(eq(recurringTransactions.householdId, householdId));
    const ruleIds = ruleRows.map((r) => r.id);
    if (ruleIds.length > 0) {
      await db
        .delete(recurringTransactionHistory)
        .where(
          inArray(recurringTransactionHistory.recurringTransactionId, ruleIds),
        );
      await db
        .delete(recurringTransactionLinks)
        .where(
          inArray(recurringTransactionLinks.recurringTransactionId, ruleIds),
        );
    }
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, householdId));
    await db
      .delete(recurringTransactions)
      .where(eq(recurringTransactions.householdId, householdId));
    await db
      .update(accounts)
      .set({ balance: "5000.00" })
      .where(eq(accounts.id, accountId));
  });

  async function seedRule(nextDueDate: string, amount = "100.00", proven = true): Promise<string> {
    const ruleId = randomUUID();
    const [rule] = await db.insert(recurringTransactions).values({
      id: ruleId,
      householdId,
      accountId,
      categoryId,
      name: "r5-rule",
      amount,
      type: "expense",
      frequency: "monthly",
      startDate: "2024-01-01",
      nextDueDate,
      isActive: true,
      isPaused: false,
    }).returning();
    // This positive arithmetic/concurrency fixture explicitly authors a known ZMW amount.
    // Legacy unknown-unit behavior has its own signed/trusted regression suite.
    if (proven) await db.transaction(tx => recordRecurringDenomination(tx, rule, "ZMW", userId, "trusted_recovery"));
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

  const balanceOf = async (accId: string): Promise<string> => {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accId))
      .limit(1);
    return row.balance;
  };

  it("concurrency: two overlapping runs materialize the rule EXACTLY once (one txn, one balance delta, advanced once)", async () => {
    const ruleId = await seedRule("2024-02-01");
    const balanceBefore = await balanceOf(accountId);

    // Warm the connection pool so BOTH runs get an established connection and
    // their unlocked findDue reads truly overlap. Without this, a cold second
    // connection can let run 1 fully commit (advancing nextDueDate) before run
    // 2's findDue executes, hiding the double-create race behind pool timing.
    await Promise.all([
      recurringService.getProjections(householdId, "2020-01-01", "2020-01-02"),
      recurringService.getProjections(householdId, "2020-01-01", "2020-01-02"),
      recurringService.getProjections(householdId, "2020-01-01", "2020-01-02"),
      recurringService.getProjections(householdId, "2020-01-01", "2020-01-02"),
    ]);

    // Two overlapping cron/manual runs. Both read the same due rule (findDue is
    // unlocked) BEFORE either advances it. On old code both create a transaction
    // and both apply the balance delta. The fix must let exactly one win.
    const [r1, r2] = await Promise.all([
      recurringService.processRecurring(householdId, "2024-02-15"),
      recurringService.processRecurring(householdId, "2024-02-15"),
    ]);

    // Exactly one of the two runs materialized the occurrence.
    expect(r1.created + r2.created).toBe(1);
    expect(await txnCountForRule(ruleId)).toBe(1);

    // nextDueDate advanced exactly one period.
    expect(await nextDueOf(ruleId)).toBe("2024-03-01");

    // Balance applied exactly once: a single -100.00 expense.
    const balanceAfter = await balanceOf(accountId);
    const appliedDelta = new Money(balanceBefore).subtract(
      new Money(balanceAfter),
    );
    expect(appliedDelta.toString()).toBe("100.00");
  });

  // FIN-05: a projection is money in the rule's proven unit, from its stored
  // decimal string (no Number()), never a bare number with no currency.
  it("projects each occurrence as Money in the rule's proven currency, to the stored cent", async () => {
    const ruleId = await seedRule("2030-01-15", "100.10");
    await seedRule("2030-01-20", "55.55", false);

    const projected = await recurringService.getProjections(householdId, "2030-01-01", "2030-02-28");

    expect(projected.map((p) => [p.date, p.ruleId, p.amount instanceof Money, p.amount.currency, p.amount.toString()])).toEqual([
      ["2030-01-15", ruleId, true, "ZMW", "100.10"],
      ["2030-02-15", ruleId, true, "ZMW", "100.10"],
    ]);
  });

  it("idempotency backstop: replaying the SAME occurrence is a clean skip, not a 500 or a double-create", async () => {
    const ruleId = await seedRule("2024-06-01");

    // First run materializes the 2024-06-01 occurrence (key = uuid5(rule,date))
    // and advances nextDueDate to 2024-07-01.
    const first = await recurringService.processRecurring(
      householdId,
      "2024-06-15",
    );
    expect(first.created).toBe(1);
    expect(await txnCountForRule(ruleId)).toBe(1);

    // Rewind nextDueDate to the SAME occurrence to simulate a retried/replayed
    // run (or a stale read on another instance) where the FOR UPDATE re-check
    // guard would NOT catch it — the occurrence looks due again. The deterministic
    // idempotency key must still prevent a second transaction: the UNIQUE
    // violation is caught as an idempotent skip inside the flow.
    await db
      .update(recurringTransactions)
      .set({ nextDueDate: "2024-06-01" })
      .where(eq(recurringTransactions.id, ruleId));

    const replay = await recurringService.processRecurring(
      householdId,
      "2024-06-15",
    );

    // No double-create, and NOT surfaced as an error (idempotent skip, not a 500).
    expect(replay.created).toBe(0);
    expect(replay.errors).toHaveLength(0);
    expect(await txnCountForRule(ruleId)).toBe(1);
  });

  it("audit: each materialized transaction writes a BusinessAuditService row for entityType 'transaction' (Rule 9)", async () => {
    const ruleId = await seedRule("2024-04-01");

    const res = await recurringService.processRecurring(
      householdId,
      "2024-04-15",
    );
    expect(res.created).toBe(1);

    const [txn] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.recurringTransactionId, ruleId))
      .limit(1);
    expect(txn).toBeTruthy();

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "transaction"),
          eq(auditLogs.entityId, txn.id),
        ),
      );

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].action).toBe("CREATE");
    expect(auditRows[0].householdId).toBe(householdId);
  });

  const ledgerDates = async (ruleId: string): Promise<string[]> =>
    (await db.select({ date: transactions.date }).from(transactions)
      .where(eq(transactions.recurringTransactionId, ruleId))).map((row) => row.date).sort();

  it("catch-up (NEW-30): a trusted run books each missed occurrence once, oldest first, and a re-run books nothing", async () => {
    const ruleId = await seedRule("2024-01-01");
    const balanceBefore = await balanceOf(accountId);

    const first = await recurringService.processRecurring(householdId, "2024-04-15");
    expect(first).toMatchObject({ created: 4, errors: [] });
    expect(await ledgerDates(ruleId)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]);
    expect(await nextDueOf(ruleId)).toBe("2024-05-01");
    expect(new Money(balanceBefore).subtract(new Money(await balanceOf(accountId))).toString()).toBe("400.00");

    const rerun = await recurringService.processRecurring(householdId, "2024-04-15");
    expect(rerun).toMatchObject({ created: 0, errors: [] });
    expect(await txnCountForRule(ruleId)).toBe(4);
  });

  it("catch-up (NEW-30): one run books at most the cap, and the next run continues from the cursor", async () => {
    const ruleId = await seedRule("2023-01-01");

    const first = await recurringService.processRecurring(householdId, "2024-06-15");
    expect(first).toMatchObject({ created: RECURRING_CATCH_UP_LIMIT, errors: [] });
    expect(await nextDueOf(ruleId)).toBe("2024-01-01");

    const second = await recurringService.processRecurring(householdId, "2024-06-15");
    expect(second).toMatchObject({ created: 6, errors: [] });
    expect(await nextDueOf(ruleId)).toBe("2024-07-01");
    const dates = await ledgerDates(ruleId);
    expect(dates).toHaveLength(18);
    expect(new Set(dates).size).toBe(18);
    expect(dates[0]).toBe("2023-01-01");
    expect(dates[17]).toBe("2024-06-01");
  });
});
