import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { categories, householdMembers, merchants, transactions } from "@shared/schema";
import { db } from "../../../db";
import { patternDetectionService } from "../../../services/PatternDetectionService";
import { transactionQueryRepository } from "../../../repositories/TransactionQueryRepository";
import type { HouseholdContext } from "../../../middleware/householdGuard";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

type Pattern = {
  name: string;
  type: string;
  estimatedAmount: { amount: string; currency: string };
  frequency: string;
  occurrences: number;
  sampleTransactionIds: string[];
};

function recentMonthlyDates(): string[] {
  const now = new Date();
  return [3, 2, 1].map((monthsBack) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 10))
      .toISOString().slice(0, 10));
}

async function seedSeries(input: {
  name: string;
  householdId?: string;
  accountId: string;
  ownerUserId: string;
  amount: string;
  isPrivate?: boolean;
  merchantId?: string;
  categoryId?: string;
  dates?: string[];
}) {
  const dates = input.dates ?? recentMonthlyDates();
  const seriesIds = dates.map(() => randomUUID());
  await db.insert(transactions).values(seriesIds.map((id, index) => ({
    id,
    householdId: input.householdId ?? a,
    accountId: input.accountId,
    ownerUserId: input.ownerUserId,
    date: dates[index],
    name: input.name,
    amount: input.amount,
    currency: "ZMW", // This fixture explicitly knows denomination; production legacy NULL remains unresolved.
    type: "expense" as const,
    isPrivate: input.isPrivate ?? false,
    merchantId: input.merchantId,
    categoryId: input.categoryId,
  })));
  return seriesIds;
}

function detect(role: Role, body: Record<string, unknown> = {}) {
  return request(app).post("/api/recurring/detect")
    .set("Cookie", actors.get(role)!.cookie).send(body);
}

function named(patterns: Pattern[], name: string): Pattern | undefined {
  return patterns.find((pattern) => pattern.name === name);
}

describe("R04 recurring detection uses the signed actor's transaction audience", () => {
  beforeAll(start, 20_000);
  beforeEach(reset);
  afterAll(stop);

  it("isolates private account and private transaction series while retaining shared patterns", async () => {
    const ownerId = actors.get("owner")!.id;
    const memberId = actors.get("member")!.id;
    const privateAccount = await seedSeries({ name: "VAULT_MARKER_PRIVATE", accountId: ids.privateAccount, ownerUserId: ownerId, amount: "731.47" });
    const privateTransaction = await seedSeries({ name: "MEMBER_MARKER_PRIVATE", accountId: ids.sharedAccount, ownerUserId: memberId, amount: "843.29", isPrivate: true });
    const shared = await seedSeries({ name: "SHARED_MARKET_PATTERN", accountId: ids.sharedAccount, ownerUserId: ownerId, amount: "24.50" });
    await seedSeries({ name: "FOREIGN_MARKER_PRIVATE", householdId: b, accountId: ids.foreignAccount, ownerUserId: actors.get("outsider")!.id, amount: "982.13" });

    const ownerResponse = await detect("owner").expect(200);
    const memberResponse = await detect("member").expect(200);
    const ownerPatterns = ownerResponse.body.data as Pattern[];
    const memberPatterns = memberResponse.body.data as Pattern[];

    expect(named(ownerPatterns, "VAULT_MARKER_PRIVATE")).toMatchObject({
      type: "expense", estimatedAmount: { amount: "731.47", currency: "ZMW" },
      frequency: "monthly", occurrences: 3, sampleTransactionIds: privateAccount,
    });
    expect(named(memberPatterns, "MEMBER_MARKER_PRIVATE")).toMatchObject({
      estimatedAmount: { amount: "843.29", currency: "ZMW" },
      frequency: "monthly", occurrences: 3, sampleTransactionIds: privateTransaction,
    });
    for (const patterns of [ownerPatterns, memberPatterns]) {
      expect(named(patterns, "SHARED_MARKET_PATTERN")).toMatchObject({
        estimatedAmount: { amount: "24.50", currency: "ZMW" },
        frequency: "monthly", occurrences: 3, sampleTransactionIds: shared,
      });
    }
    expect(ownerPatterns).toHaveLength(2);
    expect(memberPatterns).toHaveLength(2);
    for (const secret of ["MEMBER_MARKER_PRIVATE", "843.29", ...privateTransaction, "FOREIGN_MARKER_PRIVATE", "982.13"])
      expect(JSON.stringify(ownerResponse.body)).not.toContain(secret);
    for (const secret of ["VAULT_MARKER_PRIVATE", "731.47", ...privateAccount, "FOREIGN_MARKER_PRIVATE", "982.13"])
      expect(JSON.stringify(memberResponse.body)).not.toContain(secret);
  });

  it("applies visibility before the three-occurrence threshold and checks the live account reference", async () => {
    const ownerId = actors.get("owner")!.id;
    const dates = recentMonthlyDates();
    const visibleIds = await seedSeries({
      name: "MIXED_VISIBILITY_MARKER", accountId: ids.sharedAccount, ownerUserId: ownerId,
      amount: "19.10", dates: dates.slice(0, 2),
    });
    const hiddenId = await seedSeries({
      name: "MIXED_VISIBILITY_MARKER", accountId: ids.sharedAccount, ownerUserId: ownerId,
      // Keep amount variance at zero so confidence cannot mask the visibility oracle.
      amount: "19.10", isPrivate: true, dates: dates.slice(2),
    });
    expect((await detect("member").expect(200)).body.data).toEqual([]);
    const owner = await detect("owner").expect(200);
    expect(named(owner.body.data as Pattern[], "MIXED_VISIBILITY_MARKER")).toMatchObject({
      occurrences: 3, frequency: "monthly", sampleTransactionIds: [...visibleIds, ...hiddenId],
    });

    // A legacy row pointing across households must not be used for an actor's pattern.
    await db.update(transactions).set({ accountId: ids.foreignAccount })
      .where(inArray(transactions.id, [...visibleIds, ...hiddenId]));
    expect((await detect("owner").expect(200)).body.data).toEqual([]);
  });

  it("keeps the route's member-role guard and the trusted household-only default caller", async () => {
    const series = await seedSeries({
      name: "TRUSTED_LEGACY_MARKER", accountId: ids.privateAccount,
      ownerUserId: actors.get("owner")!.id, amount: "543.21",
    });
    for (const role of ["view_only", "professional"] as const)
      await detect(role).expect(403);

    const internalRows = await transactionQueryRepository.findForPatternDetection(a, { lookbackMonths: 6 });
    expect(internalRows.map((row) => row.id)).toEqual(expect.arrayContaining(series));
    const internalPatterns = await patternDetectionService.detectPatterns(a);
    expect(named(internalPatterns as unknown as Pattern[], "TRUSTED_LEGACY_MARKER")).toMatchObject({
      estimatedAmount: 543.21, frequency: "monthly", occurrences: 3,
      sampleTransactionIds: series,
    });
    expect((await detect("member").expect(200)).body.data).toEqual([]);
  });

  it("excludes cross-household merchant and category references before producing an actor's pattern", async () => {
    const ownerUserId = actors.get("owner")!.id;
    const foreignMerchantId = randomUUID(), ownMerchantId = randomUUID();
    const foreignCategoryId = randomUUID(), ownCategoryId = randomUUID();
    await db.insert(merchants).values([
      { id: foreignMerchantId, householdId: b, name: "FOREIGN MERCHANT REFERENCE" },
      { id: ownMerchantId, householdId: a, name: "Owned merchant reference" },
    ]);
    await db.insert(categories).values([
      { id: foreignCategoryId, householdId: b, name: "FOREIGN CATEGORY REFERENCE", displayOrder: 0 },
      { id: ownCategoryId, householdId: a, name: "Owned category reference", displayOrder: 0 },
    ]);
    const foreignMerchant = await seedSeries({
      name: "FOREIGN_MERCHANT_REF_MARKER", accountId: ids.sharedAccount, ownerUserId,
      amount: "614.83", merchantId: foreignMerchantId,
    });
    const foreignCategory = await seedSeries({
      name: "FOREIGN_CATEGORY_REF_MARKER", accountId: ids.sharedAccount, ownerUserId,
      amount: "725.94", categoryId: foreignCategoryId,
    });
    const allowed = await seedSeries({
      name: "OWNED_REFERENCES_PATTERN", accountId: ids.sharedAccount, ownerUserId,
      amount: "36.20", merchantId: ownMerchantId, categoryId: ownCategoryId,
    });

    const response = await detect("member").expect(200);
    expect(response.body.data).toMatchObject([{
      name: "OWNED_REFERENCES_PATTERN", merchantId: ownMerchantId,
      estimatedAmount: { amount: "36.20", currency: "ZMW" },
      occurrences: 3, frequency: "monthly", sampleTransactionIds: allowed,
    }]);
    expect(response.body.data).toHaveLength(1);
    for (const secret of [
      foreignMerchantId, foreignCategoryId, "FOREIGN_MERCHANT_REF_MARKER", "FOREIGN_CATEGORY_REF_MARKER",
      "614.83", "725.94", ...foreignMerchant, ...foreignCategory,
    ]) expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it("rechecks the current detect grant when a previously signed member is downgraded", async () => {
    const memberId = actors.get("member")!.id;
    const actor: HouseholdContext = { householdId: a, userId: memberId, role: "member" };
    await seedSeries({
      name: "STALE_MEMBER_GRANT_MARKER", accountId: ids.sharedAccount,
      ownerUserId: memberId, amount: "47.30",
    });
    expect((await patternDetectionService.detectPatterns(a, {}, actor)).map((pattern) => pattern.name))
      .toContain("STALE_MEMBER_GRANT_MARKER");
    expect(await patternDetectionService.detectPatterns(a, {}, { ...actor, role: "view_only" })).toEqual([]);

    // Direct service call deliberately holds the old signed context after a
    // committed membership change; the route itself must reject the new role.
    await db.update(householdMembers).set({ role: "view_only" }).where(and(
      eq(householdMembers.householdId, a), eq(householdMembers.userId, memberId),
    ));
    expect(await patternDetectionService.detectPatterns(a, {}, actor)).toEqual([]);
    await detect("member").expect(403);
  });
});
