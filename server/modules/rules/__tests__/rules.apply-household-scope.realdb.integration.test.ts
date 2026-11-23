/**
 * ORG-003: rule APPLY resolves every category and tag id in the rule's actions
 * against the transaction's household, inside the apply transaction. REAL HTTP, REAL DB.
 *
 * Save and edit already refuse foreign ids, so the rules here are legacy rows
 * inserted straight into the database. A foreign or missing id skips the action
 * that names it, the run reports the blocked ids (dry-run response and the
 * apply's audit details), and nothing is written for that id.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, outboxEvents, rules, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { ruleService } from "../../../services/RuleService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const SOURCE = "Scope source";
const condition = { type: "merchant_name", operator: "contains", value: SOURCE };
const owner = () => actors.get("owner")!.id;
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", owner()).set("X-Capital-Household", a);

let ownCategory: string;
let foreignCategory: string;

async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
}

async function seedCategories() {
  ownCategory = randomUUID(); foreignCategory = randomUUID();
  await db.insert(categories).values([
    { id: ownCategory, householdId: a, name: "Scope own", displayOrder: 1 },
    { id: foreignCategory, householdId: b, name: "Scope FOREIGN", displayOrder: 1 },
  ]);
}

/** A legacy rule row: inserted directly, so save-time validation never ran. */
async function legacyRule(actions: unknown[]) {
  const [rule] = await db.insert(rules).values({
    householdId: a, name: "Legacy scope rule", enabled: true, priority: 1,
    conditions: [condition], conditionLogic: "all", actions,
  }).returning();
  return rule;
}

async function sourceTransaction() {
  const id = randomUUID();
  await db.insert(transactions).values({
    id, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner(), date: "2026-10-05",
    name: `${SOURCE} purchase`, amount: "100.00", currency: "ZMW", type: "expense", isPrivate: false,
  });
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

async function foreignState() {
  return {
    tags: (await pool.query("select id, usage_count from tags where household_id=$1 order by id", [b])).rows,
    links: (await pool.query("select * from transaction_tags where tag_id=$1", [ids.foreignTag])).rows,
    splits: (await pool.query("select * from transaction_splits where category_id=$1", [foreignCategory])).rows,
    categorized: (await pool.query("select id from transactions where category_id=$1", [foreignCategory])).rows,
  };
}

async function transactionState(id: string) {
  return {
    row: (await pool.query("select category_id, notes, updated_at from transactions where id=$1", [id])).rows,
    links: (await pool.query("select tag_id from transaction_tags where transaction_id=$1 order by tag_id", [id])).rows,
    splits: (await pool.query("select * from transaction_splits where transaction_id=$1", [id])).rows,
  };
}

async function applyAudit(transactionId: string) {
  return (await pool.query(
    "select household_id, details from audit_logs where entity_id=$1 and details->>'source'='rule_apply' order by created_at",
    [transactionId],
  )).rows;
}

const tagUsage = async (id: string) =>
  (await pool.query("select usage_count from tags where id=$1", [id])).rows[0].usage_count;

describe("ORG-003 rule apply re-resolves category and tag ids in the transaction's household", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seedCategories(); });
  afterAll(async () => { await clean(); await stop(); });

  it("skips a foreign category and a foreign tag, writes nothing for them, and audits the blocked ids", async () => {
    const missingTag = randomUUID();
    const rule = await legacyRule([
      { type: "categorize", value: foreignCategory },
      { type: "add_tags", value: [ids.foreignTag] },
      { type: "add_tags", value: [missingTag] },
    ]);
    const transaction = await sourceTransaction();
    const foreignBefore = await foreignState();
    const before = await transactionState(transaction.id);

    await ruleService.applyRules(transaction, a, { userId: owner() });

    expect(await foreignState()).toEqual(foreignBefore);
    expect(await tagUsage(ids.foreignTag)).toBe(0);
    expect(await transactionState(transaction.id)).toEqual(before);
    const audit = await applyAudit(transaction.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].household_id).toBe(a);
    expect(audit[0].details.blockedReferences).toEqual([
      { ruleId: rule.id, categoryIds: [foreignCategory], tagIds: [ids.foreignTag, missingTag] },
    ]);
    expect(audit[0].details.changes).toEqual({});
  });

  it("skips a split that names a foreign category: no split rows, no note, blocked id audited", async () => {
    const rule = await legacyRule([{ type: "split_transaction", value: "", splitConfig: [
      { categoryId: ownCategory, percentage: 50 }, { categoryId: foreignCategory, percentage: 50 },
    ] }]);
    const transaction = await sourceTransaction();
    const foreignBefore = await foreignState();
    const before = await transactionState(transaction.id);

    await ruleService.applyRules(transaction, a, { userId: owner() });

    expect(await foreignState()).toEqual(foreignBefore);
    expect(await transactionState(transaction.id)).toEqual(before);
    const audit = await applyAudit(transaction.id);
    expect(audit.map((row) => row.details.blockedReferences)).toEqual([
      [{ ruleId: rule.id, categoryIds: [foreignCategory], tagIds: [] }],
    ]);
  });

  it("applies over real HTTP: a created transaction keeps only the own-household effects", async () => {
    const rule = await legacyRule([
      { type: "categorize", value: foreignCategory },
      { type: "add_tags", value: [ids.foreignTag] },
      { type: "add_tags", value: [ids.tag] },
    ]);
    const foreignBefore = await foreignState();
    const ownUsage = await tagUsage(ids.tag);

    const created = await signed(request(app).post("/api/transactions")).send({
      accountId: ids.sharedAccount, name: `${SOURCE} via HTTP`, date: "2026-10-06", type: "expense",
      amount: { amount: "12.00", currency: "ZMW" }, idempotencyKey: randomUUID(),
    }).expect(201);
    const id = created.body.data.id;

    expect(await foreignState()).toEqual(foreignBefore);
    const after = await transactionState(id);
    expect(after.row[0].category_id).toBeNull();
    expect(after.links).toEqual([{ tag_id: ids.tag }]);
    expect(await tagUsage(ids.tag)).toBe(ownUsage + 1);
    const audit = await applyAudit(id);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.blockedReferences).toEqual([
      { ruleId: rule.id, categoryIds: [foreignCategory], tagIds: [ids.foreignTag] },
    ]);
    expect(audit[0].details.effects).toEqual({ tagIds: [ids.tag] });
  });

  it("dry-run proposes no foreign effect, reports the blocked ids, and writes nothing", async () => {
    const rule = await legacyRule([
      { type: "categorize", value: foreignCategory },
      { type: "add_tags", value: [ids.foreignTag] },
      { type: "split_transaction", value: "", splitConfig: [{ categoryId: foreignCategory, percentage: 100 }] },
    ]);
    const transaction = await sourceTransaction();
    const foreignBefore = await foreignState();
    const before = await transactionState(transaction.id);

    const res = await signed(request(app).post(`/api/rules/${rule.id}/dry-run`))
      .send({ transactionId: transaction.id }).expect(200);

    expect(res.body.data.matches).toBe(true);
    expect(res.body.data.proposedUpdates).toEqual({});
    expect(res.body.data.proposedTagIds).toEqual([]);
    expect(res.body.data.proposedSplits).toEqual([]);
    expect(res.body.data.blockedReferences).toEqual([
      { ruleId: rule.id, categoryIds: [foreignCategory], tagIds: [ids.foreignTag] },
    ]);
    // The whole-household preview (applyRules dryRun) reports the same way.
    const preview = await ruleService.applyRules(transaction, a, { userId: owner(), dryRun: true });
    expect(preview).toMatchObject({ categoryId: null, proposedTagIds: [], proposedSplits: [] });
    expect(await foreignState()).toEqual(foreignBefore);
    expect(await transactionState(transaction.id)).toEqual(before);
    expect(await applyAudit(transaction.id)).toEqual([]);
  });

  it("keeps today's behaviour for this household's own category and tag", async () => {
    await legacyRule([{ type: "categorize", value: ownCategory }, { type: "add_tags", value: [ids.tag] }]);
    const transaction = await sourceTransaction();
    const ownUsage = await tagUsage(ids.tag);

    await ruleService.applyRules(transaction, a, { userId: owner() });

    const [row] = await db.select().from(transactions)
      .where(and(eq(transactions.id, transaction.id), eq(transactions.householdId, a)));
    expect(row.categoryId).toBe(ownCategory);
    expect((await transactionState(transaction.id)).links).toEqual([{ tag_id: ids.tag }]);
    expect(await tagUsage(ids.tag)).toBe(ownUsage + 1);
    const audit = await applyAudit(transaction.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.blockedReferences).toBeUndefined();
  });
});
