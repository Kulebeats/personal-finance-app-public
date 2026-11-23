import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { accounts, auditLogs, households, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { getVerifiedRecurringRuleCurrency, verifiedRecurringCurrencySql } from "../../../services/recurring/RecurringPatternProvenance";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const accountId = randomUUID();
const due = new Date().toISOString().slice(0, 10);
const cookie = () => actors.get("member")!.cookie;
const actor = () => ({ householdId: a, userId: actors.get("member")!.id, role: "member" as const });
const input = (currency = "ZMW") => ({ accountId, name: "Explicit denomination", amount: { amount: "7.25", currency },
  type: "expense", frequency: "monthly", nextDueDate: due });
async function legacy(oldCurrency?: string) {
  const [rule] = await db.insert(recurringTransactions).values({ householdId: a, accountId, name: "Legacy unknown unit",
    amount: "7.25", type: "expense", frequency: "monthly", startDate: due, nextDueDate: due, detectionMethod: "manual" }).returning();
  if (oldCurrency) await db.insert(recurringTransactionHistory).values({ recurringTransactionId: rule.id, action: "created",
    newState: { amount: { amount: "7.25", currency: oldCurrency } } });
  return rule;
}
async function financialState(id: string) {
  return { rule: await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id)),
    ledger: await db.select().from(transactions).where(eq(transactions.accountId, accountId)),
    account: await db.select().from(accounts).where(eq(accounts.id, accountId)),
    history: await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, id)).orderBy(recurringTransactionHistory.id) };
}
async function observedDefinition(id: string) {
  const response = await request(app).get(`/api/recurring/${id}`).set("Cookie", cookie()).expect(200);
  if (response.body.data.definitionToken) return response.body.data.definitionToken as string;
  // Old source lacks the response token. Supply the documented canonical definition
  // so denial tests still reach the old signed writer instead of failing in fixture setup.
  const [row] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id));
  return createHash("sha256").update(JSON.stringify(Object.keys(row).sort().map(key => [key, row[key as keyof typeof row]]))).digest("hex");
}
async function createKnown() {
  return (await request(app).post("/api/recurring").set("Cookie", cookie()).send(input()).expect(201)).body.data.id as string;
}
async function clean() {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
  await db.delete(transactions).where(eq(transactions.accountId, accountId));
  await db.delete(accounts).where(eq(accounts.id, accountId));
}

describe("R04 recurring financial denomination receipts and explicit recovery", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(accounts).values({ id: accountId, householdId: a, ownerUserId: actors.get("member")!.id,
      name: "Denomination destination", type: "checking", balance: "1000.00", currency: "ZMW", isPrivate: false });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  for (const caller of ["signed", "trusted"] as const) {
    it.each([undefined, "USD"])(`holds ${caller} legacy materialization with historical unit %s despite a current ZMW destination`, async oldUnit => {
      const rule = await legacy(oldUnit), before = await financialState(rule.id);
      const result = caller === "signed"
        ? (await request(app).post("/api/recurring/process").set("Cookie", cookie()).send({}).expect(200)).body.data
        : await recurringService.processRecurring(a);
      expect(result.created).toBe(0);
      expect(result.errors).toEqual([{ ruleId: rule.id, error: expect.stringMatching(/confirm.*amount.*ZMW|denomination.*confirm/i) }]);
      expect(await financialState(rule.id)).toEqual(before);
      expect(await getVerifiedRecurringRuleCurrency(rule.id, a)).toBeNull();
    });
  }

  it("does not turn an ordinary edit of a legacy DTO into a denomination attestation", async () => {
    const rule = await legacy("USD");
    await request(app).put(`/api/recurring/${rule.id}`).set("Cookie", cookie())
      .send({ name: "Still unknown", amount: { amount: "7.25", currency: "ZMW" } }).expect(200);
    expect(await getVerifiedRecurringRuleCurrency(rule.id, a)).toBeNull();
    expect((await recurringService.processRecurring(a)).created).toBe(0);
  });

  it("recovers a legacy rule only after an explicit reentered ZMW amount and then materializes through the trusted caller", async () => {
    const rule = await legacy("USD");
    const expectedDefinition = await observedDefinition(rule.id);
    await request(app).put(`/api/recurring/${rule.id}`).set("Cookie", cookie())
      .send({ confirmDenomination: true, expectedDefinition, amount: { amount: "19.50", currency: "ZMW" } }).expect(200);
    expect(await getVerifiedRecurringRuleCurrency(rule.id, a)).toBe("ZMW");
    expect((await recurringService.processRecurring(a)).created).toBe(1);
    const state = await financialState(rule.id);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ amount: "19.50", currency: "ZMW" });
    expect(state.account[0].balance).toBe("980.50");
    const history = await request(app).get(`/api/recurring/${rule.id}/history?limit=1`).set("Cookie", cookie()).expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(JSON.stringify(history.body)).not.toContain("denomination_confirmed_v1");
  });

  it.each([{}, { amount: { amount: "7.25", currency: "USD" } }])("rejects incomplete or unsupported explicit recovery %# without effects", async patch => {
    const rule = await legacy(), before = await financialState(rule.id);
    const expectedDefinition = await observedDefinition(rule.id);
    await request(app).put(`/api/recurring/${rule.id}`).set("Cookie", cookie()).send({ ...patch, confirmDenomination: true, expectedDefinition }).expect(400);
    expect(await financialState(rule.id)).toEqual(before);
  });

  it("attests a new signed manual ZMW amount and retains that unit through a supported edit and signed posting", async () => {
    const created = await request(app).post("/api/recurring").set("Cookie", cookie()).send(input()).expect(201), id = created.body.data.id;
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
    await request(app).put(`/api/recurring/${id}`).set("Cookie", cookie()).send({ amount: { amount: "9.50", currency: "ZMW" } }).expect(200);
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
    const result = await request(app).post("/api/recurring/process").set("Cookie", cookie()).send({}).expect(200);
    expect(result.body.data.created).toBe(1);
    expect((await financialState(id)).ledger[0]).toMatchObject({ amount: "9.50", currency: "ZMW" });
  });

  it("refuses unsupported new manual denomination without creating a relabeled template", async () => {
    await request(app).post("/api/recurring").set("Cookie", cookie()).send(input("USD")).expect(400);
    const rows = await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a));
    expect(rows).toHaveLength(0);
  });

  it("keeps currency proof correlated to the outer rule in a single-table aliased SQL reader", async () => {
    const id = await createKnown(), rule = alias(recurringTransactions, "currency_rule");
    const rows = await db.select({ currency: verifiedRecurringCurrencySql(rule) }).from(rule)
      .where(and(eq(rule.id, id), eq(rule.householdId, a)));
    expect(rows).toEqual([{ currency: "ZMW" }]);
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
  });

  it.each(["amount", "account", "malformed receipt"] as const)("invalidates denomination proof after an unaccompanied %s change", async change => {
    const created = await request(app).post("/api/recurring").set("Cookie", cookie()).send(input()).expect(201), id = created.body.data.id;
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
    if (change === "amount") await db.update(recurringTransactions).set({ amount: "99.00" }).where(eq(recurringTransactions.id, id));
    else if (change === "account") await db.update(recurringTransactions).set({ accountId: ids.sharedAccount }).where(eq(recurringTransactions.id, id));
    else await db.update(recurringTransactionHistory).set({ newState: { version: 1, currency: "USD" } })
      .where(and(eq(recurringTransactionHistory.recurringTransactionId, id), eq(recurringTransactionHistory.action, "denomination_confirmed_v1")));
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBeNull();
    const before = await financialState(id);
    expect((await recurringService.processRecurring(a)).created).toBe(0);
    expect(await financialState(id)).toEqual(before);
  });

  for (const caller of ["signed", "service"] as const) {
    it(`rejects a non-ZMW edit through an uppercase rule id on the ${caller} path`, async () => {
      const id = await createKnown(), before = await financialState(id);
      if (caller === "signed") await request(app).put(`/api/recurring/${id.toUpperCase()}`).set("Cookie", cookie())
        .send({ amount: { amount: "7.25", currency: "USD" } }).expect(400);
      else await expect(recurringService.updateRecurring(id.toUpperCase(), { amount: "7.25" }, actor(), { currency: "USD" })).rejects.toThrow(/denomination/);
      expect(await financialState(id)).toEqual(before);
    });
    it(`accepts an uppercase destination id without losing its trusted currency on the ${caller} path`, async () => {
      const id = await createKnown();
      if (caller === "signed") await request(app).put(`/api/recurring/${id}`).set("Cookie", cookie()).send({ accountId: accountId.toUpperCase() }).expect(200);
      else await recurringService.updateRecurring(id, { accountId: accountId.toUpperCase() }, actor());
      expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
      expect((await recurringService.processRecurring(a)).created).toBe(1);
    });
    it(`does not revive an older receipt when an unproven ${caller} edit returns to its old amount`, async () => {
      const id = await createKnown();
      await db.update(recurringTransactions).set({ amount: "9.50" }).where(eq(recurringTransactions.id, id));
      expect(await getVerifiedRecurringRuleCurrency(id, a)).toBeNull();
      if (caller === "signed") await request(app).put(`/api/recurring/${id}`).set("Cookie", cookie())
        .send({ amount: { amount: "7.25", currency: "USD" } }).expect(200);
      else await recurringService.updateRecurring(id, { amount: "7.25" }, actor(), { currency: "USD" });
      expect(await getVerifiedRecurringRuleCurrency(id, a)).toBeNull();
      const before = await financialState(id);
      expect((await recurringService.processRecurring(a)).created).toBe(0);
      expect(await financialState(id)).toEqual(before);
      const expectedDefinition = await observedDefinition(id);
      if (caller === "signed") await request(app).put(`/api/recurring/${id}`).set("Cookie", cookie())
        .send({ confirmDenomination: true, expectedDefinition, amount: { amount: "11.00", currency: "ZMW" } }).expect(200);
      else await recurringService.updateRecurring(id, { amount: "11.00" }, actor(),
        { confirmDenomination: true, currency: "ZMW", ...{ expectedDefinition } });
      expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
      expect((await recurringService.processRecurring(a)).created).toBe(1);
    });
  }

  it.each(["account", "amount", "frequency"] as const)("refuses a stale recovery after an observed %s changes, without moving it back", async change => {
    const rule = await legacy(), expectedDefinition = await observedDefinition(rule.id);
    await db.update(recurringTransactions).set(change === "account" ? { accountId: ids.sharedAccount }
      : change === "amount" ? { amount: "9.50" } : { frequency: "weekly" }).where(eq(recurringTransactions.id, rule.id));
    const before = await financialState(rule.id), audits = await db.select().from(auditLogs).where(eq(auditLogs.householdId, a));
    await request(app).put(`/api/recurring/${rule.id}`).set("Cookie", cookie())
      .send({ confirmDenomination: true, expectedDefinition, amount: { amount: "19.50", currency: "ZMW" } }).expect(409);
    expect(await financialState(rule.id)).toEqual(before);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.householdId, a))).toEqual(audits);
  });

  it("requires an observed definition for recovery and labels a legacy DTO's unit as unknown", async () => {
    const rule = await legacy("USD"), before = await financialState(rule.id);
    await request(app).put(`/api/recurring/${rule.id}`).set("Cookie", cookie())
      .send({ confirmDenomination: true, amount: { amount: "19.50", currency: "ZMW" } }).expect(400);
    expect(await financialState(rule.id)).toEqual(before);
    const response = await request(app).get(`/api/recurring/${rule.id}`).set("Cookie", cookie()).expect(200);
    // Legacy MoneyDto compatibility is not currency proof. The mounted edit test
    // deliberately receives that old ZMW DTO and must still show an unknown unit.
    expect(response.body.data).toMatchObject({ verifiedCurrency: null, amount: { amount: "7.25" } });
    expect(response.body.data.definitionToken).toMatch(/^[a-f0-9]{64}$/);
  });

  async function pointerOnly(id: string) {
    const created = await request(app).post("/api/transactions").set("Cookie", cookie()).send({ accountId,
      date: due, name: "Signed direct pointer", type: "expense", amount: { amount: "1.25", currency: "ZMW" }, recurringTransactionId: id }).expect(201);
    const transactionId = created.body.data.transaction?.id ?? created.body.data.id;
    expect(transactionId).toBeTruthy();
    expect(await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, transactionId))).toHaveLength(0);
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, transactionId));
    return transactionId as string;
  }

  it("ignores an untrusted foreign-household reverse pointer without blocking the legitimate lifecycle or worker", async () => {
    const id = await createKnown();
    await db.update(transactions).set({ recurringTransactionId: id, isRecurring: true }).where(eq(transactions.id, ids.foreignTx));
    const foreign = await db.select().from(transactions).where(eq(transactions.id, ids.foreignTx));
    await request(app).get(`/api/recurring/${id}`).set("Cookie", cookie()).expect(200);
    await request(app).post(`/api/recurring/${id}/pause`).set("Cookie", cookie()).send({}).expect(200);
    await request(app).post(`/api/recurring/${id}/resume`).set("Cookie", cookie()).send({}).expect(200);
    expect((await recurringService.processRecurring(a)).created).toBe(1);
    expect(await db.select().from(transactions).where(eq(transactions.id, ids.foreignTx))).toEqual(foreign);
  });

  it("still protects a same-household private pointer when a foreign reverse pointer is also present", async () => {
    const id = await createKnown(); await pointerOnly(id);
    await db.update(transactions).set({ recurringTransactionId: id, isRecurring: true }).where(eq(transactions.id, ids.foreignTx));
    const before = await financialState(id), peer = actors.get("owner")!.cookie;
    await request(app).get(`/api/recurring/${id}`).set("Cookie", peer).expect(404);
    await request(app).post(`/api/recurring/${id}/pause`).set("Cookie", peer).send({}).expect(404);
    for (const dryRun of [true, false]) {
      const response = await request(app).post("/api/recurring/process").set("Cookie", peer).send({ dryRun }).expect(200);
      expect(response.body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
    }
    expect(await financialState(id)).toEqual(before);
  });

  it("keeps an actual normal-create private pointer out of a peer's rule reads, dry run and real process", async () => {
    const id = await createKnown(); await pointerOnly(id);
    const before = await financialState(id);
    await request(app).get(`/api/recurring/${id}`).set("Cookie", actors.get("owner")!.cookie).expect(404);
    for (const dryRun of [true, false]) {
      const response = await request(app).post("/api/recurring/process").set("Cookie", actors.get("owner")!.cookie).send({ dryRun }).expect(200);
      expect(response.body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
      expect(JSON.stringify(response.body)).not.toContain(id);
    }
    expect(await financialState(id)).toEqual(before);
  });

  it("carries direct-pointer privacy into the trusted worker's generated ledger row and peer rule visibility", async () => {
    const id = await createKnown(); await pointerOnly(id);
    expect((await recurringService.processRecurring(a)).created).toBe(1);
    const [row] = await db.select().from(transactions).where(and(eq(transactions.recurringTransactionId, id), eq(transactions.source, "recurring")));
    expect(row).toMatchObject({ isPrivate: true, ownerUserId: actors.get("member")!.id, currency: "ZMW" });
    await request(app).get(`/api/transactions/${row.id}`).set("Cookie", actors.get("member")!.cookie).expect(200);
    await request(app).get(`/api/transactions/${row.id}`).set("Cookie", actors.get("owner")!.cookie).expect(404);
    await request(app).get(`/api/recurring/${id}`).set("Cookie", actors.get("owner")!.cookie).expect(404);
  });

  it("waits on a direct-pointer source before signed processing and rechecks the changed privacy", async () => {
    const id = await createKnown(), sourceId = await pointerOnly(id), before = await financialState(id);
    await db.update(transactions).set({ isPrivate: false }).where(eq(transactions.id, sourceId));
    const blocker = await pool.connect(); let pending: Promise<request.Response> | undefined, waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [sourceId]);
      let settled = false;
      pending = request(app).post("/api/recurring/process").set("Cookie", actors.get("owner")!.cookie).send({}).timeout(10_000)
        .then(response => { settled = true; return response; });
      void pending.catch(() => { settled = true; });
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
    expect(await financialState(id)).toEqual(before);
  });
});
