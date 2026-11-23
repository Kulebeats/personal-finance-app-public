import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { accounts, categories, merchants, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { a, actors, app, b, ids, reset, roles, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleIds = {
  shared: randomUUID(), privateAccount: randomUUID(), privateTransaction: randomUUID(),
  historicalAccount: randomUUID(), historicalCategory: randomUUID(), historicalMerchant: randomUUID(),
  hiddenAccount: randomUUID(), foreign: randomUUID(), empty: randomUUID(),
};
const extra = {
  privateTransaction: randomUUID(), hiddenAccount: randomUUID(),
  foreignCategory: randomUUID(), foreignMerchant: randomUUID(),
  localCategory: randomUUID(), localMerchant: randomUUID(), deletedCategory: randomUUID(),
};
const allRules = Object.values(ruleIds);
type Viewer = Role | "outsider";

function history(ruleId: string, viewer: Viewer, query = "") {
  return request(app).get(`/api/recurring/${ruleId}/history${query}`)
    .set("Cookie", actors.get(viewer)!.cookie);
}
function links(ruleId: string, viewer: Viewer) {
  return request(app).get(`/api/recurring/${ruleId}/transactions`)
    .set("Cookie", actors.get(viewer)!.cookie);
}
function rule(id: string, householdId: string, accountId: string, name: string) {
  return { id, householdId, accountId, name, amount: "21.00", type: "expense" as const,
    frequency: "monthly" as const, startDate: "2026-10-01", nextDueDate: "2026-12-01" };
}
async function clearOwnRows() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, allRules));
  await db.delete(transactions).where(inArray(transactions.id, [extra.privateTransaction]));
  await db.delete(accounts).where(inArray(accounts.id, [extra.hiddenAccount]));
  await db.delete(categories).where(inArray(categories.id, [extra.foreignCategory, extra.localCategory, extra.deletedCategory]));
  await db.delete(merchants).where(inArray(merchants.id, [extra.foreignMerchant, extra.localMerchant]));
}

describe("R04 recurring history and linked reads use the signed rule audience", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    await db.insert(accounts).values({ id: extra.hiddenAccount, householdId: a, name: "DISPLAY_HIDDEN_ACCOUNT", type: "checking", currency: "ZMW", isHidden: true });
    await db.insert(categories).values([
      { id: extra.foreignCategory, householdId: b, name: "FOREIGN_PAST_CATEGORY", displayOrder: 1 },
      { id: extra.localCategory, householdId: a, name: "LOCAL_PAST_CATEGORY", displayOrder: 1 },
      { id: extra.deletedCategory, householdId: a, name: "DELETED_PAST_CATEGORY", displayOrder: 1, deletedAt: new Date() },
    ]);
    await db.insert(merchants).values([
      { id: extra.foreignMerchant, householdId: b, name: "FOREIGN_PAST_MERCHANT" },
      { id: extra.localMerchant, householdId: a, name: "LOCAL_PAST_MERCHANT" },
    ]);
    await db.insert(transactions).values({
      id: extra.privateTransaction, householdId: a, accountId: ids.sharedAccount,
      ownerUserId: actors.get("owner")!.id, date: "2026-10-08", name: "PRIVATE_TRANSACTION_SOURCE",
      amount: "731.47", type: "expense", isPrivate: true,
    });
    await db.insert(recurringTransactions).values([
      rule(ruleIds.shared, a, ids.sharedAccount, "VISIBLE_MANUAL_RULE"),
      rule(ruleIds.privateAccount, a, ids.privateAccount, "PRIVATE_ACCOUNT_RULE"),
      rule(ruleIds.privateTransaction, a, ids.sharedAccount, "PRIVATE_TRANSACTION_RULE"),
      rule(ruleIds.historicalAccount, a, ids.sharedAccount, "HISTORICAL_PRIVATE_ACCOUNT_RULE"),
      rule(ruleIds.historicalCategory, a, ids.sharedAccount, "HISTORICAL_FOREIGN_CATEGORY_RULE"),
      rule(ruleIds.historicalMerchant, a, ids.sharedAccount, "HISTORICAL_FOREIGN_MERCHANT_RULE"),
      rule(ruleIds.hiddenAccount, a, extra.hiddenAccount, "DISPLAY_HIDDEN_RULE"),
      rule(ruleIds.empty, a, ids.sharedAccount, "EMPTY_MANUAL_RULE"),
      rule(ruleIds.foreign, b, ids.foreignAccount, "FOREIGN_RULE"),
    ]);
    await db.insert(recurringTransactionLinks).values([
      { recurringTransactionId: ruleIds.shared, transactionId: ids.sharedTx, actualAmount: "11.11" },
      { recurringTransactionId: ruleIds.privateAccount, transactionId: ids.privateTx, actualAmount: "777.77" },
      { recurringTransactionId: ruleIds.privateTransaction, transactionId: extra.privateTransaction, actualAmount: "731.47" },
      { recurringTransactionId: ruleIds.hiddenAccount, transactionId: ids.sharedTx },
    ]);
    await db.insert(recurringTransactionHistory).values([
      { recurringTransactionId: ruleIds.shared, action: "created", newState: { accountId: ids.sharedAccount, name: "VISIBLE_MANUAL_RULE" }, createdAt: new Date("2026-10-01T00:00:00Z") },
      { recurringTransactionId: ruleIds.shared, action: "linked", linkedTransactionId: ids.sharedTx, newState: { matchMethod: "manual" }, createdAt: new Date("2026-10-02T00:00:00Z") },
      { recurringTransactionId: ruleIds.privateAccount, action: "linked", linkedTransactionId: ids.privateTx, newState: { amount: "777.77" } },
      { recurringTransactionId: ruleIds.privateTransaction, action: "linked", linkedTransactionId: extra.privateTransaction, newState: { amount: "731.47" } },
      { recurringTransactionId: ruleIds.historicalAccount, action: "updated", previousState: { accountId: ids.privateAccount, amount: "888.88" }, newState: { accountId: ids.sharedAccount } },
      { recurringTransactionId: ruleIds.historicalCategory, action: "updated", previousState: { categoryId: extra.foreignCategory, amount: "611.11" } },
      { recurringTransactionId: ruleIds.historicalMerchant, action: "updated", newState: { merchantId: extra.foreignMerchant, amount: "622.22" } },
      { recurringTransactionId: ruleIds.hiddenAccount, action: "created", newState: { accountId: extra.hiddenAccount } },
      { recurringTransactionId: ruleIds.foreign, action: "created", newState: { accountId: ids.foreignAccount, name: "FOREIGN_RULE" } },
    ]);
  });
  afterEach(clearOwnRows);
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it.each(roles)("%s reads a shared manual rule's allowed history and linked transaction", async viewer => {
    const historyResponse = await history(ruleIds.shared, viewer).expect(200);
    expect(historyResponse.body.data).toMatchObject([
      { action: "linked", linkedTransactionId: ids.sharedTx },
      { action: "created", newState: { accountId: ids.sharedAccount } },
    ]);
    expect(historyResponse.body.data).toHaveLength(2);
    const linksResponse = await links(ruleIds.shared, viewer).expect(200);
    // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    expect(linksResponse.body.data).toMatchObject([{
      recurringTransactionId: ruleIds.shared, transactionId: ids.sharedTx,
      actualAmount: { amount: "11.11", currency: null },
    }]);
    expect(linksResponse.body.data).toHaveLength(1);
    for (const response of [historyResponse, linksResponse]) {
      const serialized = JSON.stringify(response.body);
      for (const secret of [ids.privateTx, extra.privateTransaction, "777.77", "731.47", extra.foreignCategory, extra.foreignMerchant])
        expect(serialized).not.toContain(secret);
    }
  });

  it("gives the owner private sources and a hidden display account, while concealing them from other roles", async () => {
    for (const id of [ruleIds.privateAccount, ruleIds.privateTransaction, ruleIds.historicalAccount]) {
      const ownerHistory = await history(id, "owner").expect(200);
      expect(ownerHistory.body.data).toHaveLength(1);
      await links(id, "owner").expect(200);
      for (const viewer of ["admin", "member", "view_only", "professional"] as const) {
        await history(id, viewer).expect(404);
        await links(id, viewer).expect(404);
      }
    }
    for (const viewer of roles) {
      expect((await history(ruleIds.hiddenAccount, viewer).expect(200)).body.data).toHaveLength(1);
      expect((await links(ruleIds.hiddenAccount, viewer).expect(200)).body.data).toHaveLength(1);
    }
  });

  it("returns the same public 404 for missing, foreign and inaccessible histories and links", async () => {
    const missingId = randomUUID();
    for (const reader of [history, links]) {
      const absent = await reader(missingId, "member").expect(404);
      for (const id of [ruleIds.privateAccount, ruleIds.privateTransaction, ruleIds.historicalAccount,
        ruleIds.historicalCategory, ruleIds.historicalMerchant, ruleIds.foreign]) {
        const denied = await reader(id, "member").expect(404);
        expect(denied.body).toEqual({
          ...absent.body,
          error: { ...absent.body.error, timestamp: expect.any(String) },
        });
        expect(Number.isNaN(Date.parse(denied.body.error.timestamp))).toBe(false);
        const serialized = JSON.stringify(denied.body);
        for (const secret of [id, ids.privateTx, extra.privateTransaction, extra.foreignCategory, extra.foreignMerchant,
          "777.77", "731.47", "888.88", "611.11", "622.22"])
          expect(serialized).not.toContain(secret);
      }
      await reader(ruleIds.shared, "outsider").expect(404);
      await reader(ruleIds.foreign, "outsider").expect(200);
      expect((await reader(ruleIds.empty, "member").expect(200)).body.data).toEqual([]);
    }
  });

  it("keeps history limit, order and trusted household-only callers intact", async () => {
    const extraHistory = Array.from({ length: 103 }, (_, index) => ({
      recurringTransactionId: ruleIds.shared, action: "updated",
      changeReason: `visible event ${index}`,
      createdAt: new Date(Date.UTC(2026, 9, 3 + index)),
    }));
    await db.insert(recurringTransactionHistory).values(extraHistory);
    const limited = await history(ruleIds.shared, "member", "?limit=2").expect(200);
    expect(limited.body.data).toHaveLength(2);
    expect(limited.body.data.map((row: { changeReason: string }) => row.changeReason))
      .toEqual(["visible event 102", "visible event 101"]);
    expect((await history(ruleIds.shared, "member").expect(200)).body.data).toHaveLength(50);
    expect((await history(ruleIds.shared, "member", "?limit=500").expect(200)).body.data).toHaveLength(100);
    expect((await history(ruleIds.shared, "member", "?limit=bad").expect(200)).body.data).toHaveLength(50);

    // Scheduler and other trusted callers preserve the existing household-only API.
    expect((await recurringService.getHistory(ruleIds.privateAccount, a)).map((row) => row.action)).toContain("linked");
    expect((await recurringService.getLinkedTransactions(ruleIds.privateAccount, a)).map((row) => row.transactionId)).toContain(ids.privateTx);
  });

  it("allows local historical references, omitted fields and explicit category/merchant clears", async () => {
    await db.insert(recurringTransactionHistory).values({
      recurringTransactionId: ruleIds.empty, action: "updated",
      previousState: { accountId: ids.sharedAccount, categoryId: extra.localCategory, merchantId: extra.localMerchant },
      newState: { accountId: ids.sharedAccount, categoryId: null, merchantId: null },
    });
    const response = await history(ruleIds.empty, "member").expect(200);
    expect(response.body.data).toMatchObject([{
      previousState: { categoryId: extra.localCategory, merchantId: extra.localMerchant },
      newState: { categoryId: null, merchantId: null },
    }]);
    expect((await links(ruleIds.empty, "member").expect(200)).body.data).toEqual([]);
  });

  it.each(["previousState", "newState"] as const)("conceals malformed reference types in %s without a SQL cast error", async state => {
    for (const field of ["accountId", "categoryId", "merchantId"]) {
      for (const value of ["not-a-uuid", 42, true, [ids.sharedAccount], { id: ids.sharedAccount }]) {
        await db.delete(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, [ruleIds.empty]));
        await db.insert(recurringTransactionHistory).values({
          recurringTransactionId: ruleIds.empty, action: "updated", [state]: { [field]: value },
        });
        for (const reader of [history, links]) await reader(ruleIds.empty, "member").expect(404);
      }
    }
  });

  it.each(["previousState", "newState"] as const)("conceals a deleted category or null required account in %s", async state => {
    for (const reference of [{ categoryId: extra.deletedCategory }, { accountId: null }]) {
      await db.delete(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, [ruleIds.empty]));
      await db.insert(recurringTransactionHistory).values({
        recurringTransactionId: ruleIds.empty, action: "updated", [state]: reference,
      });
      for (const reader of [history, links]) await reader(ruleIds.empty, "member").expect(404);
    }
  });
});
