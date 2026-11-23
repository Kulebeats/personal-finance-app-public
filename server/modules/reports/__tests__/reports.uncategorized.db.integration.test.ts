/**
 * Reports — uncategorized / merchant-less spending and the annual month key
 * (REAL DB, REAL HTTP).
 *
 * The spending breakdown inner-joined categories, category groups and
 * merchants, so an expense with no category or no merchant vanished from the
 * breakdown items AND its total. Most manual expenses carry no merchant id.
 * The annual report's `monthly[].month` is a display label ("Jan 2026"), so
 * the trends widget had no ISO period to parse ("Invalid Date").
 *
 * Mounts the real report controllers against the real service, repositories
 * and Postgres test database, and drives them over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  households,
  householdMembers,
  users,
  accounts,
  categoryGroups,
  categories,
  merchants,
  transactions,
  fxRates,
} from "@shared/schema";
import {
  createFXRateRepository,
  createFXRateService,
  setGlobalFXService,
} from "../../../core/calculations";
import { reportsSpendingController } from "../reports.spending.controller";
import { reportsAnnualController } from "../reports.annual.controller";

type BreakdownItem = { label: string; value: { amount: string } };

describe("Reports — uncategorized and merchant-less expenses (real DB)", () => {
  const householdId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const groupId = randomUUID();
  const categoryId = randomUUID();
  const merchantId = randomUUID();

  const app = express();
  app.use((req, _res, next) => {
    req.householdContext = { householdId, userId, role: "owner" } as NonNullable<
      typeof req.householdContext
    >;
    next();
  });
  app.get(
    "/api/reports/spending/breakdown",
    reportsSpendingController.getSpendingBreakdown
  );
  app.get("/api/reports/annual", reportsAnnualController.getAnnual);

  beforeAll(async () => {
    // The annual report converts currencies; startup normally wires this.
    setGlobalFXService(
      createFXRateService(createFXRateRepository(db, fxRates), {
        cacheTtlSeconds: 300,
        baseCurrency: "USD",
        fallbackDays: 30,
      })
    );
    await db
      .insert(households)
      .values({ id: householdId, name: "Uncategorized HH", currency: "ZMW" });
    // The annual report's net worth reads the account summary's audience, so
    // the reader must be an actual owner member, as every real session is.
    await db.insert(users).values({ id: userId, email: `uncat-${userId}@example.invalid`,
      username: `uncat-${userId}`, passwordHash: "synthetic-not-a-login", emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
    });
    await db.insert(categoryGroups).values({
      id: groupId,
      householdId,
      name: "Food",
      type: "expenses",
      isArchived: false,
      displayOrder: 0,
    });
    await db.insert(categories).values({
      id: categoryId,
      householdId,
      groupId,
      name: "Groceries",
      icon: "cart",
      color: "#00AA55",
      isArchived: false,
      displayOrder: 0,
    });
    await db
      .insert(merchants)
      .values({ id: merchantId, householdId, name: "Shoprite" });

    const base = {
      householdId,
      accountId,
      ownerUserId: null,
      currency: "ZMW",
      type: "expense" as const,
      isPrivate: false,
      isPending: false,
      isExcludedFromReports: false,
    };
    await db.insert(transactions).values([
      {
        ...base,
        id: randomUUID(),
        name: "Weekly shop",
        amount: "100.00",
        date: "2026-01-10",
        categoryId,
        merchantId,
      },
      {
        ...base,
        id: randomUUID(),
        name: "Cash at the market",
        amount: "42.50",
        date: "2026-01-12",
        categoryId: null,
        merchantId: null,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(categories).where(eq(categories.householdId, householdId));
    await db
      .delete(categoryGroups)
      .where(eq(categoryGroups.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(eq(users.id, userId));
  });

  async function breakdown(groupBy: string) {
    const res = await request(app).get("/api/reports/spending/breakdown").query({
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy,
      includePending: "true",
    });
    expect(res.status).toBe(200);
    return res.body.data as { total: { amount: string }; items: BreakdownItem[] };
  }

  it.each([
    ["categoryGroup", "Uncategorized"],
    ["category", "Uncategorized"],
    ["merchant", "No merchant"],
  ])(
    "groupBy=%s puts the bare expense in a %s bucket and counts it in the total",
    async (groupBy, label) => {
      const data = await breakdown(groupBy);

      const bucket = data.items.find((i) => i.label === label);
      expect(bucket?.value.amount).toBe("42.50");
      expect(data.total.amount).toBe("142.50");
    }
  );

  it("annual monthly rows carry an ISO period start for the trends chart", async () => {
    const res = await request(app)
      .get("/api/reports/annual")
      .query({ year: "2026", includePending: "true" });

    expect(res.status).toBe(200);
    const monthly = res.body.data.monthly as Array<{ periodStart?: string }>;
    expect(monthly).toHaveLength(12);
    expect(monthly[0].periodStart).toBe("2026-01-01");
    expect(monthly[10].periodStart).toBe("2026-11-01");
  });
});
