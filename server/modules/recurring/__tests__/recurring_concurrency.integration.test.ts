import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import recurringRouter from "../recurring.routes";
import { recurringService } from "../recurring.service";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  users,
  households,
  accounts,
  transactions,
  recurringTransactions,
  categoryGroups,
  categories,
  tags,
  recurringTransactionLinks,
  recurringTransactionHistory,
} from "../../../../shared/schema";

describe("Recurring Concurrency Tests", () => {
  let user: any;
  let userId: string;
  let householdId: string;
  let accountId: string;
  let app: express.Application;
  type OwnedFixture = { userId: string; householdId: string; accountId: string; groupId: string; categoryId: string; tagId: string };
  const owned = new Set<OwnedFixture>();
  let current: OwnedFixture;

  async function cleanupFixture(fixture: OwnedFixture) {
    // Household FKs cascade only through this UUID's owned financial/label rows.
    // User cleanup follows those references and never relies on display names.
    await db.transaction(async tx => {
      await tx.delete(households).where(eq(households.id, fixture.householdId));
      await tx.delete(users).where(eq(users.id, fixture.userId));
    });
  }
  async function cleanupOwned() {
    for (const fixture of Array.from(owned)) {
      await cleanupFixture(fixture);
      owned.delete(fixture);
    }
  }
  async function seedFixture(label: string) {
    const fixture = { userId: randomUUID(), householdId: randomUUID(), accountId: randomUUID(),
      groupId: randomUUID(), categoryId: randomUUID(), tagId: randomUUID() };
    owned.add(fixture); // Register before the first insert so partial setup is owned too.
    const [createdUser] = await db.insert(users).values({ id: fixture.userId,
      username: `test-concurrency-user-${fixture.userId}`, passwordHash: "hashed_password",
      displayName: "Test User", email: `test-${fixture.userId}@example.com` }).returning();
    await db.insert(households).values({ id: fixture.householdId, name: `Concurrency ${label}`, currency: "ZMW" });
    await db.insert(accounts).values({ id: fixture.accountId, householdId: fixture.householdId,
      name: `Concurrency ${label} account`, type: "checking", balance: "1000.00", currency: "ZMW" });
    await db.insert(categoryGroups).values({ id: fixture.groupId, householdId: fixture.householdId,
      name: `Concurrency ${label} group`, type: "expenses", displayOrder: 0 });
    await db.insert(categories).values({ id: fixture.categoryId, householdId: fixture.householdId,
      groupId: fixture.groupId, name: `Concurrency ${label} category`, displayOrder: 0 });
    await db.insert(tags).values({ id: fixture.tagId, householdId: fixture.householdId,
      name: `Concurrency ${label} label`, memberId: fixture.userId });
    return { fixture, user: createdUser };
  }
  async function fixtureState(fixture: OwnedFixture) {
    return {
      user: await db.select().from(users).where(eq(users.id, fixture.userId)),
      household: await db.select().from(households).where(eq(households.id, fixture.householdId)),
      account: await db.select().from(accounts).where(eq(accounts.id, fixture.accountId)),
      group: await db.select().from(categoryGroups).where(eq(categoryGroups.id, fixture.groupId)),
      category: await db.select().from(categories).where(eq(categories.id, fixture.categoryId)),
      label: await db.select().from(tags).where(eq(tags.id, fixture.tagId)),
      rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, fixture.householdId)),
      sources: await db.select().from(transactions).where(eq(transactions.householdId, fixture.householdId)),
    };
  }
  afterEach(cleanupOwned);
  afterAll(cleanupOwned);

  beforeEach(async () => {
    const created = await seedFixture("primary");
    current = created.fixture;
    user = created.user;
    userId = current.userId;
    householdId = current.householdId;
    accountId = current.accountId;

    // Setup app
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = user;
      req.householdId = householdId;
      next();
    });
    app.use("/recurring", recurringRouter);
  });

  it("should prevent duplicate links when requests are concurrent", async () => {
    // 1. Create a recurring rule
    const [rule] = await db
      .insert(recurringTransactions)
      .values({
        householdId,
        accountId,
        name: "Concurrent Test Rule",
        amount: "100.00",
        type: "expense",
        frequency: "monthly",
        startDate: "2024-01-01",
        nextDueDate: "2024-02-01",
        isActive: true,
        lastOccurredDate: null,
        merchantId: null,
        categoryId: null,
      })
      .returning();

    // 2. Create a transaction
    const [transaction] = await db
      .insert(transactions)
      .values({
        householdId,
        accountId,
        amount: "100.00",
        date: "2024-02-01",
        name: "Concurrent Test Transaction",
        type: "expense",
        ownerUserId: userId,
        currency: "ZMW",
        isPending: false,
        isRecurring: false,
        recurringTransactionId: null,
      })
      .returning();

    // 3. Launch multiple concurrent link requests
    // We use Promise.all to fire them as close as possible
    const linkRequest = () =>
      recurringService.linkTransaction(
        rule.id,
        transaction.id,
        householdId,
        userId,
        "manual",
      );

    const results = await Promise.allSettled([
      linkRequest(),
      linkRequest(),
      linkRequest(),
      linkRequest(),
      linkRequest(),
    ]);

    // 4. Verify results
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Verify only 1 link exists in DB
    const links = await recurringRepository.findLinksByRecurring(
      rule.id,
      householdId,
    );

    // Log failures if any for debugging
    if (rejected.length > 4) {
      console.log(
        "Rejected reasons:",
        rejected.map((r: any) => r.reason),
      );
    }

    expect(links.length).toBe(1);
    // Because the service is idempotent, all requests should succeed (return the same link)
    expect(fulfilled.length).toBe(5);
    expect(rejected.length).toBe(0);
  });

  it("cleans an interrupted owned fixture without touching another fixture's account, category or label", async () => {
    const other = (await seedFixture("sentinel")).fixture;
    const before = await fixtureState(other);
    const [rule] = await db.insert(recurringTransactions).values({ householdId, accountId,
      name: "Interrupted fixture rule", amount: "1.00", type: "expense", frequency: "monthly",
      startDate: "2024-01-01", nextDueDate: "2024-02-01" }).returning();
    const [transaction] = await db.insert(transactions).values({ householdId, accountId, ownerUserId: userId,
      name: "Interrupted fixture transaction", amount: "1.00", type: "expense", date: "2024-01-01", currency: "ZMW" }).returning();
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: rule.id, transactionId: transaction.id });
    await db.insert(recurringTransactionHistory).values({ recurringTransactionId: rule.id, action: "linked", linkedTransactionId: transaction.id });
    await expect((async () => {
      try { throw new Error("Synthetic interrupted test body"); }
      finally { await cleanupFixture(current); }
    })()).rejects.toThrow("Synthetic interrupted test body");
    const state = await fixtureState(current);
    expect(Object.values(state).every(rows => rows.length === 0)).toBe(true);
    expect(await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, rule.id))).toHaveLength(0);
    expect(await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, rule.id))).toHaveLength(0);
    expect(await fixtureState(other)).toEqual(before);
  });
});
