import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { outboxEvents, rules, transactionSplits, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { ruleService } from "../../../services/RuleService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const condition = { type: "merchant_name", operator: "contains", value: "Split allocation source" };
const action = (splitConfig: object[]) => ({ type: "split_transaction", value: "", splitConfig });
const config = [{ percentage: 60 }, { percentage: 60 }];
const author = (splitConfig = [{ percentage: 60 }, { percentage: 40 }]) => signed(request(app).post("/api/rules"))
  .send({ name: "Exact split allocation", conditions: [condition], actions: [action(splitConfig)] });
async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}
async function state() {
  return {
    rules: (await pool.query("select * from rules where household_id=$1 order by id", [a])).rows,
    accounts: (await pool.query("select * from accounts where household_id=$1 order by id", [a])).rows,
    postings: (await pool.query("select * from transactions where household_id=$1 order by id", [a])).rows,
    splits: (await pool.query("select s.* from transaction_splits s join transactions t on t.id=s.transaction_id where t.household_id=$1 order by s.id", [a])).rows,
    tags: (await pool.query("select * from tags where household_id=$1 order by id", [a])).rows,
    links: (await pool.query("select tt.* from transaction_tags tt join transactions t on t.id=tt.transaction_id where t.household_id=$1 order by tt.id", [a])).rows,
    audit: (await pool.query("select * from audit_logs where household_id=$1 or user_id=$2 order by id", [a, actors.get("owner")!.id])).rows,
  };
}
describe("R08 rule allocation admission and transactional application", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it("rejects a signed 60+60 percentage rule before persisting rule or audit", async () => {
    const before = await state();
    await author(config).expect(400);
    expect(await state()).toEqual(before);
  });

  it("preserves the authored rule and audit when an update declares 60+60", async () => {
    const created = await author().expect(201);
    const before = await state();
    await signed(request(app).put(`/api/rules/${created.body.data.rule.id}`))
      .send({ actions: [action(config)] }).expect(400);
    expect(await state()).toEqual(before);
  });

  it.each(["ordinary enable", "bulk enable"])("refuses a malformed legacy allocation on %s", async operation => {
    const created = await author().expect(201);
    const id = created.body.data.rule.id;
    await db.update(rules).set({ actions: [action(config)], enabled: false }).where(eq(rules.id, id));
    const before = await state();
    if (operation === "ordinary enable") await signed(request(app).put(`/api/rules/${id}`)).send({ enabled: true }).expect(400);
    else await signed(request(app).post("/api/rules/bulk-enable")).send({ ruleIds: [id] }).expect(400);
    expect(await state()).toEqual(before);
    await signed(request(app).put(`/api/rules/${id}`)).send({ enabled: false }).expect(200);
  });

  // The numeric case sums to the parent exactly, so its refusal can only come from the float amount.
  it.each([
    ["a stored fixed allocation exceeds its signed parent", [{ amount: "80.00" }, { amount: "30.00" }]],
    ["a stored legacy allocation uses numeric (float) amounts", [{ amount: 60 }, { amount: 40 }]],
  ])("rolls back earlier tag effects when %s", async (_label, splitConfig) => {
    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount,
      name: "Split allocation source", date: "2026-02-12", type: "expense", amount: { amount: "100.00", currency: "ZMW" },
      splits: [{ amount: { amount: "60.00", currency: "ZMW" } }, { amount: { amount: "40.00", currency: "ZMW" } }],
      idempotencyKey: randomUUID() }).expect(201);
    const id = created.body.data.id;
    const [posting] = await db.select().from(transactions).where(eq(transactions.id, id));
    await db.insert(rules).values({ householdId: a, name: "Legacy split rule", priority: 0, enabled: true,
      conditions: [condition], actions: [{ type: "add_tags", value: [ids.tag] }, action(splitConfig)] });
    const before = await state();
    await expect(ruleService.applyRules(posting, a, { userId: actors.get("owner")!.id })).rejects.toMatchObject({ statusCode: 400 });
    expect(await state()).toEqual(before);
    expect((await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows).toEqual([{ balance: "888.89" }]);
  });

  it("persists rounded ten-cent allocations without losing or inventing cents", async () => {
    await author([{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }]).expect(201);
    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount,
      name: "Split allocation source", date: "2026-02-12", type: "expense", amount: { amount: "0.10", currency: "ZMW" },
      idempotencyKey: randomUUID() }).expect(201);
    const rows = await db.select({ amount: transactionSplits.amount }).from(transactionSplits)
      .where(eq(transactionSplits.transactionId, created.body.data.id)).orderBy(transactionSplits.displayOrder);
    expect(rows).toEqual([{ amount: "0.03" }, { amount: "0.04" }, { amount: "0.03" }]);
    expect((await pool.query("select balance from accounts where id=$1", [ids.sharedAccount])).rows).toEqual([{ balance: "988.79" }]);
  });
});
