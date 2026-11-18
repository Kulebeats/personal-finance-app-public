import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import recurringRouter from "../recurring.routes";
import { recurringService } from "../recurring.service";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { db } from "../../../db";
import { sql } from "drizzle-orm";
import {
  users,
  households,
  accounts,
  transactions,
  recurringTransactions,
} from "../../../../shared/schema";

describe("Recurring Concurrency Tests", () => {
  let user: any;
  let userId: string;
  let householdId: string;
  let accountId: string;
  let app: express.Application;

  beforeEach(async () => {
    // Setup test data
    await db.execute(
      sql`TRUNCATE TABLE users, households, accounts, transactions, recurring_transactions, recurring_transaction_links CASCADE`,
    );

    // Create User
    const [createdUser] = await db
      .insert(users)
      .values({
        username: `test-concurrency-user-${Date.now()}`,
        passwordHash: "hashed_password",
        displayName: "Test User",
        email: `test-${Date.now()}@example.com`,
      })
      .returning();
    user = createdUser;
    userId = user.id;

    // Create Household
    const [household] = await db
      .insert(households)
      .values({
        name: "Test Household",
        currency: "ZMW",
      })
      .returning();
    householdId = household.id;

    // Create Account
    const [account] = await db
      .insert(accounts)
      .values({
        householdId,
        name: "Test Account",
        type: "checking",
        balance: "1000.00",
        currency: "ZMW",
      })
      .returning();
    accountId = account.id;

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

    // We expect exactly 1 success and 4 failures (errors)
    // IMPORTANT: Without FOR UPDATE, this might FAIL (showing > 1 links) or might pass by luck.
    // The goal of this test is to verify the fix ensures strict 1 success.

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
});
