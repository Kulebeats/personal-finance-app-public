import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  accounts, categories, householdMembers, merchants, recurringTransactionHistory,
  recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { Money } from "../../../core/money";
import { db } from "../../../db";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { recurringService } from "../../../services/RecurringService";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";
import { proveZmwDenomination } from "./recurring-proven-zmw.fixture";
import { DENOMINATION_ACTION } from "../../../services/recurring/RecurringDenomination";

const ruleIds = {
  expense: randomUUID(), income: randomUUID(), hidden: randomUUID(), linked: randomUUID(),
  localHistory: randomUUID(), overdue: randomUUID(), day14: randomUUID(), day15: randomUUID(),
  day365: randomUUID(), day366: randomUUID(), expired: randomUUID(),
  inactive: randomUUID(), paused: randomUUID(), privateAccount: randomUUID(),
  privateAccountSource: randomUUID(), privateTransactionSource: randomUUID(),
  historicalPrivate: randomUUID(), historicalAccount: randomUUID(),
  foreignAccount: randomUUID(), foreignSource: randomUUID(), foreignCategory: randomUUID(),
  foreignMerchant: randomUUID(), deletedAccount: randomUUID(), deletedSource: randomUUID(),
  deletedCategory: randomUUID(), historicalCategory: randomUUID(), historicalMerchant: randomUUID(),
  historicalDeletedCategory: randomUUID(), malformedHistory: randomUUID(), orphanHistory: randomUUID(),
  suggested: randomUUID(), unknownOrigin: randomUUID(), nullOrigin: randomUUID(), foreign: randomUUID(),
  deletedOrigin: randomUUID(),
};
const extra = {
  hiddenAccount: randomUUID(), deletedAccount: randomUUID(), privateTransaction: randomUUID(),
  deletedTransaction: randomUUID(), localCategory: randomUUID(), foreignCategory: randomUUID(),
  deletedCategory: randomUUID(), localMerchant: randomUUID(), foreignMerchant: randomUUID(),
  deletedOriginTransaction: randomUUID(),
};
const allRules = Object.values(ruleIds);
const visibleRules = [
  ruleIds.expense, ruleIds.income, ruleIds.hidden, ruleIds.linked, ruleIds.localHistory,
  ruleIds.overdue, ruleIds.day14, ruleIds.day15, ruleIds.day365, ruleIds.day366, ruleIds.expired, ruleIds.deletedSource,
];
const ownerOnlyRules = [ruleIds.privateAccount, ruleIds.privateAccountSource,
  ruleIds.privateTransactionSource, ruleIds.historicalPrivate, ruleIds.historicalAccount];
const upcoming7 = [
  ruleIds.overdue, ruleIds.expense, ruleIds.income, ruleIds.hidden, ruleIds.linked, ruleIds.localHistory, ruleIds.deletedSource,
];
type Viewer = Role | "outsider";

function day(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
function rule(id: string, accountId: string, name: string, amount = "901.23", offset = 1) {
  return { id, householdId: a, accountId, name, amount, type: "expense" as const,
    frequency: "monthly" as const, startDate: day(-30), nextDueDate: day(offset) };
}
function upcoming(viewer: Viewer, query = "?days=7") {
  return request(app).get(`/api/recurring/upcoming${query}`).set("Cookie", actors.get(viewer)!.cookie);
}
function summary(viewer: Viewer) {
  return request(app).get("/api/recurring/summary").set("Cookie", actors.get(viewer)!.cookie);
}
function responseIds(response: { body: { data: { id: string }[] } }) {
  return response.body.data.map(item => item.id);
}
const sharedSummary = {
  totalMonthlyIncome: { amount: "500.00", currency: "ZMW" },
  totalMonthlyExpenses: { amount: "845.62", currency: "ZMW" },
  activeCount: 12, subscriptionCount: 2, upcomingCount: 7, currency: "ZMW", excludedCount: 0, complete: true,
};
const emptySummary = {
  totalMonthlyIncome: { amount: "0.00", currency: "ZMW" },
  totalMonthlyExpenses: { amount: "0.00", currency: "ZMW" },
  activeCount: 0, subscriptionCount: 0, upcomingCount: 0, currency: "ZMW", excludedCount: 0, complete: true,
};
async function clearOwnRows() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, allRules));
  await db.delete(transactions).where(inArray(transactions.id, [extra.privateTransaction, extra.deletedTransaction, extra.deletedOriginTransaction]));
  await db.delete(accounts).where(inArray(accounts.id, [extra.hiddenAccount, extra.deletedAccount]));
  await db.delete(categories).where(inArray(categories.id, [extra.localCategory, extra.foreignCategory, extra.deletedCategory]));
  await db.delete(merchants).where(inArray(merchants.id, [extra.localMerchant, extra.foreignMerchant]));
}

describe("R04 ordinary upcoming and summary use the signed recurring audience", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    // A transaction owner cannot override the containing private account's owner.
    await db.update(transactions).set({ ownerUserId: actors.get("member")!.id })
      .where(eq(transactions.id, ids.privateTx));
    await db.insert(accounts).values([
      { id: extra.hiddenAccount, householdId: a, name: "DISPLAY_HIDDEN", type: "checking", currency: "ZMW", isHidden: true },
      { id: extra.deletedAccount, householdId: a, name: "SECRET_DELETED_ACCOUNT", type: "checking", currency: "ZMW", deletedAt: new Date() },
    ]);
    await db.insert(categories).values([
      { id: extra.localCategory, householdId: a, name: "LOCAL_CATEGORY", displayOrder: 1 },
      { id: extra.foreignCategory, householdId: b, name: "SECRET_FOREIGN_CATEGORY", displayOrder: 1 },
      { id: extra.deletedCategory, householdId: a, name: "SECRET_DELETED_CATEGORY", displayOrder: 1, deletedAt: new Date() },
    ]);
    await db.insert(merchants).values([
      { id: extra.localMerchant, householdId: a, name: "LOCAL_MERCHANT" },
      { id: extra.foreignMerchant, householdId: b, name: "SECRET_FOREIGN_MERCHANT" },
    ]);
    await db.insert(transactions).values([
      { id: extra.privateTransaction, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
        date: day(-5), name: "SECRET_PRIVATE_TRANSACTION", amount: "555.55", type: "expense", isPrivate: true },
      { id: extra.deletedTransaction, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
        date: day(-5), name: "SECRET_DELETED_TRANSACTION", amount: "901.23", type: "expense", isPrivate: false, deletedAt: new Date() },
    ]);
    await db.insert(recurringTransactions).values([
      { ...rule(ruleIds.expense, ids.sharedAccount, "SHARED_EXPENSE", "11.11"), categoryId: extra.localCategory, merchantId: extra.localMerchant, isSubscription: true },
      { ...rule(ruleIds.income, ids.sharedAccount, "SHARED_INCOME", "500.00", 2), type: "income" },
      rule(ruleIds.hidden, extra.hiddenAccount, "DISPLAY_HIDDEN_RULE", "22.22", 3),
      rule(ruleIds.linked, ids.sharedAccount, "SHARED_LINKED_RULE", "33.33", 4),
      rule(ruleIds.localHistory, ids.sharedAccount, "LOCAL_HISTORY_RULE", "44.44", 5),
      rule(ruleIds.overdue, ids.sharedAccount, "SHARED_OVERDUE", "55.55", -2),
      rule(ruleIds.day14, ids.sharedAccount, "SHARED_DAY14", "66.66", 14),
      rule(ruleIds.day15, ids.sharedAccount, "SHARED_DAY15", "77.77", 15),
      { ...rule(ruleIds.day365, ids.sharedAccount, "SHARED_DAY365", "88.88", 365), isSubscription: true },
      rule(ruleIds.day366, ids.sharedAccount, "SHARED_DAY366", "99.99", 366),
      { ...rule(ruleIds.expired, ids.sharedAccount, "EXPIRED_ACTIVE", "333.33", -3), endDate: day(-1) },
      { ...rule(ruleIds.inactive, ids.sharedAccount, "INACTIVE_RULE", "111.11", 0), isActive: false, isSubscription: true },
      { ...rule(ruleIds.paused, ids.sharedAccount, "PAUSED_RULE", "222.22", 0), isPaused: true, isSubscription: true },
      { ...rule(ruleIds.privateAccount, ids.privateAccount, "SECRET_PRIVATE_ACCOUNT", "777.77"), isSubscription: true },
      { ...rule(ruleIds.privateAccountSource, ids.sharedAccount, "SECRET_PRIVATE_ACCOUNT_SOURCE", "666.66"), isSubscription: true },
      { ...rule(ruleIds.privateTransactionSource, ids.sharedAccount, "SECRET_PRIVATE_TRANSACTION_SOURCE", "555.55"), isSubscription: true },
      { ...rule(ruleIds.historicalPrivate, ids.sharedAccount, "SECRET_UNLINKED_PRIVATE", "444.44"), isSubscription: true },
      { ...rule(ruleIds.historicalAccount, ids.sharedAccount, "SECRET_PAST_PRIVATE_ACCOUNT", "333.33"), isSubscription: true },
      rule(ruleIds.foreignAccount, ids.foreignAccount, "SECRET_FOREIGN_ACCOUNT"),
      rule(ruleIds.foreignSource, ids.sharedAccount, "SECRET_FOREIGN_SOURCE"),
      { ...rule(ruleIds.foreignCategory, ids.sharedAccount, "SECRET_FOREIGN_CATEGORY"), categoryId: extra.foreignCategory },
      { ...rule(ruleIds.foreignMerchant, ids.sharedAccount, "SECRET_FOREIGN_MERCHANT"), merchantId: extra.foreignMerchant },
      rule(ruleIds.deletedAccount, extra.deletedAccount, "SECRET_DELETED_ACCOUNT"),
      // A previously linked, retained shared payment preserves the audience of
      // this independent rule definition. Its actual amount is still private to the ledger.
      rule(ruleIds.deletedSource, ids.sharedAccount, "SHARED_RETAINED_PAYMENT_RULE", "12.34", 6),
      { ...rule(ruleIds.deletedCategory, ids.sharedAccount, "SECRET_DELETED_CATEGORY"), categoryId: extra.deletedCategory },
      rule(ruleIds.historicalCategory, ids.sharedAccount, "SECRET_PAST_FOREIGN_CATEGORY"),
      rule(ruleIds.historicalMerchant, ids.sharedAccount, "SECRET_PAST_FOREIGN_MERCHANT"),
      rule(ruleIds.historicalDeletedCategory, ids.sharedAccount, "SECRET_PAST_DELETED_CATEGORY"),
      rule(ruleIds.malformedHistory, ids.sharedAccount, "SECRET_MALFORMED_HISTORY"),
      rule(ruleIds.orphanHistory, ids.sharedAccount, "SECRET_ORPHAN_HISTORY"),
      { ...rule(ruleIds.suggested, ids.sharedAccount, "SECRET_SUGGESTED_ORIGIN"), detectionMethod: "suggested" },
      { ...rule(ruleIds.unknownOrigin, ids.sharedAccount, "SECRET_UNKNOWN_ORIGIN"), detectionMethod: "unknown" },
      { ...rule(ruleIds.nullOrigin, ids.sharedAccount, "SECRET_NULL_ORIGIN"), detectionMethod: null },
      { ...rule(ruleIds.foreign, ids.foreignAccount, "FOREIGN_HOUSEHOLD", "201.00"), householdId: b },
    ]);
    await proveZmwDenomination(allRules);
    await db.insert(recurringTransactionLinks).values([
      { recurringTransactionId: ruleIds.linked, transactionId: ids.sharedTx },
      { recurringTransactionId: ruleIds.privateAccountSource, transactionId: ids.privateTx },
      { recurringTransactionId: ruleIds.privateTransactionSource, transactionId: extra.privateTransaction },
      { recurringTransactionId: ruleIds.foreignSource, transactionId: ids.foreignTx },
      { recurringTransactionId: ruleIds.deletedSource, transactionId: extra.deletedTransaction },
    ]);
    await db.insert(recurringTransactionHistory).values([
      { recurringTransactionId: ruleIds.localHistory, action: "updated",
        previousState: { accountId: ids.sharedAccount, categoryId: extra.localCategory, merchantId: extra.localMerchant },
        newState: { accountId: ids.sharedAccount, categoryId: null, merchantId: null } },
      { recurringTransactionId: ruleIds.historicalPrivate, action: "unlinked", linkedTransactionId: ids.privateTx },
      { recurringTransactionId: ruleIds.historicalAccount, action: "updated", previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount } },
      { recurringTransactionId: ruleIds.historicalCategory, action: "updated", previousState: { categoryId: extra.foreignCategory } },
      { recurringTransactionId: ruleIds.historicalMerchant, action: "updated", newState: { merchantId: extra.foreignMerchant } },
      { recurringTransactionId: ruleIds.historicalDeletedCategory, action: "updated", previousState: { categoryId: extra.deletedCategory } },
      { recurringTransactionId: ruleIds.malformedHistory, action: "updated", previousState: { accountId: "not-a-uuid" } },
      { recurringTransactionId: ruleIds.orphanHistory, action: "processed", linkedTransactionId: null },
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clearOwnRows(); });
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("%s receives visible upcoming DTOs and audience-only summary totals", async viewer => {
    const response = await upcoming(viewer).expect(200);
    expect(responseIds(response)).toEqual(upcoming7);
    expect(response.body.data[1]).toMatchObject({
      id: ruleIds.expense, name: "SHARED_EXPENSE", accountId: ids.sharedAccount,
      categoryId: extra.localCategory, merchantId: extra.localMerchant,
      amount: { amount: "11.11", currency: "ZMW" },
    });
    expect(response.body.data[3]).toMatchObject({ id: ruleIds.hidden, accountId: extra.hiddenAccount });
    expect(response.body.data[6]).toMatchObject({ id: ruleIds.deletedSource, amount: { amount: "12.34", currency: "ZMW" } });
    const totals = await summary(viewer).expect(200);
    expect(totals.body).toEqual({ success: true, data: sharedSummary });
    for (const body of [response.body, totals.body]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("SECRET_");
      for (const secret of [ids.privateAccount, ids.privateTx, extra.privateTransaction, ids.foreignAccount,
        ids.foreignTx, extra.foreignCategory, extra.foreignMerchant, "777.77", "666.66", "555.55", "444.44", "901.23"])
        expect(serialized).not.toContain(secret);
    }
  });

  it("includes the owner's private rules and retains shared rules with soft-deleted payments", async () => {
    const response = await upcoming("owner").expect(200);
    expect(responseIds(response)).toHaveLength(12);
    expect(responseIds(response)).toEqual(expect.arrayContaining([...upcoming7, ...ownerOnlyRules]));
    expect(response.body.data.find((item: { id: string }) => item.id === ruleIds.privateAccount))
      .toMatchObject({ accountId: ids.privateAccount, amount: { amount: "777.77", currency: "ZMW" } });
    const totals = await summary("owner").expect(200);
    expect(totals.body.data).toEqual({
      totalMonthlyIncome: { amount: "500.00", currency: "ZMW" },
      totalMonthlyExpenses: { amount: "3623.37", currency: "ZMW" },
      activeCount: 17, subscriptionCount: 7, upcomingCount: 12, currency: "ZMW", excludedCount: 0, complete: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/SECRET_(FOREIGN|DELETED|PAST_FOREIGN|PAST_DELETED|MALFORMED|ORPHAN|SUGGESTED|UNKNOWN|NULL)/);
  });

  it("isolates an outsider's household in both projections", async () => {
    const response = await upcoming("outsider").expect(200);
    expect(responseIds(response)).toEqual([ruleIds.foreign]);
    const totals = await summary("outsider").expect(200);
    expect(totals.body.data).toEqual({
      totalMonthlyIncome: { amount: "0.00", currency: "ZMW" },
      totalMonthlyExpenses: { amount: "201.00", currency: "ZMW" },
      activeCount: 1, subscriptionCount: 0, upcomingCount: 1, currency: "ZMW", excludedCount: 0, complete: true,
    });
    expect(JSON.stringify([response.body, totals.body])).not.toContain(ruleIds.expense);
  });

  it.each(["", "?days=bad", "?days=0", "?days=-1"])("retains the default fourteen-day window for %s", async query => {
    const response = await upcoming("member", query).expect(200);
    expect(responseIds(response)).toEqual([...upcoming7, ruleIds.day14]);
  });

  it("caps the requested window at365 and keeps status and expired-date filtering", async () => {
    const response = await upcoming("member", "?days=1000&includeInactive=true&includePaused=true").expect(200);
    expect(responseIds(response)).toEqual([...upcoming7, ruleIds.day14, ruleIds.day15, ruleIds.day365]);
    for (const id of [ruleIds.day366, ruleIds.expired, ruleIds.paused, ruleIds.inactive])
      expect(responseIds(response)).not.toContain(id);
    // Preserve the existing summary definition: active expired rules contribute
    // to monthly totals, while the upcoming count excludes an expired end date.
    expect((await summary("member").expect(200)).body.data).toEqual(sharedSummary);
  });

  it("returns empty lists and zero totals when only inaccessible rules remain active", async () => {
    await db.update(recurringTransactions).set({ isActive: false }).where(inArray(recurringTransactions.id, visibleRules));
    expect(responseIds(await upcoming("member").expect(200))).toEqual([]);
    expect((await summary("member").expect(200)).body.data).toEqual(emptySummary);
    expect(responseIds(await upcoming("owner").expect(200))).toEqual(expect.arrayContaining(ownerOnlyRules));
  });

  it("withholds the rule once a hard-deleted source leaves only a nullable history marker", async () => {
    const before = (await summary("member").expect(200)).body.data as typeof sharedSummary;
    const amount = "17.17";
    await db.insert(transactions).values({ id: extra.deletedOriginTransaction, householdId: a, accountId: ids.sharedAccount,
      ownerUserId: actors.get("owner")!.id, date: day(-5), name: "SOURCE_BEFORE_DELETE", amount, type: "expense" });
    await db.insert(recurringTransactions).values(rule(ruleIds.deletedOrigin, ids.sharedAccount, "SOURCE_DEPENDENT_RULE", amount));
    await proveZmwDenomination([ruleIds.deletedOrigin]);
    await db.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleIds.deletedOrigin,
      action: "linked", linkedTransactionId: extra.deletedOriginTransaction });
    expect(responseIds(await upcoming("member").expect(200))).toContain(ruleIds.deletedOrigin);
    const totalWithSource = Money.from(before.totalMonthlyExpenses.amount, "ZMW").add(amount).toString();
    expect((await summary("member").expect(200)).body.data).toEqual({
      ...before,
      totalMonthlyExpenses: { amount: totalWithSource, currency: "ZMW" },
      activeCount: before.activeCount + 1,
      upcomingCount: before.upcomingCount + 1,
    });
    await db.delete(transactions).where(eq(transactions.id, extra.deletedOriginTransaction));
    // The fixture's denomination receipt is not a source marker.
    const history = (await db.select().from(recurringTransactionHistory)
      .where(eq(recurringTransactionHistory.recurringTransactionId, ruleIds.deletedOrigin)))
      .filter(row => row.action !== DENOMINATION_ACTION);
    expect(history).toHaveLength(1);
    expect(history[0].linkedTransactionId).toBeNull();
    expect(responseIds(await upcoming("member").expect(200))).not.toContain(ruleIds.deletedOrigin);
    expect((await summary("member").expect(200)).body.data).toEqual(before);
    expect(responseIds(await upcoming("owner").expect(200))).not.toContain(ruleIds.deletedOrigin);
  });

  it("denies an unknown role at the repository seam without writing an invalid database enum", async () => {
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementation(async (...args) =>
      ({ ...await original(...args), role: "operator" }) as never);
    await upcoming("member").expect(403);
    await summary("member").expect(403);
  });

  it.each(["upcoming", "summary"] as const)("rechecks membership in the %s query after a guard observed the old grant", async route => {
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementationOnce(async (...args) => {
      const membership = await original(...args);
      await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
      return membership;
    });
    const response = await (route === "upcoming" ? upcoming("member") : summary("member")).expect(200);
    expect(response.body.data).toEqual(route === "upcoming" ? [] : emptySummary);
  });

  it("retains the actual household-only upcoming service used by weekly recap", async () => {
    const internal = await recurringService.getUpcomingBills(a, 7);
    expect(internal.map(item => item.id)).toEqual(expect.arrayContaining(ownerOnlyRules));
    expect(internal.find(item => item.id === ruleIds.privateAccount)?.amount).toBe("777.77");
    expect(internal.map(item => item.id)).not.toContain(ruleIds.foreign);
    expect(internal.map(item => item.id)).not.toContain(ruleIds.expired);
  });
});
