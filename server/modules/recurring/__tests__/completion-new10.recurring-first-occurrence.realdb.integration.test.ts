import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountBalanceSnapshots, accounts, auditLogs, households, outboxEvents, recurringTransactionHistory, recurringTransactionLinks,
  recurringTransactions, securityAuditLogs, transactionCreateOwnerIntents, transactions,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { DENOMINATION_ACTION, getVerifiedRecurringRuleCurrency } from "../../../services/recurring/RecurringDenomination";
import {
  a, actors, app, b, ids, resetAccountsAndMembership, start, stop,
} from "../../tags/__tests__/completion-r04.tags.fixture";

const date = "2026-11-10";
const beforeDue = "2026-11-11";
const firstDue = "2026-11-12";
const nextDue = "2026-11-14";
const amount = { amount: "12.35", currency: "ZMW" };
const cadence = { frequency: "custom", startDate: date, intervalValue: 2, intervalUnit: "days" };

function signedPost(path: string, body: object) {
  const actor = actors.get("member")!;
  return request(app).post(path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a).send(body);
}

async function setDestinationCurrency(householdCurrency: string, accountCurrency: string) {
  await db.update(households).set({ currency: householdCurrency }).where(eq(households.id, a));
  await db.update(accounts).set({ currency: accountCurrency }).where(eq(accounts.id, ids.sharedAccount));
}

function readEffects() {
  return db.transaction(async tx => {
    const ruleIds = tx.select({ id: recurringTransactions.id }).from(recurringTransactions)
      .where(eq(recurringTransactions.householdId, a));
    const ledgerIds = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, a));
    return {
      household: await tx.select({ currency: households.currency }).from(households).where(eq(households.id, a)),
      account: await tx.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)),
      snapshots: await tx.select().from(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.accountId, ids.sharedAccount))
        .orderBy(accountBalanceSnapshots.id),
      ledger: await tx.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.date),
      intents: await tx.select().from(transactionCreateOwnerIntents).where(inArray(transactionCreateOwnerIntents.transactionId, ledgerIds))
        .orderBy(transactionCreateOwnerIntents.transactionId),
      rules: await tx.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a)),
      links: await tx.select().from(recurringTransactionLinks)
        .where(inArray(recurringTransactionLinks.recurringTransactionId, ruleIds)).orderBy(recurringTransactionLinks.id),
      history: await tx.select().from(recurringTransactionHistory)
        .where(inArray(recurringTransactionHistory.recurringTransactionId, ruleIds)).orderBy(recurringTransactionHistory.id),
      audits: await tx.select().from(auditLogs).where(or(
        eq(auditLogs.householdId, a), inArray(auditLogs.userId, [...actors.values()].map(actor => actor.id)),
      )).orderBy(auditLogs.id),
      outbox: await tx.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

describe("NEW-10 signed recurring creation to trusted materialization", () => {
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

  it("posts the first due occurrence once from the cadence saved by the signed combined route", async () => {
    const key = randomUUID();
    const body = {
      accountId: ids.sharedAccount, name: "Synthetic recurring fare", type: "expense", date,
      amount, idempotencyKey: key, recurring: cadence,
    };
    const response = await signedPost("/api/recurring/transaction", body).expect(201);
    const { transaction, recurringRule } = response.body.data;
    expect(response.body).toMatchObject({ success: true, data: { isDuplicate: false,
      transaction: { idempotencyKey: key, recurringTransactionId: recurringRule.id },
      recurringRule: { nextDueDate: firstDue },
    } });
    const saved = await readEffects();
    expect(saved.account).toEqual([expect.objectContaining({ balance: "976.54" })]);
    expect(saved.ledger).toEqual([expect.objectContaining({
      id: transaction.id, recurringTransactionId: recurringRule.id, idempotencyKey: key, date,
      amount: "12.35", currency: "ZMW", postedBalanceDelta: "-12.35",
    })]);
    expect(saved.rules).toEqual([expect.objectContaining({
      id: recurringRule.id, frequency: "custom", intervalValue: 2, intervalUnit: "days",
      startDate: date, nextDueDate: firstDue, lastOccurredDate: date, totalOccurrences: 1,
    })]);
    expect(saved.links).toEqual([expect.objectContaining({ transactionId: transaction.id, matchMethod: "manual" })]);
    expect.soft(saved.history.filter(row => row.action === DENOMINATION_ACTION)).toEqual([expect.objectContaining({
      recurringTransactionId: recurringRule.id, performedBy: actors.get("member")!.id,
      newState: { version: 1, currency: "ZMW", amount: "12.35", accountId: ids.sharedAccount, source: "manual_creation" },
    })]);
    const replay = await signedPost("/api/recurring/transaction", body).expect(201);
    expect(replay.body.data).toMatchObject({
      isDuplicate: true, transaction: { id: transaction.id }, recurringRule: { id: recurringRule.id },
    });
    expect(await readEffects()).toEqual(saved);

    // This is the trusted service used by cron, with an explicit synthetic cutoff.
    expect(await recurringService.processRecurring(a, beforeDue)).toMatchObject({ processed: 0, created: 0, errors: [] });
    expect(await readEffects()).toEqual(saved);
    const due = await recurringService.processRecurring(a, firstDue);
    expect.soft(due).toMatchObject({ processed: 1, created: 1, errors: [] });

    const posted = await readEffects();
    if (due.created === 0) {
      expect(posted).toEqual(saved);
      expect(await recurringService.processRecurring(a, firstDue)).toEqual(due);
      expect(await readEffects()).toEqual(saved);
      return;
    }

    expect(posted.account).toEqual([expect.objectContaining({ balance: "964.19" })]);
    expect(posted.ledger).toEqual([saved.ledger[0], expect.objectContaining({
      recurringTransactionId: recurringRule.id, accountId: ids.sharedAccount, date: firstDue,
      amount: "12.35", currency: "ZMW", postedBalanceDelta: "-12.35", source: "recurring",
    })]);
    const occurrence = posted.ledger[1];
    expect(occurrence.id).not.toBe(transaction.id);
    expect(occurrence.idempotencyKey).toMatch(/^[0-9a-f-]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(posted.rules).toEqual([expect.objectContaining({
      id: recurringRule.id, nextDueDate: nextDue, lastOccurredDate: firstDue, totalOccurrences: 2,
    })]);
    expect(posted.links).toHaveLength(2);
    expect(posted.links).toContainEqual(saved.links[0]);
    expect(posted.links).toContainEqual(expect.objectContaining({
      recurringTransactionId: recurringRule.id, transactionId: occurrence.id, matchMethod: "auto",
      expectedDate: firstDue, actualDate: firstDue, expectedAmount: "12.35", actualAmount: "12.35",
    }));
    expect(posted.history.filter(row => row.action === "processed")).toEqual([expect.objectContaining({
      recurringTransactionId: recurringRule.id, linkedTransactionId: occurrence.id, newState: { nextDueDate: nextDue },
    })]);
    expect(posted.audits.filter(row => row.entityId === occurrence.id)).toEqual([expect.objectContaining({
      entityType: "transaction", action: "CREATE", userId: null,
      details: expect.objectContaining({ occurrenceDate: firstDue, idempotencyKey: occurrence.idempotencyKey }),
    })]);

    expect(await recurringService.processRecurring(a, firstDue)).toMatchObject({ processed: 0, created: 0, errors: [] });
    expect(await readEffects()).toEqual(posted);
  });

  it("requires an explicit signed denomination before fresh combined creation", async () => {
    const before = await readEffects();
    const response = await signedPost("/api/recurring/transaction", {
      accountId: ids.sharedAccount, name: "Synthetic missing unit", type: "expense", date,
      amount: { amount: "12.35" }, idempotencyKey: randomUUID(), recurring: cadence,
    }).expect(400);
    expect(response.body).toMatchObject({
      success: false, error: { code: "VALIDATION_ERROR", fields: expect.arrayContaining([
        expect.objectContaining({ field: "amount.currency" }),
      ]) },
    });
    expect(await readEffects()).toEqual(before);
  });

  it("materializes the same cadence when a signed standalone rule records explicit denomination", async () => {
    const response = await signedPost("/api/recurring", {
      accountId: ids.sharedAccount, name: "Synthetic standalone fare", type: "expense", amount,
      ...cadence, nextDueDate: firstDue,
    }).expect(201);
    const ruleId = response.body.data.id as string;
    expect(await getVerifiedRecurringRuleCurrency(ruleId, a)).toBe("ZMW");
    const saved = await readEffects();
    expect(saved.account[0].balance).toBe("988.89");
    expect(saved.ledger).toEqual([]);
    expect(saved.history.filter(row => row.action === DENOMINATION_ACTION)).toEqual([expect.objectContaining({
      recurringTransactionId: ruleId, performedBy: actors.get("member")!.id,
      newState: { version: 1, currency: "ZMW", amount: "12.35", accountId: ids.sharedAccount, source: "manual_creation" },
    })]);
    expect(await recurringService.processRecurring(a, firstDue)).toMatchObject({ processed: 1, created: 1, errors: [] });
    const posted = await readEffects();
    expect(posted.account[0].balance).toBe("976.54");
    expect(posted.ledger).toEqual([expect.objectContaining({
      recurringTransactionId: ruleId, accountId: ids.sharedAccount, date: firstDue,
      amount: "12.35", currency: "ZMW", postedBalanceDelta: "-12.35", source: "recurring",
    })]);
    expect(posted.rules).toEqual([expect.objectContaining({ id: ruleId, nextDueDate: nextDue })]);
  });

  it("rolls back a signed combined posting when its denomination receipt cannot commit", async () => {
    const key = randomUUID();
    const fault = `new10_denomination_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const witness = `${fault}_reached`;
    const body = { accountId: ids.sharedAccount, name: "Synthetic receipt rollback", type: "expense", date,
      amount, idempotencyKey: key, recurring: cadence };
    const before = await readEffects();
    // The deferred fault only affects the receipt bound to this signed posting.
    // A sequence records that the matching posting and receipt reached commit.
    await pool.query(`
      CREATE SEQUENCE public.${witness};
      CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.household_id = '${a}'::uuid
          AND t.idempotency_key = '${key}'::uuid AND t.recurring_transaction_id = NEW.recurring_transaction_id) THEN
          PERFORM nextval('public.${witness}');
          RAISE EXCEPTION 'Synthetic recurring denomination receipt failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON public.recurring_transaction_history
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        WHEN (NEW.action = '${DENOMINATION_ACTION}') EXECUTE FUNCTION public.${fault}();
    `);
    try {
      const response = await signedPost("/api/recurring/transaction", body);
      const { rows: [marker] } = await pool.query<{ is_called: boolean }>(`SELECT is_called FROM public.${witness}`);
      expect.soft(response.status).toBe(500);
      expect.soft(marker.is_called).toBe(true);
      const after = await readEffects();
      expect.soft(after.account[0].balance).toBe(before.account[0].balance);
      expect.soft(after.ledger).toHaveLength(before.ledger.length);
      expect.soft(after.rules).toHaveLength(before.rules.length);
      if (response.status === 500) expect(after).toEqual(before);
    } finally {
      await pool.query(`
        DROP TRIGGER ${fault} ON public.recurring_transaction_history;
        DROP FUNCTION public.${fault}();
        DROP SEQUENCE public.${witness};
      `);
    }
    const retry = await signedPost("/api/recurring/transaction", body).expect(201);
    const { transaction, recurringRule } = retry.body.data;
    expect(retry.body.data.isDuplicate).toBe(false);
    const recovered = await readEffects();
    expect(recovered.account).toEqual([expect.objectContaining({ balance: "976.54" })]);
    expect(recovered.ledger).toEqual([expect.objectContaining({ id: transaction.id, idempotencyKey: key, amount: "12.35" })]);
    expect(recovered.rules).toEqual([expect.objectContaining({ id: recurringRule.id })]);
    expect(recovered.history.filter(row => row.action === DENOMINATION_ACTION)).toEqual([expect.objectContaining({
      recurringTransactionId: recurringRule.id, performedBy: actors.get("member")!.id,
      newState: { version: 1, currency: "ZMW", amount: "12.35", accountId: ids.sharedAccount, source: "manual_creation" },
    })]);
    const replay = await signedPost("/api/recurring/transaction", body).expect(201);
    expect(replay.body.data).toMatchObject({
      isDuplicate: true, transaction: { id: transaction.id }, recurringRule: { id: recurringRule.id },
    });
    expect(await readEffects()).toEqual(recovered);
  });

  const ineligibleUnits = [
    { label: "aligned USD", household: "USD", account: "USD", request: "USD" },
    { label: "ZMW destination in a USD household", household: "USD", account: "ZMW", request: "ZMW" },
    { label: "USD request against a ZMW destination", household: "ZMW", account: "ZMW", request: "USD" },
  ];

  for (const scenario of ineligibleUnits) {
    it(`rejects ${scenario.label} before writing either signed recurring creation`, async () => {
      await setDestinationCurrency(scenario.household, scenario.account);
      const common = {
        accountId: ids.sharedAccount, name: "Synthetic ineligible recurring fare", type: "expense",
        amount: { amount: "12.35", currency: scenario.request },
      };
      const before = await readEffects();
      expect(before.household).toEqual([{ currency: scenario.household }]);
      expect(before.account).toEqual([expect.objectContaining({ currency: scenario.account, balance: "988.89" })]);
      const standalone = await signedPost("/api/recurring", { ...common, ...cadence, nextDueDate: firstDue }).expect(400);
      expect(standalone.body).toMatchObject({ success: false, error: {
        code: "VALIDATION_ERROR", message: expect.stringMatching(/denomination|currency/i),
      } });
      expect(await readEffects()).toEqual(before);

      const combined = await signedPost("/api/recurring/transaction", {
        ...common, date, idempotencyKey: randomUUID(), recurring: cadence,
      });
      expect.soft(combined.status).toBe(400);
      expect.soft(combined.body).toMatchObject({ success: false, error: {
        code: "VALIDATION_ERROR", message: expect.stringMatching(/denomination|currency/i),
      } });
      const after = await readEffects();
      expect.soft(after.account[0].balance).toBe(before.account[0].balance);
      expect.soft(after.ledger).toHaveLength(before.ledger.length);
      expect.soft(after.rules).toHaveLength(before.rules.length);
      if (combined.status === 400) expect(after).toEqual(before);
    });
  }

  it("still posts an ordinary signed USD expense to the matching native account", async () => {
    await setDestinationCurrency("USD", "USD");
    const key = randomUUID();
    const response = await signedPost("/api/transactions", {
      accountId: ids.sharedAccount, name: "Synthetic ordinary USD fare", type: "expense", date,
      amount: { amount: "12.35", currency: "USD" }, idempotencyKey: key,
    }).expect(201);
    const posted = await readEffects();
    expect(posted.household).toEqual([{ currency: "USD" }]);
    expect(posted.account).toEqual([expect.objectContaining({ balance: "976.54", currency: "USD" })]);
    expect(posted.ledger).toEqual([expect.objectContaining({
      id: response.body.data.id, accountId: ids.sharedAccount, idempotencyKey: key,
      amount: "12.35", currency: "USD", postedBalanceDelta: "-12.35",
    })]);
    expect(posted.rules).toEqual([]);
    expect(posted.links).toEqual([]);
  });

  for (const { label, currency } of [
    { label: "unknown", currency: null },
    { label: "historical USD", currency: "USD" },
  ]) {
    it(`keeps the linked legacy ${label} amount unproven after signed from-existing creation`, async () => {
      const sourceId = randomUUID();
      const actor = actors.get("member")!;
      await db.insert(transactions).values({
        id: sourceId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actor.id,
        name: "Synthetic legacy linked fare", type: "expense", date, amount: "12.35", currency,
        isRecurring: false, isPrivate: false, postingMode: null, postedAccountIsAsset: null, postedBalanceDelta: null,
      });
      const before = await readEffects();
      expect(before.household).toEqual([{ currency: "ZMW" }]);
      expect(before.account).toEqual([expect.objectContaining({ currency: "ZMW", balance: "988.89" })]);
      expect(before.ledger).toEqual([expect.objectContaining({
        id: sourceId, currency, amount: "12.35", postingMode: null, postedBalanceDelta: null, postedAccountIsAsset: null,
      })]);

      const linked = await signedPost(`/api/recurring/transaction/${sourceId}`, cadence).expect(200);
      const ruleId = linked.body.data.recurringRule.id as string;
      expect(linked.body).toMatchObject({ success: true, data: { isDuplicate: false,
        transaction: { id: sourceId, recurringTransactionId: ruleId }, recurringRule: { nextDueDate: firstDue },
      } });
      const saved = await readEffects();
      expect(saved).toMatchObject({
        household: before.household, account: before.account, snapshots: before.snapshots,
        intents: before.intents, outbox: before.outbox,
      });
      expect(saved.ledger).toEqual([{ ...before.ledger[0], updatedAt: expect.any(Date),
        isRecurring: true, recurringTransactionId: ruleId }]);
      expect(saved.links).toEqual([expect.objectContaining({
        recurringTransactionId: ruleId, transactionId: sourceId, matchMethod: "manual",
      })]);
      expect(saved.history.filter(row => row.action === DENOMINATION_ACTION)).toEqual([]);
      expect(await getVerifiedRecurringRuleCurrency(ruleId, a)).toBeNull();
      const detail = await request(app).get(`/api/recurring/${ruleId}`).set("Cookie", actor.cookie)
        .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a).expect(200);
      expect(detail.body.data).toMatchObject({ id: ruleId, verifiedCurrency: null, amount: { amount: "12.35" } });

      expect(await recurringService.processRecurring(a, firstDue)).toMatchObject({
        processed: 1, created: 0,
        errors: [{ ruleId, error: expect.stringMatching(/denomination is unproven/i) }],
      });
      expect(await readEffects()).toEqual(saved);
    });
  }

  for (const mode of ["unchanged", "changed to USD"] as const) {
    it(`uses the committed household currency after a signed combined lock wait when it is ${mode}`, async () => {
      const before = await readEffects();
      expect(before.household).toEqual([{ currency: "ZMW" }]);
      expect(before.account).toEqual([expect.objectContaining({ currency: "ZMW", balance: "988.89" })]);
      const key = randomUUID();
      const body = {
        accountId: ids.sharedAccount, name: "Synthetic locked recurring fare", type: "expense", date,
        amount, idempotencyKey: key, recurring: cadence,
      };
      const blocker = await pool.connect();
      let pending: Promise<request.Response> | undefined;
      let waiterPid: number | undefined;
      try {
        await blocker.query("BEGIN");
        const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        await blocker.query("SELECT id FROM accounts WHERE id=$1 AND household_id=$2 FOR UPDATE", [ids.sharedAccount, a]);
        await blocker.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [a]);
        let settled = false;
        pending = signedPost("/api/recurring/transaction", body).timeout(12_000)
          .then(response => { settled = true; return response; });
        void pending.catch(() => { settled = true; });
        const deadline = Date.now() + 5_000;
        while (waiterPid === undefined && !settled && Date.now() < deadline) {
          const { rows } = await pool.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
            WHERE datname=current_database() AND backend_type='client backend' AND state='active'
              AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, [pid]);
          expect(rows.length).toBeLessThanOrEqual(1);
          waiterPid = rows[0]?.pid;
          if (waiterPid === undefined) await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (mode === "changed to USD") {
          await blocker.query("UPDATE households SET currency='USD' WHERE id=$1", [a]);
        }
        await blocker.query("COMMIT");
      } finally {
        let rollbackFailed = true;
        try {
          await blocker.query("ROLLBACK");
          rollbackFailed = false;
        } finally {
          try { blocker.release(rollbackFailed); } finally {
            if (pending) await Promise.allSettled([pending]);
          }
        }
      }
      expect(waiterPid).toEqual(expect.any(Number));
      const response = await pending!;
      const after = await readEffects();
      if (mode === "unchanged") {
        expect(response.status).toBe(201);
        expect(after.household).toEqual(before.household);
        expect(after.account[0].balance).toBe("976.54");
        expect(after.ledger).toEqual([expect.objectContaining({ idempotencyKey: key, currency: "ZMW", amount: "12.35" })]);
        expect(after.rules).toEqual([expect.objectContaining({ nextDueDate: firstDue })]);
        return;
      }

      expect(after.household).toEqual([{ currency: "USD" }]);
      expect.soft([400, 409]).toContain(response.status);
      if (response.status === 400) expect(response.body.error).toMatchObject({
        code: "VALIDATION_ERROR", message: expect.stringMatching(/denomination|currency/i),
      });
      if (response.status === 409) expect(response.body.error).toMatchObject({ code: "CONFLICT" });
      expect.soft(after.account[0].balance).toBe(before.account[0].balance);
      expect.soft(after.ledger).toHaveLength(before.ledger.length);
      expect.soft(after.rules).toHaveLength(before.rules.length);
      if (response.status !== 201) expect(after).toEqual({ ...before, household: [{ currency: "USD" }] });

      const retry = await signedPost("/api/recurring/transaction", body).timeout(12_000);
      expect.soft(retry.status).toBe(400);
      expect.soft(retry.body.error).toMatchObject({
        code: "VALIDATION_ERROR", message: expect.stringMatching(/denomination|currency/i),
      });
      expect(await readEffects()).toEqual(after);
    });
  }
});
