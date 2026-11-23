import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, households, outboxEvents, recurringTransactions, securityAuditLogs, transactions } from "@shared/schema";
import { db } from "../../../db";
import type { TransactionFormValues } from "../../../../client/src/components/transactions/form/schema";
import {
  RECURRING_TRANSACTION_ENDPOINT, buildRecurringTransactionRequest,
} from "../../../../client/src/lib/recurringTransactionRequest";
import { a, actors, app, b, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// NEW-10: the exact request the Add Transaction form sends when "make
// recurring" is on, posted to the route the client uses, against real Postgres.
const formValues = (accountId: string): TransactionFormValues => ({
  type: "expense", amount: "12.35", merchantName: "Synthetic gym membership", date: new Date(2026, 10, 10), accountId,
  isRecurring: true, recurringFrequency: "monthly", recurringAmountType: "fixed", recurringAmountTolerance: 0,
  recurringReminderDays: 3, recurringReminderEmail: false, recurringReminderPush: false, recurringReminderInApp: true,
  recurringAutoLinkEnabled: true, recurringAutoMarkReviewed: false, recurringIsSubscription: false, tags: [],
});

describe("NEW-10 Add Transaction recurring request creates the rule and audits it", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await resetAccountsAndMembership();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
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

  it("accepts the form's body at the client's endpoint, then saves and audits the transaction and rule", async () => {
    const actor = actors.get("member")!;
    const idempotencyKey = randomUUID();
    const body = buildRecurringTransactionRequest(formValues(ids.sharedAccount), {
      name: "Synthetic gym membership", currency: "ZMW", idempotencyKey,
    });

    const response = await request(app).post(`/api${RECURRING_TRANSACTION_ENDPOINT}`)
      .set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a)
      .send(body);

    expect(response.status, JSON.stringify(response.body.error)).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { isDuplicate: false } });
    const { transaction, recurringRule } = response.body.data;
    expect(transaction.name).toMatch(/^synthetic gym membership$/i);
    const rules = await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a));
    expect(rules).toEqual([expect.objectContaining({
      // The server cleans the merchant name; the rule takes the posted transaction's name.
      id: recurringRule.id, accountId: ids.sharedAccount, name: transaction.name, amount: "12.35",
      type: "expense", frequency: "monthly", startDate: "2026-11-10", nextDueDate: "2026-12-10",
    })]);
    const ledger = await db.select().from(transactions).where(eq(transactions.householdId, a));
    expect(ledger).toEqual([expect.objectContaining({
      id: transaction.id, recurringTransactionId: recurringRule.id, idempotencyKey, date: "2026-11-10",
      amount: "12.35", currency: "ZMW",
    })]);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.householdId, a));
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "transaction", entityId: transaction.id, action: "CREATE", userId: actor.id }),
      expect.objectContaining({ entityType: "recurring_rule", entityId: recurringRule.id, action: "CREATE", userId: actor.id }),
    ]));
  });
});
