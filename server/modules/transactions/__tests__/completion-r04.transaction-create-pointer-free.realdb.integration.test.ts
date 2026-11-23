import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, categories, merchantAliases, merchants, outboxEvents, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { merchantRepository } from "../../../repositories/MerchantRepository";
import { a, actors, app, b, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const destinationId = randomUUID();
const refs = { category: randomUUID(), foreignCategory: randomUUID(), deletedCategory: randomUUID(),
  merchant: randomUUID(), foreignMerchant: randomUUID(), fallbackMerchant: randomUUID() };
const rawName = "Pointer Local", merchantName = "Pointer Local Merchant";
function payload(overrides: Record<string, unknown> = {}) {
  return { accountId: destinationId, categoryId: refs.category, merchantId: refs.merchant,
    name: rawName, date: "2026-11-02", type: "expense", amount: { amount: "7.25", currency: "ZMW" }, ...overrides };
}
function post(body: Record<string, unknown>, query = "") {
  return request(app).post(`/api/transactions${query}`).set("Cookie", actors.get("member")!.cookie).send(body);
}
async function state() {
  return {
    accounts: await db.select().from(accounts).where(eq(accounts.id, destinationId)),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    aliases: await db.select().from(merchantAliases).where(inArray(merchantAliases.merchantId,
      [refs.merchant, refs.foreignMerchant, refs.fallbackMerchant])).orderBy(merchantAliases.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(categories).where(inArray(categories.id, [refs.category, refs.foreignCategory, refs.deletedCategory]));
  await db.delete(merchants).where(inArray(merchants.id, [refs.merchant, refs.foreignMerchant, refs.fallbackMerchant]));
  await db.delete(accounts).where(eq(accounts.id, destinationId));
}
async function waitForEvent(transactionId: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, transactionId))).length) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed pointer-free create event");
}

describe("R04 ordinary pointer-free create validates the actual posted references", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(accounts).values({ id: destinationId, householdId: a, name: "Pointer-free destination",
      type: "checking", currency: "ZMW", balance: "1000.00", isAsset: true });
    await db.insert(categories).values([
      { id: refs.category, householdId: a, name: "LOCAL_CATEGORY", displayOrder: 1 },
      { id: refs.foreignCategory, householdId: b, name: "FOREIGN_CATEGORY", displayOrder: 1 },
      { id: refs.deletedCategory, householdId: a, name: "DELETED_CATEGORY", displayOrder: 1, deletedAt: new Date() },
    ]);
    await db.insert(merchants).values([
      { id: refs.merchant, householdId: a, name: merchantName },
      { id: refs.foreignMerchant, householdId: b, name: "FOREIGN_MERCHANT" },
      { id: refs.fallbackMerchant, householdId: a, name: "Pointer Local Fallback Merchant" },
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["foreign category", "deleted category", "foreign merchant"] as const)("preserves the existing body-only %s preflight denial", async kind => {
    const before = await state();
    const body = kind === "foreign merchant" ? { merchantId: refs.foreignMerchant }
      : { categoryId: kind === "foreign category" ? refs.foreignCategory : refs.deletedCategory };
    await post(payload(body)).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["categoryId", "merchantId"] as const)("rejects a visible query %s masking a foreign body ID without posting or alias effects", async field => {
    const before = await state();
    const local = field === "categoryId" ? refs.category : refs.merchant;
    const foreign = field === "categoryId" ? refs.foreignCategory : refs.foreignMerchant;
    await post(payload({ [field]: foreign }), `?${field}=${local}`).expect(404);
    expect(await state()).toEqual(before);
  });

  it("rejects a deleted body category masked by a live query category", async () => {
    const before = await state();
    await post(payload({ categoryId: refs.deletedCategory }), `?categoryId=${refs.category}`).expect(404);
    expect(await state()).toEqual(before);
  });

  it("retains the original explicit merchant when it moves foreign after middleware", async () => {
    const before = await state();
    const original = merchantRepository.findByIdAndHousehold.bind(merchantRepository);
    vi.spyOn(merchantRepository, "findByIdAndHousehold").mockImplementationOnce(async (...args) => {
      await db.update(merchants).set({ householdId: b }).where(eq(merchants.id, refs.merchant));
      return original(...args);
    });
    await post(payload()).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["category", "merchant"] as const)("rechecks a concurrent %s scope change under the posting transaction", async kind => {
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

  it("keeps visible pointer-free references, one alias, one posting and one CREATE audit", async () => {
    const created = await post(payload()).expect(201);
    expect(created.body.data).toMatchObject({ accountId: destinationId, categoryId: refs.category,
      merchantId: refs.merchant, recurringTransactionId: null, isRecurring: false });
    await waitForEvent(created.body.data.id);
    const saved = await state();
    expect(saved.accounts[0].balance).toBe("992.75");
    expect(saved.transactions.filter(row => row.id === created.body.data.id)).toHaveLength(1);
    expect(saved.aliases.map(alias => alias.aliasName)).toEqual([rawName]);
    expect(saved.audit.filter(row => row.entityId === created.body.data.id && row.action === "CREATE")).toHaveLength(1);
  });

  it("keeps omitted optional references and an unmatched free-form name valid", async () => {
    const created = await post(payload({ categoryId: undefined, merchantId: undefined, name: "Standalone Zulu" })).expect(201);
    await waitForEvent(created.body.data.id);
    expect(created.body.data).toMatchObject({ categoryId: null, merchantId: null, recurringTransactionId: null, name: "Standalone Zulu" });
    expect((await state()).aliases).toEqual([]);
  });

  it("preserves atomic rollback of pointer-free aliases and posting on audit failure", async () => {
    const before = await state();
    vi.spyOn(businessAuditService, "logCreate").mockRejectedValueOnce(new Error("POINTER_FREE_REFERENCE_AUDIT_FAILURE"));
    await post(payload()).expect(500);
    expect(await state()).toEqual(before);
  });
});
