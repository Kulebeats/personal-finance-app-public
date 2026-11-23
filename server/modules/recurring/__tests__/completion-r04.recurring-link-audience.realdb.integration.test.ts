import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, categories, merchants, outboxEvents, recurringTransactionHistory,
  recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { patternDetectionService } from "../../../services/PatternDetectionService";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID(), otherRuleId = randomUUID(), candidateId = randomUUID(), sourceAccountId = randomUUID();
const categoryId = randomUUID(), merchantId = randomUUID();
const privateOrigins = ["current account", "linked account", "linked transaction", "historical account", "historical transaction", "suggested"] as const;
type Origin = "shared" | typeof privateOrigins[number];

// Leak checks ignore the error envelope's timestamp: "...T23:22:44.444Z" contains "44.44".
const bodyText = (body: unknown) => JSON.stringify(body, (key, value) => key === "timestamp" ? undefined : value);
function link(viewer: Role, id = ruleId, transactionId = candidateId) {
  return request(app).post(`/api/recurring/${id}/link`)
    .set("Cookie", actors.get(viewer)!.cookie).send({ transactionId });
}
async function seed(origin: Origin = "shared") {
  await db.insert(recurringTransactions).values({
    id: ruleId, householdId: a, accountId: origin === "current account" ? ids.privateAccount : ids.sharedAccount,
    name: "LINK_RULE_SECRET", amount: "12.34", type: "expense", frequency: "monthly",
    startDate: "2026-11-01", nextDueDate: "2026-12-01", detectionMethod: origin === "suggested" ? "suggested" : "manual",
  });
  if (origin === "linked account") {
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.privateTx });
  } else if (origin === "linked transaction" || origin === "historical transaction") {
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, ids.sharedTx));
    if (origin === "linked transaction") {
      await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.sharedTx });
    } else {
      await db.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleId, action: "unlinked", linkedTransactionId: ids.sharedTx });
    }
  } else if (origin === "historical account") {
    await db.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleId, action: "updated",
      previousState: { accountId: ids.privateAccount }, newState: { accountId: ids.sharedAccount } });
  }
}
async function state() {
  return {
    rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleId)),
    links: await db.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, [ruleId, otherRuleId])).orderBy(recurringTransactionLinks.id),
    history: await db.select().from(recurringTransactionHistory).where(eq(recurringTransactionHistory.recurringTransactionId, ruleId)).orderBy(recurringTransactionHistory.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.entityId, ruleId)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [ruleId, otherRuleId]));
  await db.delete(transactions).where(eq(transactions.id, candidateId));
  await db.delete(accounts).where(eq(accounts.id, sourceAccountId));
  await db.delete(auditLogs).where(eq(auditLogs.entityId, ruleId));
  await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, ruleId));
  await db.delete(categories).where(eq(categories.id, categoryId));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
}

describe("signed recurring POST link uses the full live rule and source audience", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(accounts).values({ id: sourceAccountId, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: "Link source account", type: "checking", currency: "ZMW", initialBalance: "1000.00", balance: "992.75" });
    await db.insert(transactions).values({ id: candidateId, householdId: a, accountId: sourceAccountId,
      ownerUserId: actors.get("owner")!.id, date: "2026-11-02", name: "LINK_SOURCE_SECRET", amount: "7.25", type: "expense", isPrivate: false });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(privateOrigins)("conceals a rule with %s provenance from member and admin without changes", async origin => {
    await seed(origin);
    const before = await state();
    for (const viewer of ["member", "admin"] as const) {
      const absent = await link(viewer, randomUUID()).expect(404);
      const denied = await link(viewer).expect(404);
      expect(denied.body.error).toMatchObject({ code: absent.body.error.code, message: absent.body.error.message });
      expect(denied.body.error.message).toBe("Recurring rule not found");
      expect(denied.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: absent.body.error.message,
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) } });
    }
    expect(await state()).toEqual(before);
  });

  it("withholds current foreign category and merchant references", async () => {
    await seed();
    await db.insert(categories).values({ id: categoryId, householdId: b, name: "Foreign link category", displayOrder: 1 });
    await db.insert(merchants).values({ id: merchantId, householdId: b, name: "Foreign link merchant" });
    for (const reference of [{ categoryId, merchantId: null }, { categoryId: null, merchantId }]) {
      await db.update(recurringTransactions).set(reference).where(eq(recurringTransactions.id, ruleId));
      const before = await state();
      await link("member").expect(404);
      expect(await state()).toEqual(before);
    }
  });

  it("keeps account AND transaction source privacy, including an owner reading a peer's private source", async () => {
    await seed();
    let before = await state();
    await link("member", ruleId, ids.privateTx).expect(404); // Explicitly public flag under a private account.
    await link("member", ruleId, ids.foreignTx).expect(404);
    expect(await state()).toEqual(before);
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, candidateId));
    before = await state();
    await link("owner").expect(404);
    expect(await state()).toEqual(before);
    await link("member").expect(200);
  });

  it("rejects read-only financial roles without changing a visible rule or source", async () => {
    await seed();
    const before = await state();
    for (const viewer of ["view_only", "professional"] as const) await link(viewer).expect(403);
    expect(await state()).toEqual(before);
  });

  it.each(["shared", "current account"] as const)("preserves an authorized %s link, dates, pointer and accounting amounts", async origin => {
    await seed(origin);
    const viewer = origin === "shared" ? "admin" : "owner";
    const before = await state();
    const response = await link(viewer).expect(200);
    // FIN-05: seeded without a currency / denomination receipt, so the unit is unknown (null), never a default ZMW.
    expect(response.body.data).toMatchObject({ recurringTransactionId: ruleId, transactionId: candidateId,
      actualAmount: { amount: "7.25", currency: null }, expectedAmount: { amount: "12.34", currency: null } });
    const after = await state();
    expect(after.links).toHaveLength(1);
    expect(after.rules[0]).toMatchObject({ totalOccurrences: 1, lastOccurredDate: "2026-11-02", nextDueDate: "2026-12-01" });
    expect(after.transactions.find(transaction => transaction.id === candidateId)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleId, amount: "7.25" });
    expect(after.accounts.map(account => account.balance)).toEqual(before.accounts.map(account => account.balance));
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ action: "linked", linkedTransactionId: candidateId });
    expect(after.audit).toHaveLength(1);
  });

  it.each(["membership downgrade", "source transaction privacy", "source account privacy", "historical account privacy"] as const)("rechecks after concurrent %s commits", async change => {
    await seed(change === "historical account privacy" ? "historical account" : "shared");
    if (change === "historical account privacy") await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "membership downgrade") {
        await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      } else if (change === "source transaction privacy") {
        await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [candidateId]);
      } else {
        await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [change === "source account privacy" ? sourceAccountId : ids.privateAccount]);
      }
      let settled = false;
      pending = link("member").timeout(10_000).then(response => { settled = true; return response; });
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
    expect((await pending!).status).toBe(change === "membership downgrade" ? 403 : 404);
    const privateAccountId = change === "source account privacy" ? sourceAccountId : change === "historical account privacy" ? ids.privateAccount : undefined;
    expect(await state()).toEqual({
      ...before,
      accounts: before.accounts.map(account => account.id === privateAccountId ? { ...account, isPrivate: true } : account),
      transactions: before.transactions.map(transaction => change === "source transaction privacy" && transaction.id === candidateId ? { ...transaction, isPrivate: true } : transaction),
    });
  });

  it.each(["shared", "assigned", "hidden rule"] as const)("matches using the signed creator for %s ownership", async scenario => {
    await seed("current account");
    const name = "Cedar rent", date = "2026-11-30";
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Recurring rent", displayOrder: 1 });
    await db.update(recurringTransactions).set({ name, categoryId, autoLinkEnabled: true }).where(eq(recurringTransactions.id, ruleId));
    const signer = actors.get(scenario === "hidden rule" ? "member" : "owner")!;
    const selected = scenario === "shared" ? null : actors.get(scenario === "hidden rule" ? "owner" : "member")!.id;
    const posted = await request(app).post("/api/transactions").set("Cookie", signer.cookie).send({
      name, date, accountId: scenario === "hidden rule" ? ids.sharedAccount : ids.privateAccount,
      type: "expense", categoryId, amount: { amount: "12.34", currency: "ZMW" }, ownerUserId: selected,
    }).expect(201);
    const [stored] = await db.select().from(transactions).where(eq(transactions.id, posted.body.data.id));
    expect(stored.ownerUserId).toBe(selected);
    const match = await patternDetectionService.matchTransaction(stored, a);
    expect(match?.rule.id).toBe(ruleId);
    const links = await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, stored.id));
    if (scenario === "hidden rule") {
      expect(links).toEqual([]);
      expect(stored.recurringTransactionId).toBeNull();
    } else {
      expect(links).toMatchObject([{ recurringTransactionId: ruleId, matchMethod: "auto" }]);
      expect(stored.recurringTransactionId).toBe(ruleId);
    }
  });

  it("preserves the trusted automatic linker for an existing suggested rule", async () => {
    await seed("suggested");
    const [rule] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, ruleId));
    const [source] = await db.select().from(transactions).where(eq(transactions.id, candidateId));
    const match = vi.spyOn(patternDetectionService, "matchTransaction").mockResolvedValue({ rule, confidence: 91, matchReasons: ["owned synthetic auto candidate"] });
    try { await recurringService.autoLinkNewTransaction(source, a); }
    finally { match.mockRestore(); }
    const after = await state();
    expect(after.links).toMatchObject([{ recurringTransactionId: ruleId, transactionId: candidateId, matchMethod: "auto", matchConfidence: 91 }]);
    expect(after.transactions.find(transaction => transaction.id === candidateId)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleId });
  });

  for (const isRecurring of [true, false]) {
    it.each(["hidden", "foreign", "visible"] as const)(`does not replace a %s direct parent when the old recurring flag is ${isRecurring}`, async kind => {
      await seed();
      await db.insert(recurringTransactions).values({
        id: otherRuleId, householdId: kind === "foreign" ? b : a,
        accountId: kind === "foreign" ? ids.foreignAccount : kind === "hidden" ? ids.privateAccount : ids.sharedAccount,
        name: "OTHER_PARENT_SECRET", amount: "44.44", type: "expense", frequency: "monthly",
        startDate: "2026-11-01", nextDueDate: "2026-12-01",
      });
      await db.update(transactions).set({ isRecurring, recurringTransactionId: otherRuleId }).where(eq(transactions.id, candidateId));
      const before = await state();
      const response = await link("member");
      expect(response.status).toBe(kind === "visible" ? 409 : 404);
      expect(bodyText(response.body)).not.toMatch(/OTHER_PARENT_SECRET|44\.44/);
      expect(JSON.stringify(response.body)).not.toContain(otherRuleId);
      expect(await state()).toEqual(before);
    });

    it(`keeps a same-parent direct pointer and repeat valid when the old recurring flag is ${isRecurring}`, async () => {
      await seed();
      await db.update(transactions).set({ isRecurring, recurringTransactionId: ruleId }).where(eq(transactions.id, candidateId));
      const created = await link("member").expect(200);
      const repeated = await link("member").expect(200);
      expect(repeated.body.data.id).toBe(created.body.data.id);
      const after = await state();
      expect(after.links).toHaveLength(1);
      expect(after.history).toHaveLength(1);
      expect(after.rules[0].totalOccurrences).toBe(1);
      expect(after.transactions.find(transaction => transaction.id === candidateId)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleId });
    });
  }

  it.each(["hidden", "foreign", "visible"] as const)("does not reveal or replace a %s parent through an existing link row", async kind => {
    await seed();
    await db.insert(recurringTransactions).values({
      id: otherRuleId, householdId: kind === "foreign" ? b : a,
      accountId: kind === "foreign" ? ids.foreignAccount : kind === "hidden" ? ids.privateAccount : ids.sharedAccount,
      name: "OTHER_PARENT_SECRET", amount: "44.44", type: "expense", frequency: "monthly",
      startDate: "2026-11-01", nextDueDate: "2026-12-01",
    });
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: otherRuleId, transactionId: candidateId });
    const before = await state();
    const response = await link("member");
    expect(response.status).toBe(kind === "visible" ? 409 : 404);
    expect(JSON.stringify(response.body)).not.toContain(otherRuleId);
    expect(await state()).toEqual(before);
  });

  it("rejects an unexplained recurring flag with no parent pointer or link", async () => {
    await seed();
    await db.update(transactions).set({ isRecurring: true, recurringTransactionId: null }).where(eq(transactions.id, candidateId));
    const before = await state();
    await link("member").expect(409);
    expect(await state()).toEqual(before);
  });
});
