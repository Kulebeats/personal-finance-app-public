/**
 * FIN-16: a rule apply that changes a transaction writes ONE audit row per
 * changed transaction, inside the same database transaction as the change
 * (Rule 9). REAL HTTP, REAL DB.
 *
 * Household A (owner, admin, member, view_only, professional) and B come from
 * the shared R04 fixture. A rule sets the owner to `member` and a category.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, categoryGroups, outboxEvents, rules, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const NAME = "Audit apply source";
const condition = { type: "merchant_name", operator: "contains", value: NAME };
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);

let categoryId: string;
let ruleId: string;

async function clean() {
  await db.delete(rules).where(eq(rules.householdId, a));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  await db.delete(categories).where(eq(categories.householdId, a));
  await db.delete(categoryGroups).where(eq(categoryGroups.householdId, a));
  await pool.query("delete from audit_logs where household_id=$1 or user_id=$2", [a, actors.get("owner")!.id]);
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
}

async function seedRule() {
  const [group] = await db.insert(categoryGroups).values({ householdId: a, name: "Audit group", type: "expenses", displayOrder: 1 }).returning();
  const [category] = await db.insert(categories).values({ householdId: a, groupId: group.id, name: "Audit category", displayOrder: 1 }).returning();
  categoryId = category.id;
  const [rule] = await db.insert(rules).values({
    householdId: a, name: "Audit rule", enabled: true, priority: 1, conditions: [condition], conditionLogic: "all",
    actions: [{ type: "set_owner", value: actors.get("member")!.id }, { type: "categorize", value: categoryId }],
  }).returning();
  ruleId = rule.id;
}

const createTransaction = (accountId: string, name = NAME) => signed(request(app).post("/api/transactions")).send({
  accountId, name, date: "2026-11-10", type: "expense",
  amount: { amount: "25.00", currency: "ZMW" }, idempotencyKey: randomUUID(),
});

async function ruleAudits(transactionId?: string) {
  const { rows } = await pool.query(
    `select * from audit_logs where entity_type='transaction' and action='UPDATE' and details ? 'ruleId'
       ${transactionId ? "and entity_id=$1" : ""} order by created_at, id`,
    transactionId ? [transactionId] : [],
  );
  return rows;
}

describe("FIN-16 rule apply audit (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seedRule(); });
  afterAll(async () => {
    await pool.query("drop trigger if exists block_rule_audit on audit_logs");
    await pool.query("drop function if exists block_rule_audit()");
    await clean();
    await stop();
  });

  it("writes one UPDATE audit row for the transaction a rule changed, with old and new values and the rule id", async () => {
    const created = await createTransaction(ids.sharedAccount).expect(201);
    const transactionId = created.body.data.id as string;

    const [row, ...rest] = await ruleAudits(transactionId);
    expect(rest).toHaveLength(0);
    expect(row.household_id).toBe(a);
    expect(row.user_id).toBe(actors.get("owner")!.id);
    expect(row.details.ruleId).toBe(ruleId);
    expect(row.details.changes.ownerUserId).toEqual({ before: actors.get("owner")!.id, after: actors.get("member")!.id });
    expect(row.details.changes.categoryId).toEqual({ before: null, after: categoryId });
    // Only what the rule changed: no bookkeeping columns.
    expect(Object.keys(row.details.changes).sort()).toEqual(["categoryId", "ownerUserId"]);

    const events = await pool.query(
      "select 1 from outbox_events where aggregate_id=$1 and event_type='transaction.updated'", [transactionId]);
    expect(events.rowCount).toBe(1);
  });

  it("writes one row per transaction when apply-to-past changes several", async () => {
    const seeded = [randomUUID(), randomUUID()];
    await db.insert(transactions).values(seeded.map((id, i) => ({
      id, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date: "2026-11-01", name: `${NAME} ${i}`, amount: "10.00", type: "expense" as const, isPrivate: false,
    })));
    await db.delete(rules).where(eq(rules.id, ruleId));

    await signed(request(app).post("/api/rules")).send({
      name: "Past rule", conditions: [condition], applyToPast: true,
      actions: [{ type: "set_owner", value: actors.get("member")!.id }, { type: "categorize", value: categoryId }],
    }).expect(201);

    const audits = await ruleAudits();
    expect(audits.map((row) => row.entity_id).sort()).toEqual([...seeded].sort());
    for (const row of audits) expect(row.details.changes.ownerUserId.after).toBe(actors.get("member")!.id);
  });

  it("keeps the audit row of a private transaction out of the household (privateAudit)", async () => {
    const created = await createTransaction(ids.privateAccount).expect(201);
    const [row] = await ruleAudits(created.body.data.id);
    expect(row.household_id).toBeNull();
    expect(row.details.ruleId).toBe(ruleId);
  });

  it("rolls the change back with the apply when the audit insert fails", async () => {
    await pool.query(`create or replace function block_rule_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'transaction' and new.action = 'UPDATE' and new.details ? 'ruleId' then
          raise exception 'audit blocked for test';
        end if;
        return new;
      end $$`);
    await pool.query("create trigger block_rule_audit before insert on audit_logs for each row execute function block_rule_audit()");
    try {
      // The transaction itself is still created; the failed rule apply leaves it un-ruled.
      const created = await createTransaction(ids.sharedAccount).expect(201);
      const [stored] = await db.select().from(transactions).where(eq(transactions.id, created.body.data.id));
      expect(stored.ownerUserId).toBe(actors.get("owner")!.id);
      expect(stored.categoryId).toBeNull();
      expect(await ruleAudits(stored.id)).toHaveLength(0);
      const events = await pool.query(
        "select 1 from outbox_events where aggregate_id=$1 and event_type='transaction.updated'", [stored.id]);
      expect(events.rowCount).toBe(0);
    } finally {
      await pool.query("drop trigger if exists block_rule_audit on audit_logs");
    }
  });
});
