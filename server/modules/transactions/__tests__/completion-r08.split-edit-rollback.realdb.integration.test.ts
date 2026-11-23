/**
 * R08 signed HTTP split/edit/rollback oracles. Literal expectations and raw SQL
 * are independent of the production balance and allocation helpers.
 * Run only through the campaign's protected disposable-database runner.
 * Fault DDL is fixture-scoped, temporary, and always removed in finally.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, auditLogs, categories, categoryGroups, householdMembers, households, merchants,
  outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { budgetRepository } from "../../../repositories/BudgetRepository";

const householdId = randomUUID(), userId = randomUUID(), merchantId = randomUUID();
const categoryA = randomUUID(), categoryB = randomUUID(), currency = "USD";
const foreignHouseholdId = randomUUID();
const merchantName = "Synthetic R08 Split Merchant";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string, accountId: string;

interface ParentRow {
  id: string; amount: string; currency: string | null; notes: string | null;
  categoryId: string | null; deletedAt: Date | null;
}
interface ChildRow {
  transactionId: string; amount: string; categoryId: string | null; notes: string | null;
}
interface EventRow {
  id: string; event_type: string; aggregate_id: string;
}

function allocations(first = "60.00", second = "40.00") {
  return [
    { amount: { amount: first, currency }, categoryId: categoryA, notes: "Allocation A" },
    { amount: { amount: second, currency }, categoryId: categoryB, notes: "Allocation B" },
  ];
}
function payload(changes: Record<string, unknown> = {}) {
  return { accountId, name: merchantName, merchantId, categoryId: categoryA,
    date: "2026-01-10", type: "expense", amount: { amount: "100.00", currency },
    notes: "Original split parent", splits: allocations(), idempotencyKey: randomUUID(), ...changes };
}
function post(body: Record<string, unknown>) {
  return request(app).post("/api/transactions").set("Cookie", cookie)
    .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(body);
}
function put(id: string, body: Record<string, unknown>) {
  return request(app).put("/api/transactions/" + id).set("Cookie", cookie)
    .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(body);
}
async function events(id: string, type: string): Promise<EventRow[]> {
  return (await pool.query<EventRow>(
    "SELECT id,event_type,aggregate_id FROM outbox_events WHERE household_id=$1 AND aggregate_id=$2 AND event_type=$3 ORDER BY id",
    [householdId, id, type],
  )).rows;
}
async function waitForEvents(id: string, type: string, count = 1) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await events(id, type);
    if (rows.length >= count) return rows;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected committed " + type + " event");
}
async function state() {
  return {
    account: (await pool.query("SELECT * FROM accounts WHERE id=$1 AND household_id=$2", [accountId, householdId])).rows,
    parents: (await pool.query("SELECT * FROM transactions WHERE account_id=$1 AND household_id=$2 ORDER BY id", [accountId, householdId])).rows,
    children: (await pool.query("SELECT s.* FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.account_id=$1 AND t.household_id=$2 ORDER BY s.id", [accountId, householdId])).rows,
    audit: (await pool.query("SELECT * FROM audit_logs WHERE household_id=$1 ORDER BY id", [householdId])).rows,
    aliases: (await pool.query("SELECT id, alias_name FROM merchant_aliases WHERE merchant_id=$1 ORDER BY id", [merchantId])).rows,
    // Compare durable operation identities/payloads, not mutable relay status.
    outbox: (await pool.query("SELECT id,event_type,aggregate_type,aggregate_id,payload FROM outbox_events WHERE household_id=$1 ORDER BY id", [householdId])).rows,
  };
}
async function assertPosting(id: string, amount: string, balance: string, first = "60.00", second = "40.00") {
  const parents = (await pool.query<ParentRow>(
    'SELECT id,amount,currency,notes,category_id AS "categoryId",deleted_at AS "deletedAt" FROM transactions WHERE id=$1 AND account_id=$2 AND household_id=$3',
    [id, accountId, householdId],
  )).rows;
  expect(parents).toHaveLength(1);
  expect.soft(parents[0]).toMatchObject({ id, amount, currency, categoryId: null, deletedAt: null });
  const children = (await pool.query<ChildRow>(
    'SELECT transaction_id AS "transactionId",amount,category_id AS "categoryId",notes FROM transaction_splits WHERE transaction_id=$1 ORDER BY id', [id],
  )).rows;
  expect.soft(children).toHaveLength(2);
  expect.soft(children).toEqual(expect.arrayContaining([
    { transactionId: id, amount: first, categoryId: categoryA, notes: "Allocation A" },
    { transactionId: id, amount: second, categoryId: categoryB, notes: "Allocation B" },
  ]));
  expect.soft((await pool.query<{ total: string }>(
    "SELECT SUM(amount)::text AS total FROM transaction_splits WHERE transaction_id=$1", [id],
  )).rows).toEqual([{ total: amount }]);
  expect.soft((await state()).account).toEqual([expect.objectContaining({
    id: accountId, balance, initial_balance: "1000.00", currency, is_asset: true,
  })]);
}
async function createSplit() {
  const response = await post(payload()).expect(201);
  expect(response.body.success).toBe(true);
  const id: string = response.body.data.id;
  await waitForEvents(id, "transaction.created");
  await assertPosting(id, "100.00", "900.00");
  return id;
}
async function assertUnchanged(before: Awaited<ReturnType<typeof state>>) {
  expect.soft(await state()).toEqual(before);
  // A second bounded observation also catches an already-dispatched outbox insert.
  // This is not an assertion about arbitrarily delayed workers or process crashes.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect.soft(await state()).toEqual(before);
}

async function withAuditFault(
  mode: "update" | "deferred-create",
  transactionId: string | undefined,
  run: (attempted: () => Promise<boolean>) => Promise<void>,
) {
  // Identifiers and UUID literals below are exclusively generated by this fixture.
  const tag = randomUUID().replace(/-/g, "");
  const name = "r08_split_fault_" + tag, sequence = "r08_split_seen_" + tag;
  const target = mode === "update"
    ? "NEW.action='UPDATE' AND NEW.entity_id='" + transactionId + "'::uuid"
    : "NEW.action='CREATE' AND EXISTS (SELECT 1 FROM transactions WHERE id=NEW.entity_id AND account_id='" + accountId + "'::uuid)";
  const financialPrecondition = mode === "deferred-create" ? `
    IF NOT EXISTS (
      SELECT 1 FROM transactions p JOIN accounts a ON a.id=p.account_id
      WHERE p.id=NEW.entity_id AND p.household_id='${householdId}'::uuid
        AND p.account_id='${accountId}'::uuid AND p.amount=100.00 AND p.currency='USD' AND p.type='expense'
        AND a.balance=900.00 AND a.initial_balance=1000.00 AND a.currency='USD'
        AND (SELECT COUNT(*) FROM transaction_splits WHERE transaction_id=p.id)=2
        AND (SELECT SUM(amount) FROM transaction_splits WHERE transaction_id=p.id)=100.00
        AND EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id=p.id AND amount=60.00 AND category_id='${categoryA}'::uuid)
        AND EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id=p.id AND amount=40.00 AND category_id='${categoryB}'::uuid)
    ) THEN RAISE EXCEPTION 'R08_SPLIT_FAULT_FINANCIAL_PRECONDITION_MISSING'; END IF;`
    : `
    IF NOT EXISTS (SELECT 1 FROM transactions WHERE id=NEW.entity_id AND notes='Faulted metadata edit')
    THEN RAISE EXCEPTION 'R08_SPLIT_FAULT_EDIT_PRECONDITION_MISSING'; END IF;`;
  try {
    await pool.query(`CREATE SEQUENCE ${sequence}`);
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $r08_fault$
      BEGIN
        IF NEW.household_id='${householdId}'::uuid AND NEW.user_id='${userId}'::uuid
          AND NEW.entity_type='transaction' AND (${target}) THEN
          ${financialPrecondition}
          PERFORM nextval('${sequence}'::regclass);
          RAISE EXCEPTION 'R08_SYNTHETIC_AUDIT_INSERT_FAILURE';
        END IF;
        RETURN NEW;
      END $r08_fault$`);
    if (mode === "deferred-create") {
      // Repository CREATE audits before children/balance. Deferring the constraint
      // trigger to COMMIT and checking all financial rows proves the fault is late.
      await pool.query(`CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    } else {
      // Actual SQL INSERT failure exercises BusinessAuditService's non-tx catch.
      await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    }
    const attempted = async () => (await pool.query<{ is_called: boolean }>(`SELECT is_called FROM ${sequence}`)).rows[0].is_called;
    expect(await attempted()).toBe(false);
    await run(attempted);
  } finally {
    try {
      await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
    } finally {
      try { await pool.query(`DROP FUNCTION IF EXISTS ${name}()`); }
      finally { await pool.query(`DROP SEQUENCE IF EXISTS ${sequence}`); }
    }
  }
}

describe("R08 split create/edit and real SQL audit-failure rollback", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = "r08-split-" + userId + "@example.invalid", password = "SyntheticSplitOracle123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic R08 splits", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: "r08-split-" + userId,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const [group] = await db.insert(categoryGroups).values({
      householdId, name: "Synthetic split expenses", type: "expenses", displayOrder: 0,
    }).returning({ id: categoryGroups.id });
    await db.insert(categories).values([
      { id: categoryA, householdId, groupId: group.id, name: "Synthetic split A", displayOrder: 0 },
      { id: categoryB, householdId, groupId: group.id, name: "Synthetic split B", displayOrder: 1 },
    ]);
    await db.insert(merchants).values({ id: merchantId, householdId, name: merchantName });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);
  beforeEach(async () => {
    accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId,
      name: "Synthetic split checking", type: "checking", currency, isAsset: true,
      isPrivate: false, balance: "1000.00", initialBalance: "1000.00" });
  });
  afterAll(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(categories).where(eq(categories.householdId, householdId));
    await db.delete(categoryGroups).where(eq(categoryGroups.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(households).where(eq(households.id, foreignHouseholdId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("posts parent 100 and children 60+40 once, with independent persisted readback", async () => {
    const id = await createSplit();
    expect((await pool.query("SELECT id FROM audit_logs WHERE household_id=$1 AND entity_id=$2 AND entity_type='transaction' AND action='CREATE'", [householdId, id])).rows).toHaveLength(1);
    expect(await events(id, "transaction.created")).toHaveLength(1);
  });

  it.each([
    { label: "overallocated", first: "70.00", second: "40.00" },
    { label: "underallocated", first: "60.00", second: "30.00" },
    { label: "zero child", first: "0.00", second: "100.00" },
    { label: "negative child", first: "-10.00", second: "110.00" },
  ])("rejects $label initial allocations without parent/child/balance/audit/event writes", async scenario => {
    const before = await state();
    const response = await post(payload({ splits: allocations(scenario.first, scenario.second) }));
    expect.soft(response.status).toBe(400);
    await assertUnchanged(before);
  });

  it("persists the advertised allocations-only PUT replacement 55+45 without reposting 100", async () => {
    const id = await createSplit();
    const list = () => request(app).get("/api/transactions").query({ accountId })
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).expect(200);
    // DB defaults may carry microseconds which the signed JSON date cannot express.
    await pool.query("UPDATE transactions SET updated_at='2026-01-11 12:01:02.345678' WHERE id=$1", [id]);
    const [original] = (await list()).body.data;
    expect(original.id).toBe(id);
    const replacement = { expectedUpdatedAt: original.updatedAt, splits: allocations("55.00", "45.00") };
    await put(id, replacement).expect(200);
    await waitForEvents(id, "transaction.updated");
    await assertPosting(id, "100.00", "900.00", "55.00", "45.00");
    await put(id, replacement).expect(409);
    const [reloaded] = (await list()).body.data;
    expect(reloaded.updatedAt).not.toBe(original.updatedAt);
    expect(reloaded.splits).toHaveLength(2);
    expect(reloaded.splits).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: categoryA, amount: { amount: "55.00", currency } }),
      expect.objectContaining({ categoryId: categoryB, amount: { amount: "45.00", currency } }),
    ]));
    const { rows } = await pool.query(
      "SELECT details FROM audit_logs WHERE household_id=$1 AND user_id=$2 AND entity_id=$3 AND action='UPDATE'",
      [householdId, userId, id],
    );
    expect(rows).toHaveLength(1);
    for (const [phase, first, second] of [["before", "60.00", "40.00"], ["after", "55.00", "45.00"]]) {
      const recorded = rows[0].details.changes.splits[phase];
      expect(recorded).toHaveLength(2);
      expect(recorded).toEqual(expect.arrayContaining([
        expect.objectContaining({ categoryId: categoryA, amount: first }),
        expect.objectContaining({ categoryId: categoryB, amount: second }),
      ]));
    }
  });

  it("atomically edits parent 100 to 120 with valid replacement children 70+50", async () => {
    const id = await createSplit();
    await put(id, { amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00") }).expect(200);
    await waitForEvents(id, "transaction.updated");
    await assertPosting(id, "120.00", "880.00", "70.00", "50.00");
  });

  it("refreshes the signed spending report and both budget category totals after an edit", async () => {
    const date = "2026-02-12";
    await db.update(accounts).set({ currency: "ZMW" }).where(eq(accounts.id, accountId));
    const parts = (a: string, b: string) => allocations(a, b).map(split => ({
      ...split, amount: { amount: split.amount.amount, currency: "ZMW" },
    }));
    const created = await post(payload({ date, amount: { amount: "100.00", currency: "ZMW" },
      splits: parts("60.00", "40.00") })).expect(201);
    const checkReaders = async (first: string, second: string, total: string) => {
      const report = await request(app).get("/api/reports/spending/breakdown")
        .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
        .query({ from: date, to: date, groupBy: "category", type: "expense" }).expect(200);
      expect(report.body.data.total).toEqual({ amount: total, currency: "ZMW" });
      for (const [categoryId, amount] of [[categoryA, first], [categoryB, second]]) {
        expect(report.body.data.items).toContainEqual(expect.objectContaining({
          entityId: categoryId, value: { amount, currency: "ZMW" },
        }));
        const spend = await budgetRepository.calculateSpentWithSplits(householdId, categoryId, date, date, "expense", "ZMW");
        expect(spend.toString()).toBe(amount);
      }
    };
    await checkReaders("60.00", "40.00", "100.00");
    await put(created.body.data.id, { amount: { amount: "120.00", currency: "ZMW" },
      splits: parts("70.00", "50.00") }).expect(200);
    await checkReaders("70.00", "50.00", "120.00");
  });

  it("includes split spending on an ungrouped household category in the category report", async () => {
    const date = "2026-02-13";
    const ungroupedId = randomUUID();
    await db.insert(categories).values({
      id: ungroupedId, householdId, groupId: null, name: "Synthetic standalone category", displayOrder: 2,
    });
    await db.update(accounts).set({ currency: "ZMW" }).where(eq(accounts.id, accountId));
    await post(payload({
      date, amount: { amount: "100.00", currency: "ZMW" },
      splits: [
        { categoryId: categoryA, amount: { amount: "60.00", currency: "ZMW" } },
        { categoryId: ungroupedId, amount: { amount: "40.00", currency: "ZMW" } },
      ],
    })).expect(201);

    const breakdown = (groupId?: string) => request(app).get("/api/reports/spending/breakdown")
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .query({ from: date, to: date, groupBy: "category", type: "expense",
        ...(groupId ? { categoryGroupId: groupId } : {}) }).expect(200);
    const [groupedCategory] = await db.select({ groupId: categories.groupId }).from(categories)
      .where(eq(categories.id, categoryA));
    expect(groupedCategory.groupId).toBeTruthy();
    const filtered = await breakdown(groupedCategory.groupId!);
    expect(filtered.body.data.total).toEqual({ amount: "60.00", currency: "ZMW" });
    expect(filtered.body.data.items.map((item: { entityId: string }) => item.entityId)).toEqual([categoryA]);

    const all = await breakdown();
    expect(all.body.data.total).toEqual({ amount: "100.00", currency: "ZMW" });
    expect(all.body.data.items).toHaveLength(2);
    expect(all.body.data.items).toContainEqual(expect.objectContaining({
      entityId: ungroupedId, value: { amount: "40.00", currency: "ZMW" },
    }));
  });

  it("conceals foreign categories and groups on historical split pointers", async () => {
    const date = "2026-02-14", foreignGroup = randomUUID(), foreignCategory = randomUUID(), crossedCategory = randomUUID();
    await db.insert(households).values({ id: foreignHouseholdId, name: "Synthetic foreign report household", currency: "ZMW" });
    await db.insert(categoryGroups).values({
      id: foreignGroup, householdId: foreignHouseholdId, name: "Private group label", type: "expenses", displayOrder: 0,
    });
    await db.insert(categories).values([
      { id: foreignCategory, householdId: foreignHouseholdId, groupId: null, name: "Private category label", displayOrder: 0 },
      { id: crossedCategory, householdId, groupId: foreignGroup, name: "Invalid cross-group category", displayOrder: 3 },
    ]);
    await db.update(accounts).set({ currency: "ZMW" }).where(eq(accounts.id, accountId));
    const created = await post(payload({
      date, amount: { amount: "100.00", currency: "ZMW" },
      splits: [
        { categoryId: categoryA, amount: { amount: "60.00", currency: "ZMW" } },
        { categoryId: categoryB, amount: { amount: "40.00", currency: "ZMW" } },
      ],
    })).expect(201);
    const id = created.body.data.id;
    // Model historical pointers independently of current writer validation.
    const rewritten = await pool.query(
      "UPDATE transaction_splits SET category_id = CASE WHEN category_id=$2 THEN $3::uuid ELSE $4::uuid END WHERE transaction_id=$1",
      [id, categoryA, foreignCategory, crossedCategory],
    );
    expect(rewritten.rowCount).toBe(2);
    for (const filters of [{ groupBy: "category" }, { groupBy: "categoryGroup" }, { groupBy: "category", categoryGroupId: foreignGroup }]) {
      const report = await request(app).get("/api/reports/spending/breakdown")
        .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
        .query({ from: date, to: date, type: "expense", ...filters }).expect(200);
      expect(report.body.data.total).toEqual({ amount: "0.00", currency: "ZMW" });
      expect(report.body.data.items).toEqual([]);
    }
  });

  it.each(["missing", "underallocated", "overallocated"] as const)(
    "rejects a parent amount edit with %s replacement and preserves complete state", async mode => {
      const id = await createSplit(), before = await state();
      const body: Record<string, unknown> = { amount: { amount: "120.00", currency } };
      if (mode !== "missing") body.splits = allocations("70.00", mode === "underallocated" ? "40.00" : "60.00");
      const response = await put(id, body);
      expect.soft([400, 409]).toContain(response.status);
      if (response.status === 200) await waitForEvents(id, "transaction.updated");
      await assertUnchanged(before);
    },
  );

  it("admits a metadata-only split-parent edit while preserving both allocations and balance", async () => {
    const id = await createSplit();
    await put(id, { notes: "Allowed metadata edit" }).expect(200);
    await waitForEvents(id, "transaction.updated");
    await assertPosting(id, "100.00", "900.00");
    expect((await state()).parents[0].notes).toBe("Allowed metadata edit");
  });

  it("rejects a stale replacement without changing allocations, audit or outbox", async () => {
    const id = await createSplit();
    const before = await state();
    await put(id, {
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      amount: { amount: "120.00", currency },
      splits: allocations("70.00", "50.00"),
    }).expect(409);
    await assertUnchanged(before);
  });

  it.each(["allocations", "notes", "account currency"] as const)("rechecks a concurrent change before committing a split-parent edit (%s)", async mode => {
    const id = await createSplit();
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows: [blockerInfo] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (mode === "account currency") {
        await blocker.query("UPDATE accounts SET currency='ZMW' WHERE id=$1", [accountId]);
      } else {
        await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [householdId, userId]);
      }
      const edit = mode === "notes" ? { notes: "Pending downgrade" }
        : mode === "allocations" ? { splits: allocations("55.00", "45.00") }
        : { amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00") };
      pending = put(id, edit).then(response => response);
      let waited = false;
      for (let attempt = 0; attempt < 80 && !waited; attempt++) {
        const { rows: [locks] } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked",
          [blockerInfo.pid],
        );
        waited = locks.blocked;
        if (!waited) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
      const response = await pending;
      expect.soft(waited, "the writer waited on the concurrent change").toBe(true);
      expect.soft(response.status).toBe(mode === "account currency" ? 400 : 403);
      // The independent account owner's commit is the only permitted change.
      if (mode === "account currency") before.account[0].currency = "ZMW";
      await assertUnchanged(before);
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
      await pool.query("UPDATE household_members SET role='owner' WHERE household_id=$1 AND user_id=$2", [householdId, userId]);
    }
  });

  it("rolls back a valid financial replacement when the update event cannot be committed", async () => {
    const id = await createSplit();
    const before = await state();
    const tag = randomUUID().replace(/-/g, "");
    const hook = "r08_split_fault_" + tag;
    const witness = "r08_split_seen_" + tag;
    const aliasName = "Synthetic Split Branch";
    const replacement = {
      name: aliasName, merchantId,
      amount: { amount: "120.00", currency }, splits: allocations("70.00", "50.00"),
    };
    expect(before.aliases.some(row => row.alias_name === aliasName)).toBe(false);
    try {
      await pool.query(`CREATE SEQUENCE ${witness}`);
      await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $r08$
        BEGIN
          IF NEW.household_id='${householdId}'::uuid AND NEW.aggregate_id='${id}'
             AND NEW.event_type='transaction.updated' THEN
            PERFORM nextval('${witness}'::regclass);
            RAISE EXCEPTION 'R08 synthetic outbox commit failure';
          END IF;
          RETURN NEW;
        END $r08$`);
      await pool.query(`CREATE CONSTRAINT TRIGGER ${hook} AFTER INSERT ON outbox_events
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${hook}()`);
      const response = await put(id, replacement);
      expect.soft(response.status).toBe(500);
      await expect.poll(async () =>
        (await pool.query<{ is_called: boolean }>(`SELECT is_called FROM ${witness}`)).rows[0].is_called,
      ).toBe(true);
      await assertUnchanged(before);
    } finally {
      try { await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON outbox_events`); }
      finally {
        try { await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`); }
        finally { await pool.query(`DROP SEQUENCE IF EXISTS ${witness}`); }
      }
    }
    await put(id, replacement).expect(200);
    await waitForEvents(id, "transaction.updated");
    await assertPosting(id, "120.00", "880.00", "70.00", "50.00");
    expect((await state()).aliases.filter(row => row.alias_name === aliasName)).toHaveLength(1);
    expect(await events(id, "transaction.updated")).toHaveLength(1);
    const audits = await pool.query(
      "SELECT id FROM audit_logs WHERE household_id=$1 AND entity_id=$2 AND action='UPDATE'", [householdId, id],
    );
    expect(audits.rows).toHaveLength(1);
  });

  it("a reached real UPDATE audit INSERT failure rolls back metadata/audit/event and permits recovery", async () => {
    const id = await createSplit(), before = await state();
    await withAuditFault("update", id, async attempted => {
      const response = await put(id, { notes: "Faulted metadata edit" });
      expect.soft(response.status).toBe(500);
      // nextval survives rollback. A denial or missed SQL hook cannot pass as a fault.
      expect(await attempted()).toBe(true);
      if (response.status === 200) await waitForEvents(id, "transaction.updated");
      await assertUnchanged(before);
    });
    const previousEvents = (await events(id, "transaction.updated")).length;
    await put(id, { notes: "Recovered metadata edit" }).expect(200);
    await waitForEvents(id, "transaction.updated", previousEvents + 1);
    await assertPosting(id, "100.00", "900.00");
    expect((await state()).parents[0].notes).toBe("Recovered metadata edit");
    expect.soft(await events(id, "transaction.updated")).toHaveLength(1);
    expect.soft((await pool.query("SELECT id FROM audit_logs WHERE household_id=$1 AND entity_id=$2 AND action='UPDATE'", [householdId, id])).rows).toHaveLength(1);
  });

  it("deferred CREATE audit failure reaches written parent/children/balance then rolls all of them back", async () => {
    const before = await state();
    await withAuditFault("deferred-create", undefined, async attempted => {
      const response = await post(payload());
      expect.soft(response.status).toBe(500);
      // The trigger checks parent100, children60/40 and balance900 before nextval.
      expect(await attempted()).toBe(true);
      await assertUnchanged(before);
    });
    // Fault objects have been removed. The same ordinary create is still usable.
    await createSplit();
  });
});
