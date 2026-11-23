import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accounts, auditLogs, households, outboxEvents, recurringTransactions, securityAuditLogs, transactions,
} from "@shared/schema";
import { db } from "../../../db";
import type { TransactionFormValues } from "../../../../client/src/components/transactions/form/schema";
import {
  RECURRING_TRANSACTION_ENDPOINT, buildRecurringTransactionRequest,
} from "../../../../client/src/lib/recurringTransactionRequest";
import { a, actors, app, b, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// A-45 / A-46: the Add Transaction form keeps one operation key across a lost
// reply. These tests replay that key against real Postgres over HTTP: the
// first request commits (its reply is "lost"), the retry carries the same key
// and must post nothing new; a deliberately new key must post again.
const savingsId = randomUUID();
const SHARED_OPENING = "988.89";
const SAVINGS_OPENING = "500.00";
const password = "SyntheticR04Tags123!";

const recurringForm = (accountId: string): TransactionFormValues => ({
  type: "expense", amount: "12.35", merchantName: "Synthetic gym membership", date: new Date(2026, 10, 10), accountId,
  isRecurring: true, recurringFrequency: "monthly", recurringAmountType: "fixed", recurringAmountTolerance: 0,
  recurringReminderDays: 3, recurringReminderEmail: false, recurringReminderPush: false, recurringReminderInApp: true,
  recurringAutoLinkEnabled: true, recurringAutoMarkReviewed: false, recurringIsSubscription: false, tags: [],
});
// The body the Add Transaction form sends for a same-currency transfer.
const transferBody = (idempotencyKey: string) => ({
  fromAccountId: ids.sharedAccount, toAccountId: savingsId, amount: { amount: "40.00", currency: "ZMW" },
  date: "2026-11-10", name: "Synthetic Savings Sweep", idempotencyKey,
});

const member = () => actors.get("member")!;
const signed = (req: request.Test) => req.set("Cookie", member().cookie)
  .set("X-Capital-Subject", member().id).set("X-Capital-Household", a);
const postRecurring = (body: object) => signed(request(app).post(`/api${RECURRING_TRANSACTION_ENDPOINT}`)).send(body);
const postTransfer = (body: object) => signed(request(app).post("/api/transactions/transfer")).send(body);

async function balances() {
  const rows = await db.select({ id: accounts.id, balance: accounts.balance, currency: accounts.currency })
    .from(accounts).where(inArray(accounts.id, [ids.sharedAccount, savingsId]));
  return Object.fromEntries(rows.map(row => [row.id, `${row.balance} ${row.currency}`]));
}
const ledger = () => db.select().from(transactions).where(eq(transactions.householdId, a));
const createAudits = (entityType: string) => db.select().from(auditLogs).where(and(
  eq(auditLogs.householdId, a), eq(auditLogs.entityType, entityType), eq(auditLogs.action, "CREATE"),
));

describe("A-45/A-46 Add Transaction retry after a lost reply posts once", () => {
  beforeAll(start, 60_000);
  beforeEach(async () => {
    await resetAccountsAndMembership();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(accounts).values({
      id: savingsId, householdId: a, name: "A46 SAVINGS", type: "savings", currency: "ZMW",
      initialBalance: SAVINGS_OPENING, balance: SAVINGS_OPENING, isPrivate: false, ownerUserId: member().id,
    });
  });
  afterEach(async () => {
    await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, [a, b]));
    await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.householdId, [a, b]));
  });
  afterAll(async () => {
    const actorIds = [...actors.values()].map(actor => actor.id);
    try {
      await stop();
    } finally {
      if (actorIds.length) await db.delete(securityAuditLogs).where(or(
        inArray(securityAuditLogs.userId, actorIds), inArray(securityAuditLogs.targetUserId, actorIds),
      ));
    }
  });

  it("A-45: a recurring expense replayed with its key debits once and keeps one active schedule; a new key posts again", async () => {
    const key = randomUUID();
    const body = buildRecurringTransactionRequest(recurringForm(ids.sharedAccount), {
      name: "Synthetic gym membership", currency: "ZMW", idempotencyKey: key,
    });

    const committed = await postRecurring(body);
    expect(committed.status, JSON.stringify(committed.body.error)).toBe(201);
    const { transaction, recurringRule } = committed.body.data;

    const retry = await postRecurring(body);
    expect(retry.status, JSON.stringify(retry.body.error)).toBe(201);
    expect(retry.body.data).toMatchObject({
      isDuplicate: true, transaction: { id: transaction.id }, recurringRule: { id: recurringRule.id },
    });

    expect(await ledger()).toEqual([expect.objectContaining({
      id: transaction.id, idempotencyKey: key, accountId: ids.sharedAccount, type: "expense",
      amount: "12.35", currency: "ZMW", recurringTransactionId: recurringRule.id,
    })]);
    expect(await balances()).toEqual({ [ids.sharedAccount]: "976.54 ZMW", [savingsId]: `${SAVINGS_OPENING} ZMW` });
    const rules = await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a));
    expect(rules).toEqual([expect.objectContaining({
      id: recurringRule.id, isActive: true, isPaused: false, amount: "12.35", accountId: ids.sharedAccount,
    })]);
    expect(await createAudits("transaction")).toEqual([expect.objectContaining({ entityId: transaction.id, userId: member().id })]);
    expect(await createAudits("recurring_rule")).toEqual([expect.objectContaining({ entityId: recurringRule.id, userId: member().id })]);

    // Positive control: the member really means a second, identical purchase.
    const anotherKey = randomUUID();
    const another = await postRecurring({ ...body, idempotencyKey: anotherKey });
    expect(another.status, JSON.stringify(another.body.error)).toBe(201);
    expect(another.body.data.isDuplicate).toBe(false);
    expect(another.body.data.transaction.id).not.toBe(transaction.id);

    expect((await ledger()).map(row => row.idempotencyKey).sort()).toEqual([key, anotherKey].sort());
    expect(await balances()).toEqual({ [ids.sharedAccount]: "964.19 ZMW", [savingsId]: `${SAVINGS_OPENING} ZMW` });
    const activeRules = await db.select().from(recurringTransactions)
      .where(and(eq(recurringTransactions.householdId, a), eq(recurringTransactions.isActive, true)));
    expect(activeRules).toHaveLength(2);
    expect(await createAudits("transaction")).toHaveLength(2);
    expect(await createAudits("recurring_rule")).toHaveLength(2);
  });

  it("A-46: a same-currency transfer replayed with its key moves money once; a new key posts a second pair", async () => {
    await signed(request(app).post("/api/settings/security/step-up")).send({ password }).expect(200);
    const key = randomUUID();

    const committed = await postTransfer(transferBody(key));
    expect(committed.status, JSON.stringify(committed.body.error)).toBe(201);
    const { outflow, inflow } = committed.body.data;

    const retry = await postTransfer(transferBody(key));
    expect(retry.status, JSON.stringify(retry.body.error)).toBe(200);
    expect(retry.body).toMatchObject({ isDuplicate: true, data: { outflow: { id: outflow.id }, inflow: { id: inflow.id } } });

    const legs = await ledger();
    expect(legs).toHaveLength(2);
    expect(legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: outflow.id, accountId: ids.sharedAccount, type: "transfer", isTransferIn: false,
        amount: "40.00", currency: "ZMW", idempotencyKey: key }),
      expect.objectContaining({ id: inflow.id, accountId: savingsId, type: "transfer", isTransferIn: true,
        amount: "40.00", currency: "ZMW" }),
    ]));
    expect(await balances()).toEqual({ [ids.sharedAccount]: "948.89 ZMW", [savingsId]: "540.00 ZMW" });
    const audited = (await createAudits("transaction")).map(row => row.entityId);
    expect(audited).toContain(outflow.id);
    const firstAuditCount = audited.length;

    // Positive control: a deliberately new, identical transfer.
    const anotherKey = randomUUID();
    const another = await postTransfer(transferBody(anotherKey));
    expect(another.status, JSON.stringify(another.body.error)).toBe(201);
    expect(another.body.isDuplicate).toBe(false);
    expect(another.body.data.outflow.id).not.toBe(outflow.id);

    expect(await ledger()).toHaveLength(4);
    expect(await balances()).toEqual({ [ids.sharedAccount]: "908.89 ZMW", [savingsId]: "580.00 ZMW" });
    expect(await createAudits("transaction")).toHaveLength(firstAuditCount * 2);
  });
});
