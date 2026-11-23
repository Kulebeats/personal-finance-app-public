import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { accounts, auditLogs, categories, householdMembers, households, merchants, outboxEvents, rules, transactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { AnalyticsCache, analyticsCache } from "../../../services/AnalyticsCache";
import { analyticsLogicalKeyMatches } from "../../../config/redis/keys.mjs";
import { analyticsReportRepository } from "../../../repositories/reports";
import { outboxEventService } from "../../../core/events";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { ruleService } from "../../../services/rule/service";

const householdId = randomUUID(), foreignHouseholdId = randomUUID(), userId = randomUUID();
const categoryA = randomUUID(), categoryB = randomUUID(), foreignCategory = randomUUID(), deletedCategory = randomUUID();
const merchantId = randomUUID(), foreignMerchant = randomUUID(), currency = "USD";
const merchantName = "Synthetic split boundary merchant";
const password = "SyntheticSplitBoundary123!";
const beforePostingReceipts = { postingMode: null, postedAccountIsAsset: null, postedBalanceDelta: null };
let app: Awaited<ReturnType<typeof getTestApp>>, cookie: string, accountId: string;

function allocations(first = "60.00", second = "40.00") {
  return [
    { amount: { amount: first, currency }, categoryId: categoryA, notes: "A" },
    { amount: { amount: second, currency }, categoryId: categoryB, notes: "B" },
  ];
}
function put(id: string, body: Record<string, unknown>) {
  return request(app).put("/api/transactions/" + id).set("Cookie", cookie)
    .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(body);
}
async function eventCount(id: string, type: string) {
  return (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2", [id, type])).rows[0].count;
}
async function waitForEvent(id: string, type: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await eventCount(id, type)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed " + type + " event");
}
async function create(amount = "100.00", splits: ReturnType<typeof allocations> | null = allocations()) {
  const response = await request(app).post("/api/transactions").set("Cookie", cookie)
    .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
    .send({ accountId, name: merchantName, merchantId, type: "expense", date: "2026-01-10",
      amount: { amount, currency }, categoryId: categoryA, splits: splits ?? undefined, idempotencyKey: randomUUID() }).expect(201);
  const id: string = response.body.data.id;
  await waitForEvent(id, "transaction.created");
  return id;
}
async function state() {
  return {
    accounts: (await pool.query("SELECT * FROM accounts WHERE id=$1", [accountId])).rows,
    parents: (await pool.query("SELECT * FROM transactions WHERE account_id=$1 ORDER BY id", [accountId])).rows,
    children: (await pool.query("SELECT s.* FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.account_id=$1 ORDER BY s.id", [accountId])).rows,
    audits: (await pool.query("SELECT * FROM audit_logs WHERE household_id=$1 ORDER BY id", [householdId])).rows,
    events: (await pool.query("SELECT id,event_type,aggregate_id,payload FROM outbox_events WHERE household_id=$1 ORDER BY id", [householdId])).rows,
  };
}
async function assertPosting(id: string, amount: string, balance: string, first: string, second: string) {
  const saved = await state();
  expect(saved.parents).toHaveLength(1);
  expect(saved.parents[0]).toMatchObject({ id, amount, currency, category_id: null });
  expect(saved.accounts[0]).toMatchObject({ balance, initial_balance: "1000.00", currency });
  expect(saved.children).toHaveLength(2);
  expect(saved.children).toEqual(expect.arrayContaining([
    expect.objectContaining({ transaction_id: id, amount: first, category_id: categoryA }),
    expect.objectContaining({ transaction_id: id, amount: second, category_id: categoryB }),
  ]));
}
async function waitForBlocked(pid: number, count: number) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await pool.query<{ count: number }>(
      `WITH RECURSIVE blocked(pid,path) AS (
        SELECT a.pid,ARRAY[$1::int,a.pid] FROM pg_stat_activity a
          WHERE a.datname=current_database() AND $1=ANY(pg_blocking_pids(a.pid))
        UNION ALL
        SELECT a.pid,b.path||a.pid FROM blocked b JOIN pg_stat_activity a ON b.pid=ANY(pg_blocking_pids(a.pid))
          WHERE a.datname=current_database() AND NOT a.pid=ANY(b.path)
      ) SELECT count(DISTINCT pid)::int AS count FROM blocked`, [pid],
    );
    if (result.rows[0].count >= count) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

describe("R08 split replacement boundary controls over signed HTTP and SQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = "r08-split-boundary-" + userId + "@example.invalid";
    await db.insert(households).values([{ id: householdId, name: "Synthetic split boundary" }, { id: foreignHouseholdId, name: "Synthetic foreign split references" }]);
    await db.insert(users).values({ id: userId, email, username: "r08-split-boundary-" + userId,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(categories).values([
      { id: categoryA, householdId, name: "A", displayOrder: 0 },
      { id: categoryB, householdId, name: "B", displayOrder: 1 },
      { id: foreignCategory, householdId: foreignHouseholdId, name: "Foreign", displayOrder: 0 },
      { id: deletedCategory, householdId, name: "Deleted", displayOrder: 2, deletedAt: new Date() },
    ]);
    await db.insert(merchants).values([{ id: merchantId, householdId, name: merchantName }, { id: foreignMerchant, householdId: foreignHouseholdId, name: "Foreign merchant" }]);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);
  beforeEach(async () => {
    accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId,
      name: "Synthetic split boundary checking", type: "checking", currency,
      isAsset: true, isPrivate: false, initialBalance: "1000.00", balance: "1000.00" });
  });
  afterAll(async () => {
    for (const id of [householdId, foreignHouseholdId]) {
      await db.delete(outboxEvents).where(eq(outboxEvents.householdId, id));
      await db.delete(auditLogs).where(eq(auditLogs.householdId, id));
      await db.delete(transactions).where(eq(transactions.householdId, id));
      await db.delete(rules).where(eq(rules.householdId, id));
      await db.delete(merchants).where(eq(merchants.householdId, id));
      await db.delete(categories).where(eq(categories.householdId, id));
      await db.delete(accounts).where(eq(accounts.householdId, id));
      await db.delete(householdMembers).where(eq(householdMembers.householdId, id));
      await db.delete(households).where(eq(households.id, id));
    }
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1 OR target_user_id=$1", [userId]);
    await pool.query("DELETE FROM outbox_events WHERE payload->>'userId'=$1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("replaces exact decimal cents without changing the parent's single economic effect", async () => {
    const id = await create("0.30", allocations("0.10", "0.20"));
    await put(id, { splits: allocations("0.11", "0.19") }).expect(200);
    await assertPosting(id, "0.30", "999.70", "0.11", "0.19");
    await waitForEvent(id, "transaction.updated");
  });

  it.each(["empty", "zero", "negative", "excess precision", "wrong currency", "malformed"] as const)(
    "rejects %s replacements without partial writes", async mode => {
      const id = await create(), before = await state();
      let splits: unknown = allocations("55.00", "45.00");
      if (mode === "empty") splits = [];
      if (mode === "malformed") splits = [{ amount: "55.00", categoryId: categoryA }];
      if (mode === "zero") splits = allocations("0.00", "100.00");
      if (mode === "negative") splits = allocations("-10.00", "110.00");
      if (mode === "excess precision") splits = allocations("55.001", "44.999");
      if (mode === "wrong currency") splits = [{ ...allocations()[0], amount: { amount: "60.00", currency: "ZMW" } }, allocations()[1]];
      await put(id, { splits }).expect(400);
      expect(await state()).toEqual(before);
    },
  );

  it.each(["category", "merchant", "deleted category"] as const)("rejects mixed-valid/%s references atomically", async kind => {
    const id = await create(), before = await state();
    const splits = allocations("55.00", "45.00").map(split => ({ ...split })) as Array<Record<string, unknown>>;
    if (kind === "merchant") splits[1].merchantId = foreignMerchant;
    else splits[1].categoryId = kind === "category" ? foreignCategory : deletedCategory;
    await put(id, { splits }).expect(404);
    expect(await state()).toEqual(before);
  });

  it("normalizes uppercase valid reference UUIDs and preserves null optional child references", async () => {
    const id = await create();
    await put(id, { splits: [
      { amount: { amount: "55.00", currency }, categoryId: categoryA.toUpperCase(), merchantId: merchantId.toUpperCase(), notes: null },
      { amount: { amount: "45.00", currency }, categoryId: null, merchantId: null, notes: null },
    ] }).expect(200);
    const saved = await state();
    expect(saved.parents[0]).toMatchObject({ amount: "100.00", category_id: null });
    expect(saved.accounts[0].balance).toBe("900.00");
    expect(saved.children).toHaveLength(2);
    expect(saved.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: "55.00", category_id: categoryA, merchant_id: merchantId, notes: null }),
      expect.objectContaining({ amount: "45.00", category_id: null, merchant_id: null, notes: null }),
    ]));
    await waitForEvent(id, "transaction.updated");
  });

  it.each([false, true])("checks the actual parent merchant in the body under the write lock (replacement=%s)", async replacement => {
    const id = await create(), before = await state();
    await request(app).put("/api/transactions/" + id).query({ merchantId })
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ merchantId: foreignMerchant, ...(replacement ? { splits: allocations("55.00", "45.00") } : {}) }).expect(404);
    expect(await state()).toEqual(before);
  });

  it("preserves ordinary unsplit amount edits with no replacement field", async () => {
    const id = await create("100.00", null);
    await put(id, { amount: { amount: "125.50", currency } }).expect(200);
    const saved = await state();
    expect(saved.parents[0]).toMatchObject({ amount: "125.50", category_id: categoryA, currency });
    expect(saved.accounts[0].balance).toBe("874.50");
    expect(saved.children).toEqual([]);
    await waitForEvent(id, "transaction.updated");
  });

  it("keeps metadata of a synthetic legacy-null-currency parent but refuses new allocation assertions", async () => {
    const id = await create();
    // Deliberate synthetic legacy provenance gap; no guessed currency or backfill.
    await db.update(transactions).set({ ...beforePostingReceipts, currency: null }).where(eq(transactions.id, id));
    await put(id, { notes: "Legacy metadata control" }).expect(200);
    await waitForEvent(id, "transaction.updated");
    const before = await state();
    expect(before.parents[0]).toMatchObject({ currency: null, notes: "Legacy metadata control" });
    const listed = await request(app).get("/api/transactions").query({ accountId }).set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).expect(200);
    expect(listed.body.data[0].splits.map((split: { amount: unknown }) => split.amount)).toEqual(
      expect.arrayContaining([{ amount: "60.00", currency: null }, { amount: "40.00", currency: null }]),
    );
    await put(id, { splits: allocations("55.00", "45.00") }).expect(400);
    expect(await state()).toEqual(before);
  });

  it("preserves explicit trusted addSplits clear semantics without exposing HTTP clear", async () => {
    const id = await create();
    await transactionRepository.addSplits(id, householdId, []);
    const saved = await state();
    expect(saved.parents[0].amount).toBe("100.00");
    expect(saved.accounts[0].balance).toBe("900.00");
    expect(saved.children).toEqual([]);
  });

  it("preserves a legacy parent category on metadata and unchanged full-object fields, clearing only on a real replacement", async () => {
    const id = await create();
    // Deliberate synthetic legacy state; ordinary metadata must not repair it.
    await db.update(transactions).set({ categoryId: categoryA }).where(eq(transactions.id, id));
    const before = await state();
    await put(id, { notes: "Legacy categorized parent metadata" }).expect(200);
    await waitForEvent(id, "transaction.updated");
    let saved = await state();
    expect(saved.parents[0]).toMatchObject({ category_id: categoryA, notes: "Legacy categorized parent metadata" });
    expect(saved.children).toEqual(before.children);
    expect(saved.accounts).toEqual(before.accounts);
    await put(id, { categoryId: categoryA, notes: "Unchanged full-object category" }).expect(200);
    expect((await state()).parents[0].category_id).toBe(categoryA);
    // Same-as-before legacy category is stale metadata in a real split save.
    await put(id, { categoryId: categoryA, splits: allocations("55.00", "45.00") }).expect(200);
    await assertPosting(id, "100.00", "900.00", "55.00", "45.00");
  });

  it.each([false, true])("rejects a new ordinary parent category conflict with replacement=%s", async replacement => {
    const id = await create(), before = await state();
    await put(id, { categoryId: categoryB, ...(replacement ? { splits: allocations("55.00", "45.00") } : {}) }).expect(400);
    expect(await state()).toEqual(before);
  });

  it.each([true, false])("preserves parent category effects when a trusted split rule includes categorize=%s", async categorize => {
    const id = await create("100.00", null), ruleId = randomUUID();
    await db.insert(rules).values({ id: ruleId, householdId, name: "Synthetic categorize then split",
      priority: 1, enabled: true, conditionLogic: "all",
      conditions: [{ type: "amount", operator: "greater_than", value: "0" }],
      actions: [
        ...(categorize ? [{ type: "categorize" as const, value: categoryB }] : []),
        { type: "split_transaction", value: "splits", splitConfig: [
          { categoryId: categoryA, percentage: 60, note: "A" },
          { categoryId: categoryB, percentage: 40, note: "B" },
        ] },
      ],
    });
    try {
      const [parent] = await db.select().from(transactions).where(eq(transactions.id, id));
      const result = await ruleService.applyRules(parent, householdId, { userId });
      const expectedCategory = categorize ? categoryB : categoryA;
      expect(result.categoryId).toBe(expectedCategory);
      const saved = await state();
      expect(saved.parents[0]).toMatchObject({ category_id: expectedCategory, amount: "100.00", type: "expense" });
      expect(saved.accounts[0].balance).toBe("900.00");
      expect(saved.children).toHaveLength(2);
      expect(saved.children).toEqual(expect.arrayContaining([
        expect.objectContaining({ amount: "60.00", category_id: categoryA }),
        expect.objectContaining({ amount: "40.00", category_id: categoryB }),
      ]));
    } finally { await db.delete(rules).where(eq(rules.id, ruleId)); }
  });

  it("requires a replacement before reclassifying an existing split parent's type", async () => {
    const id = await create(), before = await state();
    await put(id, { type: "income" }).expect(400);
    expect(await state()).toEqual(before);
    await put(id, { type: "expense", notes: "Unchanged type metadata" }).expect(200);
    await assertPosting(id, "100.00", "900.00", "60.00", "40.00");
  });

  it("rejects new allocations on a negative historical expense even when the proposed amount is positive", async () => {
    const id = await create();
    // Synthetic malformed history: a positive new amount cannot launder it.
    await db.update(transactions).set({ ...beforePostingReceipts, amount: "-100.00" }).where(eq(transactions.id, id));
    const before = await state();
    await put(id, { amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00") }).expect(400);
    expect(await state()).toEqual(before);
  });

  it.each(["-100.00", "0.00"])("allows explicit trusted child cleanup on legacy %s without changing money or category", async originalAmount => {
    const id = await create();
    // Zero is a valid stored magnitude only for balance adjustments.
    await db.update(transactions).set({ ...beforePostingReceipts, amount: originalAmount, categoryId: categoryA,
      type: originalAmount === "0.00" ? "balance_adjustment" : "expense" }).where(eq(transactions.id, id));
    const before = await state();
    await transactionRepository.addSplits(id, householdId, []);
    const saved = await state();
    expect(saved.children).toEqual([]);
    expect(saved.parents[0]).toMatchObject({ amount: originalAmount, category_id: categoryA });
    expect(saved.accounts).toEqual(before.accounts);
  });

  it("rolls back both legs, both balances and the CREATE audit together, then permits one keyed retry", async () => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Transfer audit destination", type: "checking", currency, isAsset: true, balance: "0.00", initialBalance: "0.00" });
    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ password }).expect(200);
    const body = { fromAccountId: accountId, toAccountId: destinationId, idempotencyKey: randomUUID(),
      date: "2026-01-10", name: "Audit rollback transfer", amount: { amount: "100.00", currency } };
    const post = () => request(app).post("/api/transactions/transfer").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(body);
    const read = async () => ({
      balances: (await pool.query("SELECT id,balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      legs: (await pool.query("SELECT id,account_id FROM transactions WHERE account_id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      audits: (await pool.query("SELECT entity_id,details FROM audit_logs WHERE household_id=$1 AND action='CREATE' AND details->'newValue'->>'fromAccountId'=$2 ORDER BY id", [householdId, accountId])).rows,
    });
    const before = await read();
    const logCreate = businessAuditService.logCreate.bind(businessAuditService);
    let reachedAudit = false;
    const fault = vi.spyOn(businessAuditService, "logCreate").mockImplementation(async params => {
      await logCreate(params);
      if (params.householdId === householdId && params.metadata?.isTransfer === true) {
        reachedAudit = true;
        throw new Error("Synthetic failure after transfer audit insert");
      }
    });
    try {
      await post().expect(500);
      expect(reachedAudit).toBe(true);
      expect(await read()).toEqual(before);
    } finally {
      fault.mockRestore();
    }

    const { outflow, inflow } = (await post().expect(201)).body.data;
    const committed = await read();
    expect(committed.balances).toEqual(expect.arrayContaining([
      { id: accountId, balance: "900.00" }, { id: destinationId, balance: "100.00" },
    ]));
    expect(committed.legs).toHaveLength(2);
    expect(committed.legs).toEqual(expect.arrayContaining([
      { id: outflow.id, account_id: accountId }, { id: inflow.id, account_id: destinationId },
    ]));
    expect(committed.audits).toEqual([expect.objectContaining({ entity_id: outflow.id,
      details: expect.objectContaining({ isTransfer: true, newValue: expect.objectContaining({ inflowTransactionId: inflow.id }) }) })]);
    const replay = await post().expect(200);
    expect(replay.body.isDuplicate).toBe(true);
    expect(await read()).toEqual(committed);
  });

  it("commits a durable outbox event for a signed transfer and preserves it across keyed replay", async () => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Transfer event destination", type: "checking", currency: "ZMW", isAsset: true, balance: "0.00", initialBalance: "0.00" });
    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ password }).expect(200);
    const body = { fromAccountId: accountId, toAccountId: destinationId, idempotencyKey: randomUUID(),
      date: "2026-01-10", name: "Transfer event evidence", fxRate: "25", amount: { amount: "100.00", currency } };
    const post = () => request(app).post("/api/transactions/transfer").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(body);
    const financialState = async () => ({
      balances: (await pool.query("SELECT id,balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      legs: (await pool.query("SELECT id FROM transactions WHERE account_id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      audits: (await pool.query("SELECT id FROM audit_logs WHERE household_id=$1 AND details->'newValue'->>'fromAccountId'=$2 ORDER BY id", [householdId, accountId])).rows,
    });
    const before = await financialState();
    const publish = outboxEventService.publish.bind(outboxEventService);
    const attempted: string[] = [];
    const fault = vi.spyOn(outboxEventService, "publish").mockImplementation(async (event, tx) => {
      const inserted = await publish(event, tx);
      if (event.householdId === householdId && event.eventType === "transaction.created"
        && [accountId, destinationId].includes(String(event.payload.accountId))) {
        attempted.push(inserted.id);
        if (attempted.length === 2) throw new Error("Synthetic failure after the second transfer event insert");
      }
      return inserted;
    });
    try {
      await post().expect(500);
      expect(attempted).toHaveLength(2);
      expect((await pool.query("SELECT id FROM outbox_events WHERE id=ANY($1::uuid[])", [attempted])).rows).toEqual([]);
      expect(await financialState()).toEqual(before);
    } finally {
      fault.mockRestore();
    }

    const { outflow, inflow } = (await post().expect(201)).body.data;
    const events = async () => (await pool.query(
      "SELECT id,event_type,aggregate_type,aggregate_id,payload FROM outbox_events WHERE household_id=$1 AND aggregate_id=ANY($2::uuid[]) ORDER BY id",
      [householdId, [outflow.id, inflow.id, outflow.transferTransactionId]],
    )).rows;
    const committed = await events();
    expect(committed).toHaveLength(2);
    for (const [id, legAccount, amount] of [[outflow.id, accountId, "100.00"], [inflow.id, destinationId, "2500.00"]]) {
      expect(committed).toContainEqual(expect.objectContaining({
        event_type: "transaction.created", aggregate_type: "transaction", aggregate_id: id,
        payload: { id, type: "transfer", amount, accountId: legAccount },
      }));
    }
    const replay = await post().expect(200);
    expect(replay.body.isDuplicate).toBe(true);
    expect(await events()).toEqual(committed);
  });

  it.each(["updated", "deleted"] as const)("records transaction.%s for both legs of a signed transfer", async action => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Transfer mutation destination", type: "checking", currency, isAsset: true, balance: "0.00", initialBalance: "0.00" });
    const headers = { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);
    const body = { fromAccountId: accountId, toAccountId: destinationId, date: "2026-01-10",
      name: "Transfer mutation", amount: { amount: "100.00", currency } };
    const created = await request(app).post("/api/transactions/transfer").set(headers).send(body).expect(201);
    const { outflow, inflow } = created.body.data;
    const ids = [outflow.id, inflow.id];
    const mutate = () => action === "updated"
      ? request(app).put("/api/transactions/transfer/" + outflow.id).set(headers)
        .send({ ...body, amount: { amount: "125.00", currency } })
      : request(app).delete("/api/transactions/" + inflow.id).set(headers);
    const snapshot = async () => ({
      accounts: (await pool.query("SELECT * FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      legs: (await pool.query("SELECT * FROM transactions WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
      audits: (await pool.query("SELECT * FROM audit_logs WHERE entity_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
      events: (await pool.query("SELECT id,event_type,payload FROM outbox_events WHERE aggregate_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
    });
    const before = await snapshot();
    const publish = outboxEventService.publish.bind(outboxEventService);
    const attempted: string[] = [];
    const fault = vi.spyOn(outboxEventService, "publish").mockImplementation(async (event, tx) => {
      const inserted = await publish(event, tx);
      if (event.eventType === "transaction." + action && ids.includes(event.aggregateId)) {
        attempted.push(event.aggregateId);
        if (attempted.length === 2) throw new Error("Synthetic failure after both transfer mutation events");
      }
      return inserted;
    });
    try {
      await mutate().expect(500);
      expect(attempted.sort()).toEqual([...ids].sort());
      expect(await snapshot()).toEqual(before);
    } finally {
      fault.mockRestore();
    }
    await mutate().expect(200);
    const balances = (await pool.query("SELECT id,balance FROM accounts WHERE id=ANY($1::uuid[])", [[accountId, destinationId]])).rows;
    expect(balances).toEqual(expect.arrayContaining([
      { id: accountId, balance: action === "updated" ? "875.00" : "1000.00" },
      { id: destinationId, balance: action === "updated" ? "125.00" : "0.00" },
    ]));
    const events = (await pool.query(
      "SELECT aggregate_id,payload FROM outbox_events WHERE household_id=$1 AND aggregate_type='transaction' AND event_type=$2 AND aggregate_id=ANY($3::uuid[]) ORDER BY aggregate_id",
      [householdId, "transaction." + action, ids],
    )).rows;
    expect(events).toEqual([...ids].sort().map(id => ({
      aggregate_id: id, payload: action === "updated" ? { id, changes: ["amount"] } : { id },
    })));
    if (action === "deleted") {
      const afterDelete = await snapshot();
      await mutate().expect(404);
      expect(await snapshot()).toEqual(afterDelete);
    }
  });

  it("invalidates transfer-dependent debt analytics after committed writes and skips keyed replay", async () => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Transfer cache credit account", type: "credit", currency, isAsset: false, balance: "500.00", initialBalance: "500.00" });
    const headers = { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);
    const terms = { fromAccountId: accountId, toAccountId: destinationId, date: "2026-01-10",
      name: "Transfer cache check", amount: { amount: "100.00", currency } };
    const body = { ...terms, idempotencyKey: randomUUID() };
    const post = () => request(app).post("/api/transactions/transfer").set(headers).send(body);
    const observed: string[] = [];
    const invalidate = analyticsCache.invalidateEndpoint.bind(analyticsCache);
    const watch = vi.spyOn(analyticsCache, "invalidateEndpoint").mockImplementation(async (endpoint, household) => {
      if (endpoint === "debtAnalysis" && household === householdId) {
        const account = await pool.query("SELECT balance FROM accounts WHERE id=$1", [destinationId]);
        observed.push(account.rows[0].balance);
      }
      return invalidate(endpoint, household);
    });
    try {
      await request(app).post("/api/transactions/transfer").set(headers)
        .send({ ...body, amount: { amount: "1001.00", currency } }).expect(400);
      expect(observed, "rejected transfer has no committed change").toEqual([]);
      const created = await post().expect(201);
      expect.soft(Array.from(new Set(observed.splice(0))), "committed create visible to invalidation").toEqual(["400.00"]);
      expect((await post().expect(200)).body.isDuplicate).toBe(true);
      expect.soft(observed.splice(0), "duplicate create has no effect").toEqual([]);
      const id = created.body.data.outflow.id;
      await request(app).put("/api/transactions/transfer/" + id).set(headers)
        .send({ ...terms, amount: { amount: "125.00", currency } }).expect(200);
      expect.soft(Array.from(new Set(observed.splice(0))), "committed update visible to invalidation").toEqual(["375.00"]);
      await request(app).delete("/api/transactions/" + id).set(headers).expect(200);
      expect(Array.from(new Set(observed)), "committed delete visible to invalidation").toEqual(["500.00"]);
    } finally {
      watch.mockRestore();
    }
  });

  it("reads committed transfer debt on repeat requests even after an older calculation finishes", async () => {
    const cashId = randomUUID(), creditId = randomUUID();
    // Keep this repayment and report window independent of the suite's USD fixtures.
    // Debt analysis converts every visible liability to the ZMW base (NEW-02), so a
    // USD liability left by an earlier test would need a USD->ZMW rate; retire it.
    await db.update(accounts).set({ deletedAt: new Date() }).where(sql`${accounts.householdId} = ${householdId}
      AND ${accounts.currency} <> 'ZMW' AND ${accounts.type} IN ('credit', 'loan', 'mortgage', 'other_liability')`);
    await db.insert(accounts).values({ id: cashId, householdId, ownerUserId: userId, name: "Debt readback cash",
      type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" });
    await db.insert(accounts).values({ id: creditId, householdId, ownerUserId: userId, name: "Debt readback credit",
      type: "credit", currency: "ZMW", isAsset: false, initialBalance: "10500.00", balance: "10500.00" });
    const headers = { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);
    const entries = new Map<string, string>();
    const cache = new AnalyticsCache({
      assertCurrent() {},
      async getJson<T>(key: string) { return entries.has(key) ? JSON.parse(entries.get(key)!) as T : null; },
      async setJson(key, value) { entries.set(key, JSON.stringify(value)); },
      async invalidate(filter) {
        const keys = Array.from(entries.keys()).filter(key => analyticsLogicalKeyMatches(key, filter));
        for (const key of keys) entries.delete(key);
        return keys.length;
      },
    });
    const reads = vi.spyOn(analyticsCache, "getOrCompute").mockImplementation(cache.getOrCompute.bind(cache));
    const endpoints = vi.spyOn(analyticsCache, "invalidateEndpoint").mockImplementation(cache.invalidateEndpoint.bind(cache));
    const householdsCache = vi.spyOn(analyticsCache, "invalidateHousehold").mockImplementation(cache.invalidateHousehold.bind(cache));
    const report = (to: string) => request(app).get("/api/reports/debt").set(headers)
      .query({ from: "2025-08-01", to }).expect(200);
    const debt = (response: request.Response) =>
      response.body.data.topDebtAccounts.find((row: { id: string }) => row.id === creditId)?.balance;
    const original = analyticsReportRepository.getDebtAnalysis.bind(analyticsReportRepository);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    const compute = vi.spyOn(analyticsReportRepository, "getDebtAnalysis").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!held && args[0] === householdId && args[1].to === "2025-08-30") {
        held = true;
        await gate;
      }
      return result;
    });
    let pending: Promise<request.Response> | undefined;
    try {
      const before = { amount: "10500.00", currency: "ZMW" };
      const after = { amount: "10400.00", currency: "ZMW" };
      expect(debt(await report("2025-08-31"))).toEqual(before);
      expect(debt(await report("2025-08-31"))).toEqual(before);
      expect(compute).toHaveBeenCalledTimes(2);
      pending = report("2025-08-30").then(response => response);
      await Promise.race([
        vi.waitFor(() => expect(held).toBe(true), { timeout: 5000 }),
        pending.then(() => { throw new Error("The report completed before reaching the delayed calculation"); }),
      ]);
      await request(app).post("/api/transactions/transfer").set(headers).send({
        fromAccountId: cashId, toAccountId: creditId, amount: { amount: "100.00", currency: "ZMW" },
        date: "2025-08-10", name: "Debt readback payment", idempotencyKey: randomUUID(),
      }).expect(201);
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [creditId])).rows[0].balance).toBe("10400.00");
      expect(debt(await report("2025-08-31"))).toEqual(after);
      release();
      expect(debt(await pending)).toEqual(before);
      expect(debt(await report("2025-08-30"))).toEqual(after);
    } finally {
      release();
      try { await pending; } finally {
        compute.mockRestore();
        householdsCache.mockRestore();
        endpoints.mockRestore();
        reads.mockRestore();
      }
    }
  });

  it("rejects a stale transfer edit after the opposite leg was edited", async () => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Versioned transfer destination", type: "checking", currency, isAsset: true, balance: "0.00", initialBalance: "0.00" });
    const headers = { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);
    const terms = { fromAccountId: accountId, toAccountId: destinationId, date: "2026-01-10",
      name: "Versioned transfer", amount: { amount: "100.00", currency } };
    const created = await request(app).post("/api/transactions/transfer").set(headers).send(terms).expect(201);
    const { outflow, inflow } = created.body.data;
    const edit = (id: string, expectedUpdatedAt: string, amount: string, notes?: string | null) =>
      request(app).put("/api/transactions/transfer/" + id).set(headers)
        .send({ fromAccountId: accountId, toAccountId: destinationId, expectedUpdatedAt, notes, amount: { amount, currency } });
    const saved = (await edit(outflow.id, outflow.updatedAt, "125.00").expect(200)).body.data;
    expect(Date.parse(saved.inflow.updatedAt)).toBeGreaterThan(Date.parse(inflow.updatedAt));
    const ids = [outflow.id, inflow.id];
    const pairState = async () => ({
      accounts: (await pool.query("SELECT id,balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      legs: (await pool.query("SELECT * FROM transactions WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
      audits: (await pool.query("SELECT id FROM audit_logs WHERE entity_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
      events: (await pool.query("SELECT id FROM outbox_events WHERE aggregate_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
    });
    const before = await pairState();
    expect(before.accounts).toEqual(expect.arrayContaining([
      { id: accountId, balance: "875.00" }, { id: destinationId, balance: "125.00" },
    ]));
    const stale = await edit(inflow.id, inflow.updatedAt, "40.00");
    expect.soft(stale.status).toBe(409);
    expect(await pairState()).toEqual(before);
    const fresh = (await edit(inflow.id, saved.inflow.updatedAt, "40.00").expect(200)).body.data;
    expect(fresh.inflow.updatedAt).toBe(fresh.outflow.updatedAt);
    expect((await pairState()).accounts).toEqual(expect.arrayContaining([
      { id: accountId, balance: "960.00" }, { id: destinationId, balance: "40.00" },
    ]));

    const contenders = await Promise.all([
      edit(outflow.id, fresh.outflow.updatedAt, "55.00"),
      edit(inflow.id, fresh.inflow.updatedAt, "65.00"),
    ]);
    expect(contenders.map(response => response.status).sort()).toEqual([200, 409]);
    const outcome = await pairState();
    const [sourceBalance, targetBalance] = contenders[0].status === 200 ? ["945.00", "55.00"] : ["935.00", "65.00"];
    expect(outcome.accounts).toEqual(expect.arrayContaining([
      { id: accountId, balance: sourceBalance }, { id: destinationId, balance: targetBalance },
    ]));
    expect(outcome.legs.map(leg => leg.amount)).toEqual([targetBalance, targetBalance]);
    expect(outcome.audits).toHaveLength(before.audits.length + 2);
    expect(outcome.events).toHaveLength(before.events.length + 4);

    const current = contenders.find(response => response.status === 200)!.body.data;
    const noted = await put(inflow.id, { name: "Receipt Matched Inflow", notes: "Newer note on the other leg", expectedUpdatedAt: current.inflow.updatedAt }).expect(200);
    const afterNote = await pairState();
    expect(afterNote.legs.find(leg => leg.id === inflow.id).notes).toBe("Newer note on the other leg");
    await edit(outflow.id, current.outflow.updatedAt, "70.00").expect(409);
    expect(await pairState()).toEqual(afterNote);
    const retained = (await edit(outflow.id, noted.body.data.updatedAt, "70.00").expect(200)).body.data;
    expect([retained.outflow.name, retained.inflow.name]).toEqual([terms.name, "Receipt Matched Inflow"]);
    expect(retained.outflow.notes).toBe(null);
    expect(retained.inflow.notes).toBe("Newer note on the other leg");
    const replaced = (await edit(inflow.id, retained.inflow.updatedAt, "70.00", "Shared note").expect(200)).body.data;
    expect([replaced.outflow.notes, replaced.inflow.notes]).toEqual(["Shared note", "Shared note"]);
    const cleared = (await edit(outflow.id, replaced.outflow.updatedAt, "70.00", null).expect(200)).body.data;
    expect([cleared.outflow.notes, cleared.inflow.notes]).toEqual([null, null]);
  });

  it("refuses a prelocked transfer metadata write when a pair edit already holds its mate", async () => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Prelocked transfer destination", type: "checking", currency, isAsset: true, balance: "0.00", initialBalance: "0.00" });
    const headers = { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    await request(app).post("/api/settings/security/step-up").set(headers).send({ password }).expect(200);
    const terms = { fromAccountId: accountId, toAccountId: destinationId, date: "2026-01-10",
      name: "Prelocked pair", amount: { amount: "100.00", currency } };
    const { outflow, inflow } = (await request(app).post("/api/transactions/transfer").set(headers).send(terms).expect(201)).body.data;
    const higher = [outflow.id, inflow.id].sort()[1];
    let edit: Promise<request.Response> | undefined;
    try {
      await expect(db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM transactions WHERE id=${higher} FOR SHARE`);
        const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        edit = request(app).put("/api/transactions/transfer/" + outflow.id).set(headers)
          .send({ ...terms, amount: { amount: "125.00", currency }, expectedUpdatedAt: outflow.updatedAt }).then(r => r);
        expect(await waitForBlocked(pid, 1)).toBe(true);
        await transactionRepository.update(higher, householdId, { name: "Receipt metadata" }, undefined, tx);
      })).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      if (edit) expect((await edit).status).toBe(200);
    }
    const rows = (await pool.query("SELECT amount,name FROM transactions WHERE id=ANY($1::uuid[])", [[outflow.id, inflow.id]])).rows;
    expect(rows).toEqual([{ amount: "125.00", name: terms.name }, { amount: "125.00", name: terms.name }]);
    const retry = await db.transaction(tx => transactionRepository.update(higher, householdId, { name: "Receipt metadata" }, undefined, tx));
    expect(retry.transaction?.name).toBe("Receipt metadata");
  });

  it("binds a signed transfer key to the original create request across pair edits", async () => {
    const destinationId = randomUUID(), key = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Transfer replay destination", type: "checking", currency, isAsset: true, balance: "0.00", initialBalance: "0.00" });
    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ password }).expect(200);
    const original = { fromAccountId: accountId, toAccountId: destinationId, date: "2026-01-10",
      name: "First transfer", notes: "Original memo", amount: { amount: "100.00", currency } };
    const create = (changes: Partial<typeof original> = {}) => request(app).post("/api/transactions/transfer")
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ ...original, ...changes, idempotencyKey: key });
    const first = await create().expect(201);
    const { outflow, inflow } = first.body.data;
    const balances = async () => (await pool.query("SELECT id,balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[accountId, destinationId]])).rows;
    const before = await state(), beforeBalances = await balances();
    const unchanged = await create().expect(200);
    expect(unchanged.body).toMatchObject({ isDuplicate: true, data: { outflow: { id: outflow.id }, inflow: { id: inflow.id } } });
    for (const change of [{ date: "2026-01-11" }, { name: "Different transfer" }, { notes: "Different memo" }]) {
      expect.soft((await create(change)).status, JSON.stringify(change)).toBe(409);
    }
    expect(await state()).toEqual(before);
    expect(await balances()).toEqual(beforeBalances);
    const edited = { amount: { amount: "125.00", currency } };
    await request(app).put(`/api/transactions/transfer/${outflow.id}`).set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ ...original, ...edited }).expect(200);
    const afterEdit = await state();
    const originalRetry = await create();
    expect.soft(originalRetry.status, "original create after edit").toBe(200);
    expect.soft(originalRetry.body.data, "original pair identity").toMatchObject({ outflow: { id: outflow.id }, inflow: { id: inflow.id } });
    expect.soft((await create(edited)).status, "edited amount under the old create key").toBe(409);
    expect(await state()).toEqual(afterEdit);
    expect(await balances()).toEqual(expect.arrayContaining([
      { id: accountId, balance: "875.00" }, { id: destinationId, balance: "125.00" },
    ]));
  });

  it.each(["outflow", "inflow"] as const)("rejects allocations on a genuine transfer %s without changing either leg or cash", async leg => {
    const destinationId = randomUUID();
    await db.insert(accounts).values({ id: destinationId, householdId, ownerUserId: userId,
      name: "Synthetic split transfer destination", type: "checking", currency,
      isAsset: true, isPrivate: false, balance: "0.00", initialBalance: "0.00" });
    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ password }).expect(200);
    const response = await request(app).post("/api/transactions/transfer").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ fromAccountId: accountId, toAccountId: destinationId,
        amount: { amount: "100.00", currency }, date: "2026-01-10", name: "Synthetic pair remains a transfer" }).expect(201);
    const legIds: string[] = [response.body.data.outflow.id, response.body.data.inflow.id];
    const readPair = async () => ({
      ...await state(),
      pairAccounts: (await pool.query("SELECT * FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[accountId, destinationId]])).rows,
      pairRows: (await pool.query("SELECT * FROM transactions WHERE id=ANY($1::uuid[]) ORDER BY id", [legIds])).rows,
      pairSplits: (await pool.query("SELECT * FROM transaction_splits WHERE transaction_id=ANY($1::uuid[]) ORDER BY id", [legIds])).rows,
    });
    const before = await readPair();
    expect(before.pairRows).toHaveLength(2);
    expect(before.pairRows.every(row => row.type === "transfer" && row.transfer_transaction_id)).toBe(true);
    expect(before.pairAccounts.find(row => row.id === accountId)?.balance).toBe("900.00");
    expect(before.pairAccounts.find(row => row.id === destinationId)?.balance).toBe("100.00");
    await put(response.body.data[leg].id, { splits: allocations() }).expect(400);
    expect(await readPair()).toEqual(before);
    await put(response.body.data[leg].id, { notes: "Allowed transfer metadata" }).expect(200);
    await waitForEvent(response.body.data[leg].id, "transaction.updated");
    const afterMetadata = await readPair();
    expect(afterMetadata.pairSplits).toEqual([]);
    expect(afterMetadata.pairAccounts).toEqual(before.pairAccounts);
    expect(afterMetadata.pairRows.every(row => row.type === "transfer" && row.transfer_transaction_id)).toBe(true);
  });

  it("rejects a new split assertion on a genuine balance adjustment while preserving metadata", async () => {
    const adjusted = await request(app).post("/api/accounts/" + accountId + "/adjust-balance").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ amount: "100.00", isIncrease: true, notes: "Synthetic original adjustment" }).expect(200);
    expect(adjusted.body.success).toBe(true);
    const before = await state();
    expect(before.parents).toHaveLength(1);
    expect(before.parents[0]).toMatchObject({ type: "balance_adjustment", amount: "100.00" });
    expect(before.accounts[0].balance).toBe("1100.00");
    const id: string = before.parents[0].id;
    await put(id, { splits: allocations() }).expect(400);
    expect(await state()).toEqual(before);
    await put(id, { notes: "Allowed adjustment metadata" }).expect(200);
    await waitForEvent(id, "transaction.updated");
    const afterMetadata = await state();
    expect(afterMetadata.parents[0]).toMatchObject({ type: "balance_adjustment", notes: "Allowed adjustment metadata" });
    expect(afterMetadata.accounts).toEqual(before.accounts);
    expect(afterMetadata.children).toEqual([]);
  });

  it("rejects an ordinary expense type-to-transfer edit with allocations without converting its history", async () => {
    const id = await create(), before = await state();
    await put(id, { type: "transfer", splits: allocations() }).expect(400);
    expect(await state()).toEqual(before);
  });

  it("rejects stale rule allocations after an admitted parent-and-split amount edit", async () => {
    const id = await create();
    await put(id, { amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00") }).expect(200);
    await waitForEvent(id, "transaction.updated");
    const before = await state();
    await expect(transactionRepository.addSplits(id, householdId, [
      { amount: "60.00", categoryId: categoryA }, { amount: "40.00", categoryId: categoryB },
    ])).rejects.toMatchObject({ statusCode: 400 });
    expect(await state()).toEqual(before);
    await assertPosting(id, "120.00", "880.00", "70.00", "50.00");
  });

  it("serializes a stale rule split writer behind the parent's earlier queued edit", async () => {
    const id = await create(), blocker = await pool.connect();
    let first: Promise<{ status: number }> | undefined;
    let stale: Promise<{ accepted: boolean; statusCode?: number }> | undefined;
    let bothQueued = false;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT id FROM transactions WHERE id=$1 FOR UPDATE", [id]);
      first = put(id, { amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00") }).then(response => ({ status: response.status }));
      const firstQueued = await waitForBlocked(pid, 1);
      if (firstQueued) {
        stale = transactionRepository.addSplits(id, householdId, [
          { amount: "60.00", categoryId: categoryA }, { amount: "40.00", categoryId: categoryB },
        ]).then(() => ({ accepted: true }), (error: unknown) => ({ accepted: false,
          statusCode: error && typeof error === "object" && "statusCode" in error ? error.statusCode as number : undefined }));
        bothQueued = await waitForBlocked(pid, 2);
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      await Promise.allSettled([first, stale].filter((value): value is NonNullable<typeof value> => value !== undefined));
    }
    expect(bothQueued).toBe(true);
    expect(await first!).toEqual({ status: 200 });
    expect(await stale!).toEqual({ accepted: false, statusCode: 400 });
    await waitForEvent(id, "transaction.updated");
    await assertPosting(id, "120.00", "880.00", "70.00", "50.00");
  }, 15000);
});
