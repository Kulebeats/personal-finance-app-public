import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, categories, merchants, outboxEvents,
  recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const sourceAccountId = randomUUID(), destinationId = randomUUID(), oldRuleId = randomUUID();
const merchantId = randomUUID(), foreignMerchantId = randomUUID(), foreignCategoryId = randomUUID();
const sourceIds: string[] = [randomUUID(), randomUUID(), randomUUID()];
const seriesName = "CONFIRM_VISIBLE_MONTHLY_SERIES", privateMarker = "CONFIRM_OTHER_PARENT_SECRET";

function sourceDates() {
  const now = new Date();
  return [3, 2, 1].map(monthsBack =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 10)).toISOString().slice(0, 10));
}
function body() {
  const dates = sourceDates();
  const last = new Date(`${dates[2]}T00:00:00Z`);
  return {
    accountId: destinationId,
    pattern: {
      name: seriesName, type: "expense", merchantId, frequency: "monthly", dayOfMonth: 10,
      estimatedAmount: { amount: "7.25", currency: "ZMW" }, amountVariance: 0, confidence: 90,
      suggestedStartDate: dates[0],
      suggestedNextDueDate: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 10)).toISOString().slice(0, 10),
      sampleTransactionIds: [...sourceIds],
    },
  };
}
function confirm(viewer: Role | "outsider" = "member", payload = body()) {
  return request(app).post("/api/recurring/confirm").set("Cookie", actors.get(viewer)!.cookie).send(payload);
}
async function detect(viewer: Role) {
  const detected = await request(app).post("/api/recurring/detect")
    .set("Cookie", actors.get(viewer)!.cookie).send({}).expect(200);
  const pattern = detected.body.data.find((item: { name: string }) => item.name === seriesName);
  expect(pattern).toBeDefined();
  return pattern;
}
async function state() {
  const ownHouseholds = inArray(recurringTransactions.householdId, [a, b]);
  return {
    rules: await db.select().from(recurringTransactions).where(ownHouseholds).orderBy(recurringTransactions.id),
    links: await db.select({ link: recurringTransactionLinks }).from(recurringTransactionLinks)
      .innerJoin(recurringTransactions, eq(recurringTransactions.id, recurringTransactionLinks.recurringTransactionId))
      .where(ownHouseholds).orderBy(recurringTransactionLinks.id),
    history: await db.select({ history: recurringTransactionHistory }).from(recurringTransactionHistory)
      .innerJoin(recurringTransactions, eq(recurringTransactions.id, recurringTransactionHistory.recurringTransactionId))
      .where(ownHouseholds).orderBy(recurringTransactionHistory.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.householdId, [a, b])).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(inArray(outboxEvents.householdId, [a, b])).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.householdId, [a, b]));
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
  await db.delete(accounts).where(inArray(accounts.id, [sourceAccountId, destinationId]));
  await db.delete(merchants).where(inArray(merchants.id, [merchantId, foreignMerchantId]));
  await db.delete(categories).where(eq(categories.id, foreignCategoryId));
}
async function parent(kind: "hidden" | "foreign" | "visible") {
  await db.insert(recurringTransactions).values({
    id: oldRuleId, householdId: kind === "foreign" ? b : a,
    accountId: kind === "foreign" ? ids.foreignAccount : kind === "hidden" ? ids.privateAccount : ids.sharedAccount,
    name: privateMarker, amount: "44.44", type: "expense", frequency: "monthly",
    startDate: sourceDates()[0], nextDueDate: body().pattern.suggestedNextDueDate,
  });
}
// Leak checks ignore the error envelope's timestamp: "...T23:22:44.444Z" contains "44.44".
const bodyText = (body: unknown) => JSON.stringify(body, (key, value) => key === "timestamp" ? undefined : value);
function noPrivateDetails(response: request.Response) {
  expect(JSON.stringify(response.body)).not.toContain(privateMarker);
  expect(JSON.stringify(response.body)).not.toContain(oldRuleId);
  expect(bodyText(response.body)).not.toContain("44.44");
}

describe("R04 signed recurring confirmation is authorized, complete and atomic", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    const ownerUserId = actors.get("owner")!.id;
    await db.insert(accounts).values([
      { id: sourceAccountId, householdId: a, ownerUserId, name: "Confirm source account", type: "checking",
        currency: "ZMW", initialBalance: "1000.00", balance: "978.25", isPrivate: false },
      { id: destinationId, householdId: a, ownerUserId, name: "Confirm destination account", type: "checking",
        currency: "ZMW", initialBalance: "1000.00", balance: "1000.00", isPrivate: false },
    ]);
    await db.insert(merchants).values([
      { id: merchantId, householdId: a, name: "Confirm local merchant" },
      { id: foreignMerchantId, householdId: b, name: "Confirm foreign merchant" },
    ]);
    await db.insert(categories).values({ id: foreignCategoryId, householdId: b, name: "Confirm foreign category", displayOrder: 1 });
    await db.insert(transactions).values(sourceIds.map((id, index) => ({
      id, householdId: a, accountId: sourceAccountId, ownerUserId, merchantId, name: seriesName,
      date: sourceDates()[index], amount: "7.25", currency: "ZMW", type: "expense" as const,
      isPrivate: false, isPending: false, isRecurring: false,
    })));
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["view_only", "professional"] as const)("rejects a %s financial writer before any effects", async viewer => {
    const before = await state();
    await confirm(viewer).expect(403);
    expect(await state()).toEqual(before);
  });

  it("keeps an outsider out of the requested household", async () => {
    const before = await state();
    await confirm("outsider").expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["private", "foreign", "deleted", "absent"] as const)("conceals a %s destination without effects", async kind => {
    const payload = body();
    if (kind === "private") payload.accountId = ids.privateAccount;
    else if (kind === "foreign") payload.accountId = ids.foreignAccount;
    else if (kind === "absent") payload.accountId = randomUUID();
    else await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, destinationId));
    const before = await state();
    await confirm("member", payload).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["private account", "private transaction", "foreign transaction", "deleted transaction", "deleted account", "foreign account", "foreign merchant", "foreign category", "absent"] as const)(
    "refuses a %s contributor instead of partially confirming its visible siblings", async kind => {
      const payload = body();
      if (kind === "private account") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, sourceAccountId));
      else if (kind === "private transaction") await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, sourceIds[1]));
      else if (kind === "foreign transaction") payload.pattern.sampleTransactionIds[1] = ids.foreignTx;
      else if (kind === "deleted transaction") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, sourceIds[1]));
      else if (kind === "deleted account") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, sourceAccountId));
      else if (kind === "foreign account") await db.update(accounts).set({ householdId: b }).where(eq(accounts.id, sourceAccountId));
      else if (kind === "foreign merchant") await db.update(transactions).set({ merchantId: foreignMerchantId }).where(eq(transactions.id, sourceIds[1]));
      else if (kind === "foreign category") await db.update(transactions).set({ categoryId: foreignCategoryId }).where(eq(transactions.id, sourceIds[1]));
      else payload.pattern.sampleTransactionIds[1] = randomUUID();
      const before = await state();
      const denied = await confirm("member", payload).expect(404);
      expect(JSON.stringify(denied.body)).not.toContain(seriesName);
      expect(await state()).toEqual(before);
    },
  );

  it("refuses an explicitly foreign pattern merchant rather than copying its reference", async () => {
    const payload = body();
    payload.pattern.merchantId = foreignMerchantId;
    const before = await state();
    await confirm("member", payload).expect(404);
    expect(await state()).toEqual(before);
  });

  it.each(["empty", "duplicate"] as const)("rejects %s contributor IDs before creating a rule", async mode => {
    const payload = body();
    payload.pattern.sampleTransactionIds = mode === "empty" ? [] : [sourceIds[0], sourceIds[0], sourceIds[1]];
    const before = await state();
    await confirm("member", payload).expect(400);
    expect(await state()).toEqual(before);
  });

  for (const isRecurring of [true, false]) {
    it.each(["hidden", "foreign", "visible"] as const)(`preserves a %s direct parent when the source flag is ${isRecurring}`, async kind => {
      await parent(kind);
      await db.update(transactions).set({ isRecurring, recurringTransactionId: oldRuleId }).where(eq(transactions.id, sourceIds[1]));
      const before = await state();
      const response = await confirm();
      expect(response.status).toBe(kind === "visible" ? 409 : 404);
      noPrivateDetails(response);
      expect(await state()).toEqual(before);
    });
  }

  it.each(["hidden", "foreign", "visible"] as const)("preserves an existing %s link and its parent", async kind => {
    await parent(kind);
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: oldRuleId, transactionId: sourceIds[1] });
    const before = await state();
    const response = await confirm();
    expect(response.status).toBe(kind === "visible" ? 409 : 404);
    noPrivateDetails(response);
    expect(await state()).toEqual(before);
  });

  it.each(["link", "created history", "linked history", "audit"] as const)("rolls back the entire confirmation when %s persistence fails", async phase => {
    const payload = { accountId: destinationId, pattern: await detect("member") };
    let reachedFailure = false;
    let auditUsedTransaction = false;
    if (phase === "link") {
      const original = recurringRepository.createLink.bind(recurringRepository);
      vi.spyOn(recurringRepository, "createLink").mockImplementation(async (data, tx) => {
        if (data.transactionId === sourceIds[1]) { reachedFailure = true; throw new Error("Synthetic confirm link failure"); }
        return original(data, tx);
      });
    } else if (phase === "audit") {
      const writeAudit = businessAuditService.logCreate.bind(businessAuditService);
      vi.spyOn(businessAuditService, "logCreate").mockImplementationOnce(async params => {
        reachedFailure = true;
        auditUsedTransaction = params.tx !== undefined;
        await writeAudit(params); // Real INSERT must also disappear when the containing confirmation aborts.
        throw new Error("Synthetic confirm audit failure");
      });
    } else {
      const original = recurringRepository.logHistory.bind(recurringRepository);
      vi.spyOn(recurringRepository, "logHistory").mockImplementation(async (data, tx) => {
        if (data.action === (phase === "created history" ? "created" : "linked")) {
          reachedFailure = true;
          throw new Error("Synthetic confirm history failure");
        }
        return original(data, tx);
      });
    }
    const before = await state();
    const response = await confirm("member", payload);
    expect(reachedFailure).toBe(true);
    if (phase === "audit") expect(auditUsedTransaction).toBe(true);
    expect.soft(response.status).toBe(500);
    expect(await state()).toEqual(before);
  });

  it.each(["downgraded grant", "removed grant", "source transaction", "source account", "destination account"] as const)("waits for a concurrent %s change and denies the stale confirmation", async change => {
    const payload = { accountId: destinationId, pattern: await detect("member") }, before = await state(), blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "removed grant") {
        await blocker.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      } else if (change === "downgraded grant") {
        await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      } else if (change === "source transaction") {
        await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [sourceIds[1]]);
      } else {
        await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [change === "source account" ? sourceAccountId : destinationId]);
      }
      let settled = false;
      pending = confirm("member", payload).timeout(10_000).then(response => { settled = true; return response; });
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
    expect.soft(waiting).toBe(true);
    expect.soft((await pending!).status).toBe(change === "downgraded grant" ? 403 : 404);
    expect(await state()).toEqual({
      ...before,
      accounts: before.accounts.map(account =>
        account.id === (change === "source account" ? sourceAccountId : change === "destination account" ? destinationId : "")
          ? { ...account, isPrivate: true } : account),
      transactions: before.transactions.map(transaction => change === "source transaction" && transaction.id === sourceIds[1]
        ? { ...transaction, isPrivate: true } : transaction),
    });
  });

  it.each(["owner", "admin", "member"] as const)("preserves the full %s detect, confirm and readable-rule journey", async viewer => {
    const pattern = await detect(viewer);
    const before = await state();
    const auditWrite = vi.spyOn(businessAuditService, "logCreate"); // Passthrough: committed rows are checked below.
    const created = await confirm(viewer, { accountId: destinationId, pattern }).expect(201);
    const saved = await state();
    expect(saved.rules).toHaveLength(1);
    expect(saved.rules[0]).toMatchObject({ id: created.body.data.id, accountId: destinationId, detectionMethod: "suggested",
      amount: "7.25", totalOccurrences: 3, lastOccurredDate: sourceDates()[2], nextDueDate: body().pattern.suggestedNextDueDate });
    expect(saved.links.map(({ link }) => link.transactionId).sort()).toEqual([...sourceIds].sort());
    expect(saved.links.every(({ link }) => link.matchMethod === "confirmed")).toBe(true);
    expect(saved.transactions.filter(transaction => sourceIds.includes(transaction.id)).every(transaction =>
      transaction.isRecurring && transaction.recurringTransactionId === created.body.data.id)).toBe(true);
    expect(saved.accounts).toEqual(before.accounts);
    expect(saved.history.filter(({ history }) => history.action === "linked")).toHaveLength(3);
    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(auditWrite.mock.calls[0][0]).toMatchObject({ tx: expect.anything(), userId: actors.get(viewer)!.id,
      householdId: a, entityId: created.body.data.id, entityType: "recurring_rule" });
    expect(saved.audit.filter(row => row.entityId === created.body.data.id)).toEqual([expect.objectContaining({
      userId: actors.get(viewer)!.id, householdId: a, action: "CREATE", entityType: "recurring_rule",
      details: { newValue: { pattern: true, name: seriesName } },
    })]);
    expect(saved.audit).toHaveLength(before.audit.length + 1);
    expect.soft(created.body.data).toMatchObject({ totalOccurrences: 3, lastOccurredDate: sourceDates()[2] });
    // A 201 followed by a concealed rule is not acceptance of the advertised feature.
    await request(app).get(`/api/recurring/${created.body.data.id}`).set("Cookie", actors.get(viewer)!.cookie).expect(200);
  });

  it("retains the actor's own private source and destination without exposing the result to a peer", async () => {
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("member")!.id })
      .where(inArray(accounts.id, [sourceAccountId, destinationId]));
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(inArray(transactions.id, sourceIds));
    const before = await state();
    const created = await confirm("member", { accountId: destinationId, pattern: await detect("member") }).expect(201);
    expect((await state()).accounts).toEqual(before.accounts);
    await request(app).get(`/api/recurring/${created.body.data.id}`).set("Cookie", actors.get("member")!.cookie).expect(200);
    await request(app).get(`/api/recurring/${created.body.data.id}`).set("Cookie", actors.get("owner")!.cookie).expect(404);
  });
});
