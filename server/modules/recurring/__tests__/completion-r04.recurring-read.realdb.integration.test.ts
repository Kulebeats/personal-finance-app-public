import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, categories, merchants, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleIds = {
  shared: randomUUID(), hidden: randomUUID(), private: randomUUID(), privateAccountSource: randomUUID(),
  privateTransactionSource: randomUUID(), historicalPrivate: randomUUID(), historicalAccount: randomUUID(),
  orphanHistory: randomUUID(), corruptAccount: randomUUID(), corruptForeignSource: randomUUID(),
  corruptCategory: randomUUID(), corruptMerchant: randomUUID(), deletedAccount: randomUUID(),
  suggestedWithoutSource: randomUUID(), inactive: randomUUID(), paused: randomUUID(), foreign: randomUUID(),
  unknownOrigin: randomUUID(), nullOrigin: randomUUID(),
  malformedHistoryAccount: randomUUID(),
};
const refs = { hiddenAccount: randomUUID(), deletedAccount: randomUUID(), privateSharedTransaction: randomUUID(), localCategory: randomUUID(), foreignCategory: randomUUID(), localMerchant: randomUUID(), foreignMerchant: randomUUID() };
const allRuleIds = Object.values(ruleIds);
let createdIds: string[] = [];
type Viewer = Role | "outsider";

function list(viewer: Viewer, query = "") {
  return request(app).get(`/api/recurring${query}`).set("Cookie", actors.get(viewer)!.cookie);
}
function detail(id: string, viewer: Viewer) {
  return request(app).get(`/api/recurring/${id}`).set("Cookie", actors.get(viewer)!.cookie);
}
async function clearRules() {
  const cleanupIds = [...allRuleIds, ...createdIds];
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, cleanupIds));
  await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, cleanupIds));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, cleanupIds));
  await db.delete(merchants).where(inArray(merchants.id, [refs.localMerchant, refs.foreignMerchant]));
  await db.delete(categories).where(inArray(categories.id, [refs.localCategory, refs.foreignCategory]));
}
function rule(id: string, householdId: string, accountId: string, name: string, day: number) {
  return { id, householdId, accountId, name, amount: `${day}.00`, type: "expense" as const, frequency: "monthly" as const, startDate: "2026-10-01", nextDueDate: `2026-12-${String(day).padStart(2, "0")}` };
}

describe("R04 recurring ordinary read audience on marked PostgreSQL", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearRules();
    createdIds = [];
    await reset();
    await db.insert(accounts).values([
      { id: refs.hiddenAccount, householdId: a, name: "DISPLAY_HIDDEN", type: "checking", currency: "ZMW", isHidden: true },
      { id: refs.deletedAccount, householdId: a, name: "DELETED_ACCOUNT", type: "checking", currency: "ZMW", deletedAt: new Date() },
    ]);
    await db.insert(categories).values([
      { id: refs.localCategory, householdId: a, name: "LOCAL_CATEGORY", displayOrder: 1 },
      { id: refs.foreignCategory, householdId: b, name: "FOREIGN_CATEGORY", displayOrder: 1 },
    ]);
    await db.insert(merchants).values([
      { id: refs.localMerchant, householdId: a, name: "LOCAL_MERCHANT" },
      { id: refs.foreignMerchant, householdId: b, name: "FOREIGN_MERCHANT" },
    ]);
    await db.insert(transactions).values({ id: refs.privateSharedTransaction, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-05", name: "PRIVATE_SOURCE_MARKER", amount: "77.00", type: "expense", isPrivate: true });
    await db.insert(recurringTransactions).values([
      { ...rule(ruleIds.shared, a, ids.sharedAccount, "SHARED_MANUAL", 1), categoryId: refs.localCategory, merchantId: refs.localMerchant },
      rule(ruleIds.hidden, a, refs.hiddenAccount, "DISPLAY_HIDDEN_RULE", 2),
      rule(ruleIds.private, a, ids.privateAccount, "PRIVATE_ACCOUNT_RULE", 3),
      rule(ruleIds.privateAccountSource, a, ids.sharedAccount, "PRIVATE_ACCOUNT_SOURCE_MARKER", 4),
      rule(ruleIds.privateTransactionSource, a, ids.sharedAccount, "PRIVATE_TRANSACTION_SOURCE_MARKER", 5),
      rule(ruleIds.historicalPrivate, a, ids.sharedAccount, "UNLINKED_PRIVATE_SOURCE_MARKER", 6),
      rule(ruleIds.historicalAccount, a, ids.sharedAccount, "OLD_PRIVATE_ACCOUNT_MARKER", 7),
      rule(ruleIds.orphanHistory, a, ids.sharedAccount, "ORPHAN_HISTORY_MARKER", 8),
      rule(ruleIds.corruptAccount, a, ids.foreignAccount, "FOREIGN_ACCOUNT_MARKER", 9),
      rule(ruleIds.corruptForeignSource, a, ids.sharedAccount, "FOREIGN_SOURCE_MARKER", 10),
      { ...rule(ruleIds.corruptCategory, a, ids.sharedAccount, "FOREIGN_CATEGORY_MARKER", 11), categoryId: refs.foreignCategory },
      { ...rule(ruleIds.corruptMerchant, a, ids.sharedAccount, "FOREIGN_MERCHANT_MARKER", 15), merchantId: refs.foreignMerchant },
      rule(ruleIds.deletedAccount, a, refs.deletedAccount, "DELETED_ACCOUNT_MARKER", 16),
      { ...rule(ruleIds.suggestedWithoutSource, a, ids.sharedAccount, "UNLINKED_SUGGESTED_PRIVATE_COPY_MARKER", 17), detectionMethod: "suggested" },
      { ...rule(ruleIds.unknownOrigin, a, ids.sharedAccount, "UNKNOWN_ORIGIN_MARKER", 18), detectionMethod: "unknown" },
      { ...rule(ruleIds.nullOrigin, a, ids.sharedAccount, "NULL_ORIGIN_MARKER", 19), detectionMethod: null },
      rule(ruleIds.malformedHistoryAccount, a, ids.sharedAccount, "MALFORMED_HISTORY_ACCOUNT_MARKER", 20),
      { ...rule(ruleIds.inactive, a, ids.sharedAccount, "INACTIVE_SHARED", 12), isActive: false },
      { ...rule(ruleIds.paused, a, ids.sharedAccount, "PAUSED_SHARED", 13), isPaused: true },
      rule(ruleIds.foreign, b, ids.foreignAccount, "FOREIGN_HOUSEHOLD_MARKER", 14),
    ]);
    await db.insert(recurringTransactionLinks).values([
      { recurringTransactionId: ruleIds.privateAccountSource, transactionId: ids.privateTx },
      { recurringTransactionId: ruleIds.privateTransactionSource, transactionId: refs.privateSharedTransaction },
      { recurringTransactionId: ruleIds.corruptForeignSource, transactionId: ids.foreignTx },
    ]);
    await db.insert(recurringTransactionHistory).values([
      { recurringTransactionId: ruleIds.historicalPrivate, action: "unlinked", linkedTransactionId: ids.privateTx },
      { recurringTransactionId: ruleIds.historicalAccount, action: "updated", previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount } },
      { recurringTransactionId: ruleIds.orphanHistory, action: "linked", linkedTransactionId: null },
      { recurringTransactionId: ruleIds.malformedHistoryAccount, action: "updated", previousState: { accountId: "not-a-uuid" } },
    ]);
  });
  afterEach(clearRules);
  afterAll(async () => { await clearRules(); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("%s lists only visible shared rules in due-date order", async viewer => {
    const response = await list(viewer).expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([ruleIds.shared, ruleIds.hidden]);
    expect(response.body.data[0]).toMatchObject({ id: ruleIds.shared, accountId: ids.sharedAccount, categoryId: refs.localCategory, merchantId: refs.localMerchant, amount: { amount: "1.00", currency: null } }); // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    expect(response.body.data[1]).toMatchObject({ id: ruleIds.hidden, accountId: refs.hiddenAccount });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_.*MARKER|FOREIGN_.*MARKER|ORPHAN_HISTORY_MARKER|OLD_PRIVATE_ACCOUNT_MARKER/);
  });

  it("allows the owner private sources and account while excluding corrupt references", async () => {
    const response = await list("owner").expect(200);
    expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([
      ruleIds.shared, ruleIds.hidden, ruleIds.private, ruleIds.privateAccountSource,
      ruleIds.privateTransactionSource, ruleIds.historicalPrivate, ruleIds.historicalAccount,
    ]);
    const privateDetail = await detail(ruleIds.private, "owner").expect(200);
    expect(privateDetail.body.data).toMatchObject({ id: ruleIds.private, accountId: ids.privateAccount, amount: { amount: "3.00", currency: null } }); // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
  });

  it("applies status flags after the audience filter without revealing private rules", async () => {
    const response = await list("member", "?includeInactive=true&includePaused=true").expect(200);
    expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([ruleIds.shared, ruleIds.hidden, ruleIds.inactive, ruleIds.paused]);
  });

  it("retains a fresh manually created unlinked shared template and its created lineage", async () => {
    const created = await request(app).post("/api/recurring")
      .set("Cookie", actors.get("owner")!.cookie)
      .send({ accountId: ids.sharedAccount, name: "FRESH_MANUAL_SHARED", amount: { amount: "21.00", currency: "ZMW" }, type: "expense", frequency: "monthly", nextDueDate: "2026-12-21" })
      .expect(201);
    createdIds.push(created.body.data.id);
    const history = await db.select().from(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, createdIds));
    expect(history.filter(entry => entry.action === "created")).toEqual([expect.objectContaining({ action: "created", newState: expect.objectContaining({ accountId: ids.sharedAccount }) })]);
    expect(history.filter(entry => entry.action === "denomination_confirmed_v1")).toEqual([expect.objectContaining({
      newState: { version: 1, currency: "ZMW", amount: "21.00", accountId: ids.sharedAccount, source: "manual_creation" },
    })]);
    expect(history).toHaveLength(2);
    const publicHistory = await request(app).get(`/api/recurring/${createdIds[0]}/history?limit=1`).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(publicHistory.body.data).toEqual([expect.objectContaining({ action: "created" })]);
    expect((await detail(createdIds[0], "member").expect(200)).body.data).toMatchObject({ id: createdIds[0], verifiedCurrency: "ZMW", amount: { amount: "21.00", currency: "ZMW" } });
    expect((await list("member").expect(200)).body.data.map((item: { id: string }) => item.id)).toContain(createdIds[0]);
  });

  it("conceals a private source after hard deletion leaves a nullable linked history marker", async () => {
    const sourceId = randomUUID();
    const templateId = randomUUID();
    createdIds.push(templateId);
    await db.insert(transactions).values({ id: sourceId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-05", name: "DELETED_PRIVATE_SOURCE", amount: "17.00", type: "expense", isPrivate: true });
    try {
      await db.insert(recurringTransactions).values(rule(templateId, a, ids.sharedAccount, "DELETED_ORIGIN_RULE", 22));
      await db.insert(recurringTransactionHistory).values({ recurringTransactionId: templateId, action: "linked", linkedTransactionId: sourceId });
      await detail(templateId, "member").expect(404);
      await detail(templateId, "owner").expect(200);

      await db.delete(transactions).where(eq(transactions.id, sourceId));
      const history = await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, templateId));
      expect(history).toHaveLength(1);
      expect(history[0].linkedTransactionId).toBeNull();
      await detail(templateId, "member").expect(404);
      await detail(templateId, "owner").expect(404);
      expect((await list("owner").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(templateId);
    } finally {
      await db.delete(transactions).where(eq(transactions.id, sourceId));
    }
  });

  it("conceals a suggested rule whose source links never survived creation", async () => {
    await detail(ruleIds.suggestedWithoutSource, "member").expect(404);
    await detail(ruleIds.suggestedWithoutSource, "owner").expect(404);
    for (const viewer of ["member", "owner"] as const) {
      expect((await list(viewer).expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(ruleIds.suggestedWithoutSource);
    }
  });

  it("conceals a suggested copy when only one confirmed source survived", async () => {
    const templateId = randomUUID();
    createdIds.push(templateId);
    await db.insert(recurringTransactions).values({ ...rule(templateId, a, ids.sharedAccount, "PARTIAL_PRIVATE_ORIGIN_COPY", 23), detectionMethod: "suggested" });
    await db.insert(recurringTransactionHistory).values({
      recurringTransactionId: templateId, action: "linked", linkedTransactionId: ids.sharedTx,
      newState: { matchMethod: "confirmed" },
    });
    await detail(templateId, "member").expect(404);
    await detail(templateId, "owner").expect(404);
    expect((await list("member").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(templateId);
  });

  it("does not treat a later visible manual link as proof of suggested origin", async () => {
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.suggestedWithoutSource, transactionId: ids.sharedTx });
    await db.insert(recurringTransactionHistory).values({
      recurringTransactionId: ruleIds.suggestedWithoutSource, action: "linked", linkedTransactionId: ids.sharedTx,
      newState: { matchMethod: "manual" },
    });
    await detail(ruleIds.suggestedWithoutSource, "member").expect(404);
    await detail(ruleIds.suggestedWithoutSource, "owner").expect(404);
    expect((await list("member").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(ruleIds.suggestedWithoutSource);
  });

  it("conceals a suggested copy even when all five recorded samples are visible", async () => {
    const templateId = randomUUID();
    const earliestPrivateId = randomUUID();
    const visibleIds = Array.from({ length: 5 }, () => randomUUID());
    createdIds.push(templateId);
    await db.insert(transactions).values([
      { id: earliestPrivateId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-01", name: "EARLIEST_PRIVATE_ORIGIN_COPY", amount: "25.00", type: "expense", isPrivate: true },
      ...visibleIds.map((id, index) => ({ id, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: `2026-10-${String(index + 2).padStart(2, "0")}`, name: `LATER_SHARED_SOURCE_${index}`, amount: "25.00", type: "expense" as const, isPrivate: false })),
    ]);
    try {
      await db.insert(recurringTransactions).values({ ...rule(templateId, a, ids.sharedAccount, "EARLIEST_PRIVATE_ORIGIN_COPY", 24), detectionMethod: "suggested" });
      await db.insert(recurringTransactionLinks).values(visibleIds.map(transactionId => ({ recurringTransactionId: templateId, transactionId })));
      await db.insert(recurringTransactionHistory).values(visibleIds.map(linkedTransactionId => ({
        recurringTransactionId: templateId, action: "linked", linkedTransactionId,
        newState: { matchMethod: "confirmed" },
      })));
      await detail(templateId, "member").expect(404);
      await detail(templateId, "owner").expect(404);
      expect((await list("member").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(templateId);
    } finally {
      await db.delete(transactions).where(inArray(transactions.id, [earliestPrivateId, ...visibleIds]));
    }
  });

  it("conceals unknown and null detection origins", async () => {
    for (const id of [ruleIds.unknownOrigin, ruleIds.nullOrigin]) {
      await detail(id, "member").expect(404);
      await detail(id, "owner").expect(404);
    }
  });

  it("conceals malformed historical account references without failing the whole list", async () => {
    await detail(ruleIds.malformedHistoryAccount, "member").expect(404);
    await detail(ruleIds.malformedHistoryAccount, "owner").expect(404);
    expect((await list("member").expect(200)).body.data.map((item: { id: string }) => item.id)).not.toContain(ruleIds.malformedHistoryAccount);
  });

  it("returns the same public 404 for absent, private, foreign and corrupt detail", async () => {
    const absent = await detail(randomUUID(), "member").expect(404);
    for (const id of [ruleIds.private, ruleIds.privateAccountSource, ruleIds.privateTransactionSource, ruleIds.historicalPrivate, ruleIds.historicalAccount, ruleIds.orphanHistory, ruleIds.corruptAccount, ruleIds.corruptForeignSource, ruleIds.corruptCategory, ruleIds.corruptMerchant, ruleIds.deletedAccount, ruleIds.suggestedWithoutSource, ruleIds.unknownOrigin, ruleIds.nullOrigin, ruleIds.malformedHistoryAccount, ruleIds.foreign]) {
      const response = await detail(id, "member").expect(404);
      expect(response.body.error.code).toBe(absent.body.error.code);
      expect(response.body.error.message).toBe(absent.body.error.message);
    }
    const shared = await detail(ruleIds.shared, "member").expect(200);
    expect(shared.body.data).toMatchObject({ id: ruleIds.shared, name: "SHARED_MANUAL", amount: { amount: "1.00", currency: null } }); // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    const outsider = await detail(ruleIds.foreign, "outsider").expect(200);
    expect(outsider.body.data.id).toBe(ruleIds.foreign);
    await detail(ruleIds.shared, "outsider").expect(404);
  });
});
