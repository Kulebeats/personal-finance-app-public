/**
 * C3-09: a rule dry run must change nothing — REAL HTTP, REAL DB.
 *
 * The defect: POST /api/rules/:id/dry-run called the same action evaluator as a
 * real apply, which wrote tag links (+ usage count), merchant aliases and a
 * split replacement. A dry run of a split rule on a transaction that already
 * had manual splits replaced them, with no audit row.
 *
 * The proof: snapshot every table the actions can touch, call the dry-run
 * route for a rule with tag + merchant-alias + split actions on a transaction
 * that already has manual splits, assert nothing moved and the response
 * describes the proposed changes. The control then applies the same rule for
 * real and asserts the very same rows DO change.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { merchants, outboxEvents, rules, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { ruleService } from "../../../services/RuleService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const SOURCE_NAME = "Dry run source";
const ALIAS = "DRYRUN ALIAS";
const condition = { type: "merchant_name", operator: "contains", value: SOURCE_NAME };
const ruleActions = () => [
  { type: "add_tags", value: [ids.tag] },
  { type: "add_merchant_alias", value: ALIAS },
  { type: "split_transaction", value: "", splitConfig: [{ percentage: 50 }, { percentage: 50 }] },
];
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);

async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await pool.query("update transactions set merchant_id=null where household_id=$1", [a]);
  await db.delete(merchants).where(eq(merchants.householdId, a));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}

async function snapshot() {
  const rows = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
  return {
    tagLinks: await rows("select tt.* from transaction_tags tt join transactions t on t.id=tt.transaction_id where t.household_id=$1 order by tt.id", [a]),
    tagUsage: await rows("select id, usage_count from tags where household_id=$1 order by id", [a]),
    aliases: await rows("select ma.* from merchant_aliases ma join merchants m on m.id=ma.merchant_id where m.household_id=$1 order by ma.id", [a]),
    splits: await rows("select s.* from transaction_splits s join transactions t on t.id=s.transaction_id where t.household_id=$1 order by s.id", [a]),
    transactions: await rows("select * from transactions where household_id=$1 order by id", [a]),
    accounts: await rows("select * from accounts where household_id=$1 order by id", [a]),
    audit: await rows("select * from audit_logs where household_id=$1 or user_id=$2 order by id", [a, actors.get("owner")!.id]),
    outbox: await rows("select * from outbox_events where household_id=$1 order by id", [a]),
  };
}

async function seedTransactionWithManualSplits() {
  const merchantId = randomUUID();
  await db.insert(merchants).values({ id: merchantId, householdId: a, name: "Dry run merchant" });
  const created = await signed(request(app).post("/api/transactions")).send({
    accountId: ids.sharedAccount, name: SOURCE_NAME, date: "2026-02-12", type: "expense",
    amount: { amount: "100.00", currency: "ZMW" },
    splits: [{ amount: { amount: "70.00", currency: "ZMW" } }, { amount: { amount: "30.00", currency: "ZMW" } }],
    idempotencyKey: randomUUID(),
  }).expect(201);
  const transactionId = created.body.data.id as string;
  await pool.query("update transactions set merchant_id=$1 where id=$2", [merchantId, transactionId]);
  return { merchantId, transactionId };
}

async function authorRule(applyToPast: boolean) {
  const res = await signed(request(app).post("/api/rules")).send({
    name: "Dry run rule", conditions: [condition], actions: ruleActions(), applyToPast,
  }).expect(201);
  return res.body.data.rule.id as string;
}

describe("C3-09 rule dry run writes nothing", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it("leaves tag links, usage counts, aliases, splits, audit and outbox unchanged and describes the proposal", async () => {
    const { merchantId, transactionId } = await seedTransactionWithManualSplits();
    const ruleId = await authorRule(false);
    const before = await snapshot();
    expect(before.splits.map((s) => s.amount).sort()).toEqual(["30.00", "70.00"]);

    const res = await signed(request(app).post(`/api/rules/${ruleId}/dry-run`))
      .send({ transactionId }).expect(200);

    expect(await snapshot()).toEqual(before);

    const data = res.body.data;
    expect(data.matches).toBe(true);
    expect(data.proposedTagIds).toEqual([ids.tag]);
    expect(data.proposedMerchantAliases).toEqual([{ merchantId, aliasName: ALIAS }]);
    expect(data.proposedSplits.map((s: { amount: string }) => s.amount)).toEqual(["50.00", "50.00"]);
  });

  it("applyRules with dryRun returns the planned effects and writes nothing", async () => {
    const { merchantId, transactionId } = await seedTransactionWithManualSplits();
    await authorRule(false);
    const [posting] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    const before = await snapshot();

    const preview = await ruleService.applyRules(posting, a, { userId: actors.get("owner")!.id, dryRun: true });

    expect(await snapshot()).toEqual(before);
    expect(preview).toMatchObject({
      id: transactionId,
      proposedTagIds: [ids.tag],
      proposedMerchantAliases: [{ merchantId, aliasName: ALIAS }],
      linkGoalIds: [],
    });
    expect((preview as unknown as { proposedSplits: Array<{ amount: string }> }).proposedSplits.map((x) => x.amount)).toEqual(["50.00", "50.00"]);
  });

  it("control: a real apply of the same rule changes those same rows", async () => {
    const { transactionId } = await seedTransactionWithManualSplits();
    const before = await snapshot();

    await authorRule(true);
    const after = await snapshot();

    expect(after.tagLinks.length).toBe(before.tagLinks.length + 1);
    expect(after.tagUsage).not.toEqual(before.tagUsage);
    expect(after.aliases.map((r) => r.alias_name)).toEqual([ALIAS]);
    const splitsOfTransaction = after.splits.filter((s) => s.transaction_id === transactionId);
    expect(splitsOfTransaction.map((s) => s.amount)).toEqual(["50.00", "50.00"]);
  });
});
