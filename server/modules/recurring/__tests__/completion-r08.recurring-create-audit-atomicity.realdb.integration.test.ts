import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accounts, auditLogs, categories, outboxEvents, recurringTransactionHistory, recurringTransactionLinks,
  recurringTransactions, securityAuditLogs, transactionCreateOwnerIntents, transactions, transactionSplits,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { goalAccountAssignmentService } from "../../../services/GoalAccountAssignmentService";
import { recurringService } from "../../../services/RecurringService";
import { DENOMINATION_ACTION } from "../../../services/recurring/RecurringDenomination";
import { getPostgresError } from "../../../utils/postgresError";
import { createRecurringFromTransactionSchema } from "../recurring.validation";
import { a, b, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const householdIds = [a, b];
const fareCategoryId = randomUUID();
const feeCategoryId = randomUUID();
const categoryIds = [fareCategoryId, feeCategoryId];
const date = "2026-08-31";
const amount = { amount: "12.35", currency: "ZMW" };
const shared = { role: "member", accountId: ids.sharedAccount, balance: "976.54", auditHousehold: a } as const;
const privateAccount = { role: "owner", accountId: ids.privateAccount, balance: "4209.88", auditHousehold: null } as const;
type Target = typeof shared | typeof privateAccount;
type Fault = "transaction audit" | "transaction outbox" | "rule audit";

function payload(target: Target) {
  return {
    accountId: target.accountId,
    type: "expense",
    name: "Monthly Fare",
    date,
    amount,
    idempotencyKey: randomUUID(),
    splits: [
      { categoryId: fareCategoryId, amount: { amount: "5.00", currency: "ZMW" } },
      { categoryId: feeCategoryId, amount: { amount: "7.35", currency: "ZMW" } },
    ],
    recurring: { frequency: "monthly", startDate: date, endDate: "2026-12-31", reminderDays: 4 },
  };
}

function post(target: Target, body: ReturnType<typeof payload>) {
  const actor = actors.get(target.role)!;
  return request(app).post("/api/recurring/transaction")
    .set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id)
    .set("X-Capital-Household", a)
    .send(body);
}

function auditScope() {
  return or(
    inArray(auditLogs.householdId, householdIds),
    inArray(auditLogs.userId, Array.from(actors.values(), ({ id }) => id)),
  );
}

function outboxScope(aggregateIds: string[]) {
  return or(inArray(outboxEvents.householdId, householdIds), inArray(outboxEvents.aggregateId, aggregateIds));
}

async function readState() {
  const ledger = await db.select().from(transactions)
    .where(inArray(transactions.householdId, householdIds)).orderBy(transactions.id);
  const rules = await db.select().from(recurringTransactions)
    .where(inArray(recurringTransactions.householdId, householdIds)).orderBy(recurringTransactions.id);
  const transactionIds = ledger.map(row => row.id);
  const ruleIds = rules.map(row => row.id);
  return {
    ledger, rules,
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, householdIds)).orderBy(accounts.id),
    categories: await db.select().from(categories).where(inArray(categories.id, categoryIds)).orderBy(categories.id),
    splits: await db.select().from(transactionSplits)
      .where(or(inArray(transactionSplits.transactionId, transactionIds), inArray(transactionSplits.categoryId, categoryIds)))
      .orderBy(transactionSplits.id),
    intents: await db.select().from(transactionCreateOwnerIntents)
      .where(or(inArray(transactionCreateOwnerIntents.householdId, householdIds),
        inArray(transactionCreateOwnerIntents.transactionId, transactionIds)))
      .orderBy(transactionCreateOwnerIntents.transactionId),
    links: await db.select().from(recurringTransactionLinks)
      .where(or(inArray(recurringTransactionLinks.recurringTransactionId, ruleIds),
        inArray(recurringTransactionLinks.transactionId, transactionIds)))
      .orderBy(recurringTransactionLinks.id),
    history: await db.select().from(recurringTransactionHistory)
      .where(or(inArray(recurringTransactionHistory.recurringTransactionId, ruleIds),
        inArray(recurringTransactionHistory.linkedTransactionId, transactionIds)))
      .orderBy(recurringTransactionHistory.id),
    audits: await db.select().from(auditLogs).where(auditScope()).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(outboxScope([...transactionIds, ...ruleIds])).orderBy(outboxEvents.id),
  };
}

async function expectOnePostingAndReplay(target: Target, body: ReturnType<typeof payload>) {
  const userId = actors.get(target.role)!.id;
  const before = await readState();
  const result = await post(target, body).expect(201);
  const { transaction, recurringRule } = result.body.data as { transaction: { id: string }; recurringRule: { id: string } };
  expect(result.body).toMatchObject({ success: true, data: { isDuplicate: false } });
  const after = await readState();

  expect(after.ledger).toEqual([expect.objectContaining({
    id: transaction.id, householdId: a, accountId: target.accountId, ownerUserId: userId,
    idempotencyKey: body.idempotencyKey, recurringTransactionId: recurringRule.id, isRecurring: true, isPrivate: false,
    amount: "12.35", currency: "ZMW", type: "expense", date,
    postedBalanceDelta: "-12.35", postedAccountIsAsset: true, postingMode: "posted",
  })]);
  expect(after.accounts.find(row => row.id === target.accountId)).toMatchObject({
    balance: target.balance, isPrivate: target.auditHousehold === null,
  });
  expect(after.accounts.filter(row => row.id !== target.accountId))
    .toEqual(before.accounts.filter(row => row.id !== target.accountId));
  expect(after.categories).toEqual(before.categories);
  expect(after.splits).toHaveLength(2);
  expect(after.splits).toEqual(expect.arrayContaining([
    expect.objectContaining({ transactionId: transaction.id, categoryId: fareCategoryId, amount: "5.00" }),
    expect.objectContaining({ transactionId: transaction.id, categoryId: feeCategoryId, amount: "7.35" }),
  ]));
  expect(after.intents).toEqual([expect.objectContaining({
    transactionId: transaction.id, householdId: a, actorUserId: userId, idempotencyKey: body.idempotencyKey,
    operation: "recurring", ownerSelected: false,
  })]);
  expect(after.rules).toEqual([expect.objectContaining({
    id: recurringRule.id, householdId: a, accountId: target.accountId, amount: "12.35", frequency: "monthly",
    startDate: date, endDate: "2026-12-31", nextDueDate: "2026-09-30", totalOccurrences: 1,
  })]);
  expect(after.links).toEqual([expect.objectContaining({
    recurringTransactionId: recurringRule.id, transactionId: transaction.id, status: "linked", matchMethod: "manual",
    expectedDate: date, actualDate: date, expectedAmount: "12.35", actualAmount: "12.35",
  })]);
  expect(after.history.map(({ action, performedBy, linkedTransactionId, recurringTransactionId }) => ({
    action, performedBy, linkedTransactionId, recurringTransactionId,
  })).sort((left, right) => left.action.localeCompare(right.action))).toEqual([
    { action: "created", performedBy: userId, linkedTransactionId: null, recurringTransactionId: recurringRule.id },
    { action: DENOMINATION_ACTION, performedBy: userId, linkedTransactionId: null, recurringTransactionId: recurringRule.id },
    { action: "linked", performedBy: userId, linkedTransactionId: transaction.id, recurringTransactionId: recurringRule.id },
  ]);
  expect(after.history.find(row => row.action === DENOMINATION_ACTION)?.newState).toEqual({
    version: 1, currency: "ZMW", amount: "12.35", accountId: target.accountId, source: "manual_creation",
  });

  expect.soft(after.audits.filter(row => row.entityType === "transaction"), "transaction CREATE audit").toEqual([
    expect.objectContaining({
      entityId: transaction.id, userId, householdId: target.auditHousehold, action: "CREATE",
      details: { newValue: expect.objectContaining({
        accountId: target.accountId, amount: "12.35", currency: "ZMW", postedBalanceDelta: "-12.35", postingMode: "posted",
      }) },
    }),
  ]);
  expect.soft(after.audits.filter(row => row.entityType === "recurring_rule"), "recurring rule CREATE audit").toEqual([
    expect.objectContaining({
      entityId: recurringRule.id, userId, householdId: target.auditHousehold, action: "CREATE",
      details: { newValue: { name: after.rules[0].name, amount: "12.35", source: "transaction", transactionId: transaction.id },
        operation: "createFromTransaction" },
    }),
  ]);
  expect.soft(after.outbox.filter(row => row.eventType === "transaction.created"), "transaction.created outbox row").toEqual([
    expect.objectContaining({
      aggregateType: "transaction", aggregateId: transaction.id, householdId: a,
      payload: { id: transaction.id, type: "expense", amount: "12.35", accountId: target.accountId },
    }),
  ]);

  const goalSync = vi.spyOn(goalAccountAssignmentService, "syncGoalsForAccount");
  try {
    const replay = await post(target, body).expect(201);
    expect(replay.body.data).toMatchObject({
      isDuplicate: true, transaction: { id: transaction.id }, recurringRule: { id: recurringRule.id },
    });
    expect(goalSync).not.toHaveBeenCalled();
    expect(await readState()).toEqual(after);
  } finally {
    goalSync.mockRestore();
  }
}

async function installFault(kind: Fault, key: string) {
  const actor = actors.get("member")!.id;
  const fault = `r08_recurring_writer_${randomUUID().replaceAll("-", "")}`;
  const witness = `${fault}_seen`;
  const table = kind === "transaction outbox" ? "outbox_events" : "audit_logs";
  const entity = kind === "transaction audit" ? "transaction" : "recurring_rule";
  const scope = kind === "transaction outbox"
    ? `NEW.event_type = 'transaction.created' AND NEW.household_id = '${a}'::uuid
       AND NEW.payload->>'accountId' = '${shared.accountId}'`
    : `NEW.action = 'CREATE' AND NEW.entity_type = '${entity}'
       AND NEW.user_id = '${actor}'::uuid AND NEW.household_id = '${a}'::uuid`;
  await pool.query(`
    CREATE SEQUENCE public.${witness};
    CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM public.transactions t
        JOIN public.transaction_create_owner_intents i ON i.transaction_id = t.id
        JOIN public.accounts acc ON acc.id = t.account_id
        JOIN public.recurring_transactions r ON r.id = t.recurring_transaction_id
        WHERE t.idempotency_key = '${key}'::uuid AND i.idempotency_key = t.idempotency_key
          AND t.household_id = '${a}'::uuid AND i.household_id = t.household_id
          AND t.owner_user_id = '${actor}'::uuid AND i.actor_user_id = t.owner_user_id
          AND i.operation = 'recurring' AND NOT i.owner_selected
          AND t.account_id = '${shared.accountId}'::uuid AND acc.balance = 976.54 AND NOT acc.is_private
          AND t.is_recurring AND NOT t.is_private AND t.type = 'expense' AND t.date = '${date}'
          AND t.amount = 12.35 AND t.currency = 'ZMW' AND t.posted_balance_delta = -12.35
          AND t.posted_account_is_asset AND t.posting_mode = 'posted'
          AND r.account_id = t.account_id AND r.household_id = t.household_id AND r.amount = t.amount
          AND r.frequency = 'monthly' AND r.start_date = '${date}' AND r.end_date = '2026-12-31'
          AND r.total_occurrences = 1 AND r.next_due_date = '2026-09-30'
          AND (SELECT count(*) = 2
            AND count(*) FILTER (WHERE s.category_id = '${fareCategoryId}'::uuid AND s.amount = 5.00) = 1
            AND count(*) FILTER (WHERE s.category_id = '${feeCategoryId}'::uuid AND s.amount = 7.35) = 1
            FROM public.transaction_splits s WHERE s.transaction_id = t.id)
          AND (SELECT count(*) = 1
            AND count(*) FILTER (WHERE l.recurring_transaction_id = r.id AND l.status = 'linked'
              AND l.match_method = 'manual' AND l.expected_date = t.date AND l.actual_date = t.date
              AND l.expected_amount = t.amount AND l.actual_amount = t.amount) = 1
            FROM public.recurring_transaction_links l WHERE l.transaction_id = t.id)
          AND (SELECT count(*) = 3
            AND count(*) FILTER (WHERE h.action = 'created' AND h.linked_transaction_id IS NULL AND h.performed_by = t.owner_user_id) = 1
            AND count(*) FILTER (WHERE h.action = 'linked' AND h.linked_transaction_id = t.id AND h.performed_by = t.owner_user_id) = 1
            AND count(*) FILTER (WHERE h.action = '${DENOMINATION_ACTION}' AND h.performed_by = t.owner_user_id
              AND h.new_state = jsonb_build_object('version',1,'currency','ZMW','amount',t.amount::text,
                'accountId',t.account_id::text,'source','manual_creation')) = 1
            FROM public.recurring_transaction_history h WHERE h.recurring_transaction_id = r.id)
          AND (SELECT count(*) = 1 FROM public.audit_logs l
            WHERE l.entity_type = 'transaction' AND l.action = 'CREATE' AND l.entity_id = t.id
              AND l.user_id = t.owner_user_id AND l.household_id = t.household_id
              AND l.details->'newValue'->>'accountId' = t.account_id::text)
          AND (SELECT count(*) = 1 FROM public.audit_logs l
            WHERE l.entity_type = 'recurring_rule' AND l.action = 'CREATE' AND l.entity_id = r.id
              AND l.user_id = t.owner_user_id AND l.household_id = t.household_id
              AND l.details->'newValue'->>'transactionId' = t.id::text AND l.details->>'operation' = 'createFromTransaction')
          AND (SELECT count(*) = 1 FROM public.outbox_events e
            WHERE e.event_type = 'transaction.created' AND e.aggregate_type = 'transaction' AND e.aggregate_id = t.id
              AND e.household_id = t.household_id
              AND e.payload = jsonb_build_object('id', t.id, 'type', t.type, 'amount', t.amount::text, 'accountId', t.account_id))
      ) THEN
        RAISE EXCEPTION 'Synthetic recurring writer state did not reach the required fault';
      END IF;
      -- The sequence records reached final transaction state even after rollback.
      PERFORM nextval('public.${witness}');
      RAISE EXCEPTION 'Synthetic mandatory recurring writer failure';
    END;
    $$;
    CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON public.${table}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (${scope}) EXECUTE FUNCTION public.${fault}();
  `);
  return { fault, witness, table };
}

describe("R08 NEW-32 signed recurring transaction writer", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await resetAccountsAndMembership();
    await db.insert(categories).values([
      { id: fareCategoryId, householdId: a, name: "Synthetic fare", displayOrder: 0 },
      { id: feeCategoryId, householdId: a, name: "Synthetic fee", displayOrder: 1 },
    ]);
  });
  afterEach(async () => {
    const { ledger, rules } = await readState();
    await db.delete(outboxEvents).where(outboxScope([...ledger.map(row => row.id), ...rules.map(row => row.id)]));
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.householdId, householdIds));
    await db.delete(transactions).where(inArray(transactions.householdId, householdIds));
    await db.delete(auditLogs).where(auditScope());
    await db.delete(categories).where(inArray(categories.id, categoryIds));
  });
  afterAll(async () => {
    const actorIds = Array.from(actors.values(), ({ id }) => id);
    try {
      await db.delete(securityAuditLogs).where(or(
        inArray(securityAuditLogs.userId, actorIds), inArray(securityAuditLogs.targetUserId, actorIds),
      ));
    } finally {
      await stop();
    }
  });

  it("commits the shared posting, both audits and the outbox once across identical replay", async () => {
    await expectOnePostingAndReplay(shared, payload(shared));
  });

  it("refuses a split in a different currency from the recurring posting without any effects", async () => {
    const body = payload(shared);
    const mixed = {
      ...body,
      splits: body.splits.map((split, index) => index === 0
        ? { ...split, amount: { ...split.amount, currency: "USD" } }
        : split),
    };
    const before = await readState();
    const rejected = await post(shared, mixed);
    expect.soft(rejected.status).toBe(400);
    expect.soft(rejected.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", fields: expect.arrayContaining([
        expect.objectContaining({ field: "splits.0.amount.currency" }),
      ]) },
    });
    expect(await readState()).toEqual(before);
  });

  it("keeps both audits actor-bound and outside the household on an owner-private account", async () => {
    await expectOnePostingAndReplay(privateAccount, payload(privateAccount));
  });

  it("reads the committed winner after a real posting key collision without any new effects", async () => {
    const body = payload(shared);
    const first = await post(shared, body).expect(201);
    expect(first.body.data.isDuplicate).toBe(false);
    const before = await readState();
    // Simulate the winner committing just after the first lookup. The duplicate
    // insert, PostgreSQL uniqueness error and second lookup are real.
    const lookup = vi.spyOn(transactionRepository, "findByIdempotencyKey").mockResolvedValueOnce(undefined);
    const write = vi.spyOn(transactionRepository, "createWithinTransaction");
    const goalSync = vi.spyOn(goalAccountAssignmentService, "syncGoalsForAccount");
    try {
      const replay = await post(shared, body).expect(201);
      expect(replay.body.data).toMatchObject({
        isDuplicate: true,
        transaction: { id: first.body.data.transaction.id },
        recurringRule: { id: first.body.data.recurringRule.id },
      });
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(1);
      const uniqueViolation = await write.mock.results[0].value.then(
        () => false,
        (error: unknown) => {
          const postgresError = getPostgresError(error);
          return postgresError?.code === "23505" && postgresError.constraint === "transactions_idempotency_key_unique";
        },
      );
      expect(uniqueViolation).toBe(true);
      expect(goalSync).not.toHaveBeenCalled();
      expect(await readState()).toEqual(before);
    } finally {
      goalSync.mockRestore();
      write.mockRestore();
      lookup.mockRestore();
    }
  });

  it("keeps the original posting and cadence while its first key lookup waits", async () => {
    const body = { ...payload(shared), notes: "Original submitted notes" };
    const { recurring, ...data } = createRecurringFromTransactionSchema.parse(body);
    const actor = actors.get(shared.role)!;
    let releaseLookup!: () => void;
    const gate = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookup = vi.spyOn(transactionRepository, "findByIdempotencyKey")
      .mockImplementationOnce(async () => { await gate; return undefined; });
    const pending = recurringService.createRecurringFromTransaction(data, recurring, a, actor.id);
    try {
      expect(lookup).toHaveBeenCalledWith(body.idempotencyKey, a);
      data.idempotencyKey = randomUUID();
      data.amount = "99.99";
      data.notes = "Changed after dispatch";
      data.splits![0].amount = "90.00";
      data.splits![1].amount = "9.99";
      recurring.frequency = "weekly";
      recurring.startDate = "2026-09-01";
      recurring.endDate = "2027-01-01";
      recurring.reminderDays = 13;
      releaseLookup();
      const result = await pending;
      expect(result.isDuplicate).toBe(false);
      const saved = await readState();
      expect(saved.ledger).toEqual([expect.objectContaining({
        id: result.transaction.id, idempotencyKey: body.idempotencyKey,
        amount: "12.35", postedBalanceDelta: "-12.35", notes: body.notes,
      })]);
      expect(saved.accounts.find(row => row.id === shared.accountId)?.balance).toBe(shared.balance);
      expect(saved.intents).toEqual([expect.objectContaining({
        transactionId: result.transaction.id, idempotencyKey: body.idempotencyKey, actorUserId: actor.id,
      })]);
      expect(saved.splits).toEqual(expect.arrayContaining([
        expect.objectContaining({ categoryId: fareCategoryId, amount: "5.00" }),
        expect.objectContaining({ categoryId: feeCategoryId, amount: "7.35" }),
      ]));
      expect(saved.splits).toHaveLength(2);
      expect(saved.rules).toEqual([expect.objectContaining({
        id: result.recurringRule.id, amount: "12.35", frequency: "monthly", startDate: date,
        endDate: "2026-12-31", nextDueDate: "2026-09-30", reminderDays: 4,
      })]);
      expect(saved.history).toHaveLength(3);
      expect(saved.history.find(row => row.action === DENOMINATION_ACTION)?.newState).toEqual({
        version: 1, currency: "ZMW", amount: "12.35", accountId: shared.accountId, source: "manual_creation",
      });
      expect(saved.audits.filter(row => row.action === "CREATE")).toHaveLength(2);
      expect(saved.outbox.filter(row => row.eventType === "transaction.created")).toHaveLength(1);
    } finally {
      releaseLookup();
      await pending.catch(() => undefined);
      lookup.mockRestore();
    }
  });

  it.each(["audit_logs_pkey", "transactions_idempotency_key_unique_shadow"])(
    "propagates an unrelated %s unique violation without replaying a winner",
    async constraint => {
      const body = payload(shared);
      await post(shared, body).expect(201);
      const before = await readState();
      const { recurring, ...data } = createRecurringFromTransactionSchema.parse(body);
      const failure = Object.assign(new Error("Synthetic unrelated query failure"), {
        cause: { code: "23505", constraint },
      });
      const lookup = vi.spyOn(transactionRepository, "findByIdempotencyKey").mockResolvedValueOnce(undefined);
      const write = vi.spyOn(transactionRepository, "createWithinTransaction").mockRejectedValueOnce(failure);
      const goalSync = vi.spyOn(goalAccountAssignmentService, "syncGoalsForAccount");
      try {
        const error = await recurringService.createRecurringFromTransaction(
          data, recurring, a, actors.get(shared.role)!.id,
        ).then(() => undefined, (rejected: unknown) => rejected);
        expect.soft(error).toBe(failure);
        expect.soft(lookup).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(goalSync).not.toHaveBeenCalled();
        expect(await readState()).toEqual(before);
      } finally {
        goalSync.mockRestore();
        write.mockRestore();
        lookup.mockRestore();
      }
    },
  );

  it.each(["transaction audit", "transaction outbox", "rule audit"] as const)(
    "rolls back the complete posting when the required %s fails at commit and admits one same-key retry",
    async kind => {
      const body = payload(shared);
      const before = await readState();
      const { fault, witness, table } = await installFault(kind, body.idempotencyKey);
      try {
        const result = await post(shared, body);
        const { rows } = await pool.query<{ is_called: boolean }>(`SELECT is_called FROM public.${witness}`);
        expect.soft(rows[0].is_called, "complete in-transaction state reached the fault").toBe(true);
        expect.soft(result.status).toBe(500);
        expect(await readState()).toEqual(before);
      } finally {
        await pool.query(`
          DROP TRIGGER ${fault} ON public.${table};
          DROP FUNCTION public.${fault}();
          DROP SEQUENCE public.${witness};
        `);
      }
      await expectOnePostingAndReplay(shared, body);
    },
  );
});
