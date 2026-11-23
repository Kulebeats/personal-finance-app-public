import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  accounts, auditLogs, categories, merchantAliases, merchants, outboxEvents,
  recurringTransactions, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { merchantRepository } from "../../../repositories/MerchantRepository";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID(), destinationId = `a${randomUUID().slice(1)}`;
const refs = { category: randomUUID(), foreignCategory: randomUUID(), deletedCategory: randomUUID(),
  merchant: randomUUID(), foreignMerchant: randomUUID(), fallbackMerchant: randomUUID() };
const rawName = "Reference Local", merchantName = "Reference Local Merchant";
// "reference" is already an excluded recognition noise word.
const learnedAlias = "Local";
function payload(overrides: Record<string, unknown> = {}) {
  return { accountId: destinationId, categoryId: refs.category, merchantId: refs.merchant,
    name: rawName, date: "2026-11-02", type: "expense", amount: { amount: "7.25", currency: "ZMW" },
    recurringTransactionId: ruleId, ...overrides };
}
function post(body: Record<string, unknown>, query = "") {
  return request(app).post(`/api/transactions${query}`).set("Cookie", actors.get("member")!.cookie).send(body);
}
async function state() {
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [destinationId, ids.sharedAccount])).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    aliases: await db.select().from(merchantAliases).where(inArray(merchantAliases.merchantId, [refs.merchant, refs.foreignMerchant, refs.fallbackMerchant])).orderBy(merchantAliases.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clearOwnRows() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, ruleId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(categories).where(inArray(categories.id, [refs.category, refs.foreignCategory, refs.deletedCategory]));
  await db.delete(merchants).where(inArray(merchants.id, [refs.merchant, refs.foreignMerchant, refs.fallbackMerchant]));
  await db.delete(accounts).where(eq(accounts.id, destinationId));
}
async function waitForEvent(transactionId: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, transactionId));
    if (events.length) return events;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed create event");
}

describe("R04 normal transaction pointer-create references share the posting transaction", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    await db.insert(accounts).values({ id: destinationId, householdId: a, name: "Destination",
      type: "checking", currency: "ZMW", balance: "1000.00", isAsset: true });
    await db.insert(categories).values([
      { id: refs.category, householdId: a, name: "LOCAL_CATEGORY", displayOrder: 1 },
      { id: refs.foreignCategory, householdId: b, name: "FOREIGN_CATEGORY", displayOrder: 1 },
      { id: refs.deletedCategory, householdId: a, name: "DELETED_CATEGORY", displayOrder: 1, deletedAt: new Date() },
    ]);
    await db.insert(merchants).values([
      { id: refs.merchant, householdId: a, name: merchantName },
      { id: refs.foreignMerchant, householdId: b, name: "FOREIGN_MERCHANT" },
      { id: refs.fallbackMerchant, householdId: a, name: "Local Fallback Merchant" },
    ]);
    await db.insert(recurringTransactions).values({ id: ruleId, householdId: a, accountId: ids.sharedAccount,
      name: "Unrelated Parent Name", amount: "12.34", type: "expense", frequency: "monthly",
      startDate: "2026-11-01", nextDueDate: "2026-12-01" });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clearOwnRows(); });
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it.each(["foreign", "deleted", "absent"] as const)("rejects a top-level %s category without posting or learning an alias", async kind => {
    const before = await state();
    const categoryId = kind === "foreign" ? refs.foreignCategory : kind === "deleted" ? refs.deletedCategory : randomUUID();
    const response = await post(payload({ categoryId })).expect(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(await state()).toEqual(before);
  });

  it("rejects a foreign explicit merchant instead of persisting its UUID", async () => {
    const before = await state();
    await post(payload({ merchantId: refs.foreignMerchant, name: "Unmatched Pomegranate ZX" })).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["foreign", "absent"] as const)("does not replace an explicit %s merchant with a recognized local match or learn an alias", async kind => {
    const before = await state();
    await post(payload({ merchantId: kind === "foreign" ? refs.foreignMerchant : randomUUID() })).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["categoryId", "merchantId"] as const)("does not let a visible query %s mask a foreign body reference", async field => {
    const before = await state();
    const local = field === "categoryId" ? refs.category : refs.merchant;
    const foreign = field === "categoryId" ? refs.foreignCategory : refs.foreignMerchant;
    await post(payload({ [field]: foreign }), `?${field}=${local}`).expect(404);
    expect(await state()).toEqual(before);
  });

  it("rejects an explicit merchant moved foreign after middleware instead of learning a local fallback alias", async () => {
    const before = await state();
    const original = merchantRepository.findByIdAndHousehold.bind(merchantRepository);
    vi.spyOn(merchantRepository, "findByIdAndHousehold").mockImplementationOnce(async (...args) => {
      await db.update(merchants).set({ householdId: b }).where(eq(merchants.id, refs.merchant));
      return original(...args);
    });
    await post(payload()).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["category", "merchant"] as const)("rechecks the top-level %s after a concurrent scope change", async kind => {
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (kind === "category") await blocker.query("UPDATE categories SET deleted_at=now() WHERE id=$1", [refs.category]);
      else await blocker.query("UPDATE merchants SET household_id=$1 WHERE id=$2", [b, refs.merchant]);
      let settled = false;
      pending = post(payload()).timeout(10_000).then(response => { settled = true; return response; });
      void pending.catch(() => { settled = true; });
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it.each([true, false])("accepts an uppercase destination account UUID with pointer=%s", async withPointer => {
    const created = await post(payload({ accountId: destinationId.toUpperCase(),
      recurringTransactionId: withPointer ? ruleId : undefined })).expect(201);
    expect(created.body.data).toMatchObject({ accountId: destinationId, categoryId: refs.category,
      merchantId: refs.merchant, amount: { amount: "7.25", currency: "ZMW" } });
    await waitForEvent(created.body.data.id);
    const saved = await state();
    expect(saved.accounts.find(account => account.id === destinationId)?.balance).toBe("992.75");
    expect(saved.audit.filter(row => row.entityId === created.body.data.id && row.action === "CREATE")).toHaveLength(1);
  });

  it("keeps local references and atomically rolls back their learned alias on audit failure", async () => {
    const before = await state();
    vi.spyOn(businessAuditService, "logCreate").mockRejectedValueOnce(new Error("REFERENCE_AUDIT_FAILURE"));
    await post(payload()).expect(500);
    expect(await state()).toEqual(before);
  });

  it("retains successful pointer-free creation and the normal learned alias and audit", async () => {
    const created = await post(payload({ recurringTransactionId: undefined })).expect(201);
    await waitForEvent(created.body.data.id);
    const saved = await state();
    expect(created.body.data).toMatchObject({ categoryId: refs.category, merchantId: refs.merchant, name: merchantName });
    expect(saved.aliases.map(alias => alias.aliasName)).toEqual([learnedAlias]);
    expect(saved.audit.filter(row => row.entityId === created.body.data.id && row.action === "CREATE")).toHaveLength(1);
  });
});
