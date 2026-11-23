/**
 * Settings Account Deletion - Database Integration Tests (SCP-332)
 *
 * Real-Postgres tests for DPA right-to-erasure. Seeds a household + user + a
 * spread of financial rows (account, transaction + split, budget + period,
 * goal + contribution, recurring rule, prior audit log), runs the deletion
 * path, and asserts:
 *
 *   1. NO readable financial rows remain for that household (every scoped table
 *      queried by householdId returns length 0).
 *   2. The user row is irreversibly anonymised (no readable PII / credentials).
 *   3. A durable erasure audit row is written with the correct userId, and it
 *      is written BEFORE the session is destroyed (audit-before-destroy order).
 *
 * Uses the real db client; cleanup in afterAll. tsconfig excludes *.test.ts
 * from tsc, so run explicitly:  cd server && npx vitest run <thisfile>
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { db } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  grzTBills,
  investmentTransactions,
  transactions,
  transactionSplits,
  budgets,
  budgetPeriods,
  goals,
  goalContributions,
  goalProgressAdjustments,
  recurringTransactions,
  auditLogs,
  categoryGroups,
  categories,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";
import { settingsAccountController } from "../settings.account.controller";
import { eraseAccount } from "../settings.account-deletion.service";

const PASSWORD = "ErasureTestPassword123";

describe("Settings Account Deletion - DB Integration (SCP-332)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let categoryGroupId: string;
  let categoryId: string;
  let transactionId: string;
  let budgetId: string;
  let goalId: string;
  let recurringId: string;
  let userEmail: string;

  // Bystander household: proves erasure is scoped and does not touch others.
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAccountId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);

    // ---- Primary (to-be-erased) household + user ----
    const testUser = createTestUser({
      email: `erasure-${timestamp}@example.com`,
      username: `erasure-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id);
    householdId = testHousehold.id;
    userId = testUser.id;
    userEmail = testUser.email;

    await db.insert(households).values({
      id: householdId,
      name: "Erasure Test Household",
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: userId,
      email: userEmail,
      username: testUser.username,
      passwordHash,
      fullName: "Erasure Victim",
      firstName: "Erasure",
      lastName: "Victim",
      phoneNumberMobile: "+260971234567",
      nrc: "123456/78/9",
      annualIncome: "120000.00",
      emailVerified: true,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "owner",
    });

    // ---- Financial spread ----
    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Erasure Checking",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
    });

    const [maturity] = await db.insert(investmentTransactions).values({ householdId, accountId, type: "maturity",
      amount: "100.00", currency: "ZMW", transactionDate: "2025-04-02" }).returning();
    await db.insert(grzTBills).values({ householdId, accountId, tbillName: "Historical maturity", tenorDays: 91,
      faceValue: "100.00", purchasePrice: "98.00", purchaseDate: "2025-01-01", maturityDate: "2025-04-02",
      maturedDate: "2025-04-02", status: "matured", maturityInvestmentTxId: maturity.id });

    categoryGroupId = randomUUID();
    await db.insert(categoryGroups).values({
      id: categoryGroupId,
      householdId,
      name: "Erasure Group",
      type: "expenses",
      isArchived: false,
      displayOrder: 0,
    });
    categoryId = randomUUID();
    await db.insert(categories).values({
      id: categoryId,
      householdId,
      groupId: categoryGroupId,
      name: "Erasure Category",
      icon: "tag",
      color: "#112233",
      isArchived: false,
      displayOrder: 0,
    });

    transactionId = randomUUID();
    await db.insert(transactions).values({
      id: transactionId,
      householdId,
      accountId,
      name: "Erasure Transaction",
      amount: "250.00",
      type: "expense",
      date: "2024-05-01",
      categoryId,
      ownerUserId: userId,
    });
    // child of transaction (no household_id column)
    await db.insert(transactionSplits).values({
      id: randomUUID(),
      transactionId,
      amount: "250.00",
      categoryId,
      notes: "Erasure split",
      displayOrder: 0,
    });

    budgetId = randomUUID();
    await db.insert(budgets).values({
      id: budgetId,
      householdId,
      name: "Erasure Budget",
      categoryId,
      amount: "1000.00",
      period: "monthly",
      currency: "ZMW",
    });
    // child of budget (no household_id column)
    await db.insert(budgetPeriods).values({
      id: randomUUID(),
      budgetId,
      startDate: "2024-05-01",
      endDate: "2024-05-31",
      budgetAmount: "1000.00",
      spentAmount: "250.00",
      currency: "ZMW",
    });

    goalId = randomUUID();
    await db.insert(goals).values({
      id: goalId,
      householdId,
      name: "Erasure Goal",
      targetAmount: "10000.00",
      currency: "ZMW",
      createdBy: userId,
    });
    // child of goal (no household_id column)
    await db.insert(goalContributions).values({
      id: randomUUID(),
      goalId,
      amount: "500.00",
      date: "2024-05-02",
      notes: "Erasure contribution",
    });
    // child of goal (#222): a transfer's half, whose ref has no foreign key
    await db.insert(goalProgressAdjustments).values({
      goalId, kind: "transfer_in", refId: randomUUID(), amount: "50.00", appliedDelta: "50.00",
      placedAt: new Date(), createdBy: userId,
    });

    recurringId = randomUUID();
    await db.insert(recurringTransactions).values({
      id: recurringId,
      householdId,
      accountId,
      name: "Erasure Recurring",
      amount: "99.00",
      type: "expense",
      frequency: "monthly",
      startDate: "2024-01-01",
      nextDueDate: "2024-06-01",
    });

    // a prior financial audit row for this household (should be removed)
    await db.insert(auditLogs).values({
      householdId,
      userId,
      action: "CREATE",
      entityType: "transaction",
      entityId: transactionId,
      details: { amount: "250.00" },
    });

    // ---- Bystander household (must remain intact) ----
    const otherUser = createTestUser({
      email: `erasure-other-${timestamp}@example.com`,
      username: `erasure-other-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id);
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;
    await db.insert(households).values({
      id: otherHouseholdId,
      name: "Bystander Household",
      currency: "ZMW",
    });
    await db.insert(users).values({
      id: otherUserId,
      email: otherUser.email,
      username: otherUser.username,
      passwordHash,
      fullName: "Bystander User",
      emailVerified: true,
    });
    await db.insert(householdMembers).values({
      householdId: otherHouseholdId,
      userId: otherUserId,
      role: "owner",
    });
    otherAccountId = randomUUID();
    await db.insert(accounts).values({
      id: otherAccountId,
      householdId: otherHouseholdId,
      name: "Bystander Account",
      type: "checking",
      balance: "3000.00",
      currency: "ZMW",
    });
  });

  afterAll(async () => {
    try {
      // Primary household rows are mostly gone after the test; clean up
      // whatever remains plus the anonymised user and the durable audit row.
      await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
      await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
      await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, householdId));
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(recurringTransactions)
        .where(eq(recurringTransactions.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await db.delete(goals).where(eq(goals.householdId, householdId));
      await db
        .delete(categories)
        .where(eq(categories.householdId, householdId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));

      // Bystander cleanup
      await db
        .delete(accounts)
        .where(eq(accounts.householdId, otherHouseholdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, otherHouseholdId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    } catch (error) {
      console.error("Cleanup error (ignored):", error);
    }
  });

  it("erases all financial data, anonymises the user, and audits before destroy", async () => {
    // Track whether the durable audit row already existed at the moment the
    // session was destroyed (proves audit-before-destroy ordering).
    let auditExistedAtDestroy = false;
    let destroyCalled = false;
    let responseStatus = 0;
    let responseBody: unknown;

    const donePromise = new Promise<void>((resolve, reject) => {
      const req = {
        body: { password: PASSWORD },
        session: {
          userId,
          async destroy(cb: (err?: unknown) => void) {
            destroyCalled = true;
            // At destroy time, the erasure audit row must already be committed.
            const rows = await db
              .select()
              .from(auditLogs)
              .where(
                and(
                  eq(auditLogs.entityType, "user_account"),
                  eq(auditLogs.entityId, userId),
                  eq(auditLogs.action, "DELETE"),
                ),
              );
            auditExistedAtDestroy = rows.length > 0;
            cb();
          },
        },
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        ip: "127.0.0.1",
      } as unknown as Request;

      const res = {
        clearCookie() {
          return res;
        },
        status(code: number) {
          responseStatus = code;
          return res;
        },
        json(payload: unknown) {
          responseBody = payload;
          resolve();
          return res;
        },
      } as unknown as Response;

      const next: NextFunction = (err?: unknown) => {
        reject(err ?? new Error("deleteAccount called next() unexpectedly"));
      };

      void settingsAccountController.deleteAccount(req, res, next);
    });

    await donePromise;

    // ---- Response + ordering ----
    expect(destroyCalled).toBe(true);
    expect(auditExistedAtDestroy).toBe(true);
    expect(responseStatus).toBe(200);
    expect(responseBody).toMatchObject({ success: true });

    // ---- No readable financial rows remain for the household ----
    const remaining = {
      bills: await db.select().from(grzTBills).where(eq(grzTBills.householdId, householdId)),
      investmentPostings: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId)),
      accounts: await db
        .select()
        .from(accounts)
        .where(eq(accounts.householdId, householdId)),
      transactions: await db
        .select()
        .from(transactions)
        .where(eq(transactions.householdId, householdId)),
      transactionSplits: await db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactionId)),
      budgets: await db
        .select()
        .from(budgets)
        .where(eq(budgets.householdId, householdId)),
      budgetPeriods: await db
        .select()
        .from(budgetPeriods)
        .where(eq(budgetPeriods.budgetId, budgetId)),
      goals: await db
        .select()
        .from(goals)
        .where(eq(goals.householdId, householdId)),
      goalContributions: await db
        .select()
        .from(goalContributions)
        .where(eq(goalContributions.goalId, goalId)),
      goalProgressAdjustments: await db
        .select()
        .from(goalProgressAdjustments)
        .where(eq(goalProgressAdjustments.goalId, goalId)),
      recurring: await db
        .select()
        .from(recurringTransactions)
        .where(eq(recurringTransactions.householdId, householdId)),
      categories: await db
        .select()
        .from(categories)
        .where(eq(categories.householdId, householdId)),
      categoryGroups: await db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId)),
      members: await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId)),
    };

    for (const [table, rows] of Object.entries(remaining)) {
      expect(rows.length, `expected 0 rows left in ${table}`).toBe(0);
    }

    // Sole-member household row should also be gone.
    const householdRow = await db
      .select()
      .from(households)
      .where(eq(households.id, householdId));
    expect(householdRow.length).toBe(0);

    // ---- User row anonymised (kept, but scrubbed) ----
    const [erasedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(erasedUser).toBeDefined();
    expect(erasedUser.email).not.toBe(userEmail);
    expect(erasedUser.email).toContain("@deleted.invalid");
    expect(erasedUser.fullName).toBeNull();
    expect(erasedUser.firstName).toBeNull();
    expect(erasedUser.lastName).toBeNull();
    expect(erasedUser.phoneNumberMobile).toBeNull();
    expect(erasedUser.nrc).toBeNull();
    expect(erasedUser.annualIncome).toBeNull();

    // ---- Durable erasure audit row with correct actor ----
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "user_account"),
          eq(auditLogs.entityId, userId),
          eq(auditLogs.action, "DELETE"),
        ),
      );
    expect(auditRow).toBeDefined();
    expect(auditRow.userId).toBe(userId);
    expect(auditRow.householdId).toBeNull();

    // Prior household-scoped financial audit row was erased.
    const priorAudit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.householdId, householdId));
    expect(priorAudit.length).toBe(0);

    // ---- Bystander household untouched ----
    const otherAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, otherHouseholdId));
    expect(otherAccounts.length).toBe(1);
    const [otherUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, otherUserId));
    expect(otherUser.fullName).toBe("Bystander User");
  });
});

// ---------------------------------------------------------------------------
// Multi-member households (Option A)
//
// Deleting ONE member's account must NOT destroy the household's shared
// financial data while other members remain. Only a sole member / last one out
// triggers the household-wide hard delete (covered above). If the erased user
// was the household's only owner, the earliest-joined remaining member is
// promoted to owner so the household is never left ungovernable.
// ---------------------------------------------------------------------------

interface SeededMultiMember {
  householdId: string;
  ownerUserId: string;
  ownerEmail: string;
  memberUserId: string;
  memberEmail: string;
  accountId: string;
  categoryGroupId: string;
  categoryId: string;
  transactionId: string;
  budgetId: string;
  goalId: string;
}

/**
 * Seed a household with an owner + a second member and a small spread of
 * shared, household-scoped financial data. The second member's role is
 * configurable so the same helper serves both the "non-owner leaves" and the
 * "owner leaves" scenarios. The member joins AFTER the owner so the
 * earliest-joined ordering used by owner succession is deterministic.
 */
async function seedHouseholdWithTwoMembers(opts: {
  passwordHash: string;
  label: string;
  memberRole: "member" | "admin" | "view_only";
}): Promise<SeededMultiMember> {
  const owner = createTestUser({
    email: `mm-owner-${opts.label}@example.com`,
    username: `mm-owner-${opts.label}`,
  });
  const member = createTestUser({
    email: `mm-member-${opts.label}@example.com`,
    username: `mm-member-${opts.label}`,
  });
  const household = createTestHousehold(owner.id);

  await db.insert(households).values({
    id: household.id,
    name: `Shared Household ${opts.label}`,
    currency: "ZMW",
  });
  await db.insert(users).values({
    id: owner.id,
    email: owner.email,
    username: owner.username,
    passwordHash: opts.passwordHash,
    fullName: "Shared Owner",
    firstName: "Shared",
    lastName: "Owner",
    emailVerified: true,
  });
  await db.insert(users).values({
    id: member.id,
    email: member.email,
    username: member.username,
    passwordHash: opts.passwordHash,
    fullName: "Shared Member",
    firstName: "Shared",
    lastName: "Member",
    phoneNumberMobile: "+260970000000",
    nrc: "999999/88/7",
    annualIncome: "60000.00",
    emailVerified: true,
  });
  // Owner joins first; the member joins one second later so succession picks
  // the most-senior remaining member deterministically.
  await db.insert(householdMembers).values({
    householdId: household.id,
    userId: owner.id,
    role: "owner",
    joinedAt: new Date(Date.now() - 1000),
  });
  await db.insert(householdMembers).values({
    householdId: household.id,
    userId: member.id,
    role: opts.memberRole,
    joinedAt: new Date(),
  });

  // ---- Shared financial spread (jointly owned by the household) ----
  const accountId = randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    householdId: household.id,
    name: "Shared Checking",
    type: "checking",
    balance: "5000.00",
    currency: "ZMW",
  });

  const categoryGroupId = randomUUID();
  await db.insert(categoryGroups).values({
    id: categoryGroupId,
    householdId: household.id,
    name: "Shared Group",
    type: "expenses",
    isArchived: false,
    displayOrder: 0,
  });
  const categoryId = randomUUID();
  await db.insert(categories).values({
    id: categoryId,
    householdId: household.id,
    groupId: categoryGroupId,
    name: "Shared Category",
    icon: "tag",
    color: "#445566",
    isArchived: false,
    displayOrder: 0,
  });

  // A transaction created BY the member, but part of the shared ledger: it must
  // survive even when the member is the one leaving.
  const transactionId = randomUUID();
  await db.insert(transactions).values({
    id: transactionId,
    householdId: household.id,
    accountId,
    name: "Shared Transaction",
    amount: "250.00",
    type: "expense",
    date: "2024-05-01",
    categoryId,
    ownerUserId: member.id,
  });
  await db.insert(transactionSplits).values({
    id: randomUUID(),
    transactionId,
    amount: "250.00",
    categoryId,
    notes: "Shared split",
    displayOrder: 0,
  });

  const budgetId = randomUUID();
  await db.insert(budgets).values({
    id: budgetId,
    householdId: household.id,
    name: "Shared Budget",
    categoryId,
    amount: "1000.00",
    period: "monthly",
    currency: "ZMW",
  });
  await db.insert(budgetPeriods).values({
    id: randomUUID(),
    budgetId,
    startDate: "2024-05-01",
    endDate: "2024-05-31",
    budgetAmount: "1000.00",
    spentAmount: "250.00",
    currency: "ZMW",
  });

  const goalId = randomUUID();
  await db.insert(goals).values({
    id: goalId,
    householdId: household.id,
    name: "Shared Goal",
    targetAmount: "10000.00",
    currency: "ZMW",
    createdBy: owner.id,
  });
  await db.insert(goalContributions).values({
    id: randomUUID(),
    goalId,
    amount: "500.00",
    date: "2024-05-02",
    notes: "Shared contribution",
  });

  return {
    householdId: household.id,
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    memberUserId: member.id,
    memberEmail: member.email,
    accountId,
    categoryGroupId,
    categoryId,
    transactionId,
    budgetId,
    goalId,
  };
}

/** Invoke the real deleteAccount controller with a mock session/req/res. */
async function runDeleteAccount(
  userId: string,
  password: string,
): Promise<{ destroyCalled: boolean; status: number; body: unknown }> {
  let destroyCalled = false;
  let status = 0;
  let body: unknown;

  await new Promise<void>((resolve, reject) => {
    const req = {
      body: { password },
      session: {
        userId,
        async destroy(cb: (err?: unknown) => void) {
          destroyCalled = true;
          cb();
        },
      },
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      ip: "127.0.0.1",
    } as unknown as Request;

    const res = {
      clearCookie() {
        return res;
      },
      status(code: number) {
        status = code;
        return res;
      },
      json(payload: unknown) {
        body = payload;
        resolve();
        return res;
      },
    } as unknown as Response;

    const next: NextFunction = (err?: unknown) => {
      reject(err ?? new Error("deleteAccount called next() unexpectedly"));
    };

    void settingsAccountController.deleteAccount(req, res, next);
  });

  return { destroyCalled, status, body };
}

/** Remove every row seeded by seedHouseholdWithTwoMembers, in FK-safe order. */
async function cleanupMultiMember(seed: SeededMultiMember): Promise<void> {
  try {
    await db.delete(auditLogs).where(eq(auditLogs.userId, seed.ownerUserId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, seed.memberUserId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, seed.householdId));
    await db.delete(goals).where(eq(goals.householdId, seed.householdId));
    await db
      .delete(budgets)
      .where(eq(budgets.householdId, seed.householdId));
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, seed.householdId));
    await db
      .delete(categories)
      .where(eq(categories.householdId, seed.householdId));
    await db
      .delete(categoryGroups)
      .where(eq(categoryGroups.householdId, seed.householdId));
    await db.delete(accounts).where(eq(accounts.householdId, seed.householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, seed.householdId));
    await db.delete(users).where(eq(users.id, seed.ownerUserId));
    await db.delete(users).where(eq(users.id, seed.memberUserId));
    await db.delete(households).where(eq(households.id, seed.householdId));
  } catch (error) {
    console.error("Multi-member cleanup error (ignored):", error);
  }
}

/** Assert the shared financial spread for a household is still present. */
async function expectSharedDataIntact(seed: SeededMultiMember): Promise<void> {
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.householdId, seed.householdId));
  expect(accountRows.length, "shared account should survive").toBe(1);

  const txnRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.householdId, seed.householdId));
  expect(txnRows.length, "shared transaction should survive").toBe(1);

  const splitRows = await db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, seed.transactionId));
  expect(splitRows.length, "shared transaction split should survive").toBe(1);

  const budgetRows = await db
    .select()
    .from(budgets)
    .where(eq(budgets.householdId, seed.householdId));
  expect(budgetRows.length, "shared budget should survive").toBe(1);

  const goalRows = await db
    .select()
    .from(goals)
    .where(eq(goals.householdId, seed.householdId));
  expect(goalRows.length, "shared goal should survive").toBe(1);

  const goalContribRows = await db
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, seed.goalId));
  expect(goalContribRows.length, "shared goal contribution should survive").toBe(
    1,
  );

  const householdRow = await db
    .select()
    .from(households)
    .where(eq(households.id, seed.householdId));
  expect(householdRow.length, "household row should survive").toBe(1);
}

describe("Settings Account Deletion - Multi-Member: non-owner leaves (SCP-332 Option A)", () => {
  let seed: SeededMultiMember;
  const label = `nonowner-${Date.now()}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    seed = await seedHouseholdWithTwoMembers({
      passwordHash,
      label,
      memberRole: "member",
    });
  });

  afterAll(async () => {
    await cleanupMultiMember(seed);
  });

  it("retains the household's shared data and the remaining owner when a member erases their account", async () => {
    const { destroyCalled, status, body } = await runDeleteAccount(
      seed.memberUserId,
      PASSWORD,
    );

    expect(destroyCalled).toBe(true);
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });

    // Shared financial data + the household row are untouched.
    await expectSharedDataIntact(seed);

    // The leaving member's membership is gone; the owner's remains, still owner.
    const memberRows = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, seed.householdId),
          eq(householdMembers.userId, seed.memberUserId),
        ),
      );
    expect(memberRows.length, "leaving member's membership removed").toBe(0);

    const ownerRows = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, seed.householdId),
          eq(householdMembers.userId, seed.ownerUserId),
        ),
      );
    expect(ownerRows.length).toBe(1);
    expect(ownerRows[0].role, "owner stays owner (no succession needed)").toBe(
      "owner",
    );

    // The remaining owner's user row is untouched (not anonymised).
    const [ownerUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, seed.ownerUserId));
    expect(ownerUser.fullName).toBe("Shared Owner");
    expect(ownerUser.email).toBe(seed.ownerEmail);

    // The leaving member's user row IS anonymised.
    const [erasedMember] = await db
      .select()
      .from(users)
      .where(eq(users.id, seed.memberUserId));
    expect(erasedMember).toBeDefined();
    expect(erasedMember.email).not.toBe(seed.memberEmail);
    expect(erasedMember.email).toContain("@deleted.invalid");
    expect(erasedMember.fullName).toBeNull();
    expect(erasedMember.nrc).toBeNull();
    expect(erasedMember.annualIncome).toBeNull();

    // A durable erasure audit row was written for the leaving member, recording
    // that the household was NOT deleted.
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "user_account"),
          eq(auditLogs.entityId, seed.memberUserId),
          eq(auditLogs.action, "DELETE"),
        ),
      );
    expect(auditRow).toBeDefined();
    expect(auditRow.userId).toBe(seed.memberUserId);
    expect(auditRow.householdId).toBeNull();
    const memberAuditDetails = auditRow.details as {
      householdDeleted?: boolean;
      ownerSuccessorUserId?: string | null;
    };
    expect(memberAuditDetails.householdDeleted).toBe(false);
    // No succession when an owner still remains.
    expect(memberAuditDetails.ownerSuccessorUserId).toBeNull();
  });
});

describe("Settings Account Deletion - Multi-Member: sole owner leaves (SCP-332 owner succession)", () => {
  let seed: SeededMultiMember;
  const label = `owner-${Date.now()}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    seed = await seedHouseholdWithTwoMembers({
      passwordHash,
      label,
      memberRole: "member",
    });
  });

  afterAll(async () => {
    await cleanupMultiMember(seed);
  });

  it("retains shared data and promotes the remaining member to owner when the sole owner erases their account", async () => {
    const { destroyCalled, status, body } = await runDeleteAccount(
      seed.ownerUserId,
      PASSWORD,
    );

    expect(destroyCalled).toBe(true);
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });

    // Shared financial data + the household row are untouched.
    await expectSharedDataIntact(seed);

    // The erasing owner's membership is gone.
    const ownerRows = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, seed.householdId),
          eq(householdMembers.userId, seed.ownerUserId),
        ),
      );
    expect(ownerRows.length, "erasing owner's membership removed").toBe(0);

    // The remaining member has been promoted to owner so the household is still
    // governable.
    const memberRows = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, seed.householdId),
          eq(householdMembers.userId, seed.memberUserId),
        ),
      );
    expect(memberRows.length).toBe(1);
    expect(memberRows[0].role, "remaining member promoted to owner").toBe(
      "owner",
    );

    // Exactly one owner remains for the household.
    const owners = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, seed.householdId),
          eq(householdMembers.role, "owner"),
        ),
      );
    expect(owners.length, "exactly one owner after succession").toBe(1);
    expect(owners[0].userId).toBe(seed.memberUserId);

    // The remaining member's user row is untouched.
    const [memberUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, seed.memberUserId));
    expect(memberUser.fullName).toBe("Shared Member");
    expect(memberUser.email).toBe(seed.memberEmail);

    // The erasing owner's user row IS anonymised.
    const [erasedOwner] = await db
      .select()
      .from(users)
      .where(eq(users.id, seed.ownerUserId));
    expect(erasedOwner.email).toContain("@deleted.invalid");
    expect(erasedOwner.fullName).toBeNull();

    // Durable erasure audit row records the successor and that the household
    // was not deleted.
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "user_account"),
          eq(auditLogs.entityId, seed.ownerUserId),
          eq(auditLogs.action, "DELETE"),
        ),
      );
    expect(auditRow).toBeDefined();
    const details = auditRow.details as {
      householdDeleted?: boolean;
      ownerSuccessorUserId?: string | null;
    };
    expect(details.householdDeleted).toBe(false);
    expect(details.ownerSuccessorUserId).toBe(seed.memberUserId);
  });
});

describe("Settings Account Deletion - Multi-Member: concurrent erasure by both members", () => {
  let seed: SeededMultiMember;
  const label = `concurrent-${Date.now()}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    seed = await seedHouseholdWithTwoMembers({
      passwordHash,
      label,
      memberRole: "member",
    });
  });

  afterAll(async () => {
    await cleanupMultiMember(seed);
  });

  // Race-safety proof for the FOR UPDATE lock on the household's member rows.
  // Both erasures lock the same member row-set, so Postgres serializes them;
  // the second transaction re-reads post-commit state and correctly becomes the
  // "last one out". The end-state must be deterministic: household + all shared
  // data gone, both users anonymised, exactly one erasure reporting
  // householdDeleted=true — never a surviving orphan or a half-deleted household.
  it("ends in a single deterministic state when both members erase at once", async () => {
    const ipAddress = "127.0.0.1";
    const results = await Promise.all([
      eraseAccount({
        userId: seed.ownerUserId,
        householdId: seed.householdId,
        userEmail: seed.ownerEmail,
        ipAddress,
      }),
      eraseAccount({
        userId: seed.memberUserId,
        householdId: seed.householdId,
        userEmail: seed.memberEmail,
        ipAddress,
      }),
    ]);

    // Exactly one transaction was the last member out and deleted the household.
    const deletedCount = results.filter((r) => r.householdDeleted).length;
    expect(deletedCount, "exactly one erasure deletes the household").toBe(1);

    // The household and all shared data are gone (no co-member remained).
    const householdRow = await db
      .select()
      .from(households)
      .where(eq(households.id, seed.householdId));
    expect(householdRow.length).toBe(0);

    for (const [table, rows] of Object.entries({
      members: await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, seed.householdId)),
      accounts: await db
        .select()
        .from(accounts)
        .where(eq(accounts.householdId, seed.householdId)),
      transactions: await db
        .select()
        .from(transactions)
        .where(eq(transactions.householdId, seed.householdId)),
      budgets: await db
        .select()
        .from(budgets)
        .where(eq(budgets.householdId, seed.householdId)),
      goals: await db
        .select()
        .from(goals)
        .where(eq(goals.householdId, seed.householdId)),
    })) {
      expect(rows.length, `expected 0 rows left in ${table}`).toBe(0);
    }

    // Both users are anonymised, and each has its own durable erasure audit row.
    for (const userId of [seed.ownerUserId, seed.memberUserId]) {
      const [u] = await db.select().from(users).where(eq(users.id, userId));
      expect(u.email).toContain("@deleted.invalid");
      expect(u.fullName).toBeNull();

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "user_account"),
            eq(auditLogs.entityId, userId),
            eq(auditLogs.action, "DELETE"),
          ),
        );
      expect(auditRows.length, `erasure audit row for ${userId}`).toBe(1);
      expect(auditRows[0].householdId).toBeNull();
    }
  });
});
