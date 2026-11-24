import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { outboxEvents, rules, transactionSplits } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// ORG-005 pin: a rule split is admitted and applied as Money, never as a float.
// Neighbouring R08 cases already pin 60+60 at authoring, a stored float amount
// refused at apply, and ten-cent rounding. These pin the remaining edges over
// real HTTP and Postgres.
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const condition = { type: "merchant_name", operator: "contains", value: "Money pinned split source" };
const author = (splitConfig: object[]) => signed(request(app).post("/api/rules"))
  .send({ name: "ORG-005 split rule", conditions: [condition], actions: [{ type: "split_transaction", value: "", splitConfig }] });
async function storedRules() {
  return (await pool.query("select id, actions from rules where household_id=$1 order by id", [a])).rows;
}
async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}
async function postAndReadSplits(amount: string) {
  const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount,
    name: "Money pinned split source", date: "2026-02-12", type: "expense", amount: { amount, currency: "ZMW" },
    idempotencyKey: randomUUID() });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const rows = await db.select({ amount: transactionSplits.amount }).from(transactionSplits)
    .where(eq(transactionSplits.transactionId, created.body.data.id)).orderBy(transactionSplits.displayOrder);
  return rows.map(row => row.amount);
}

describe("ORG-005 rule split allocations are Money end to end", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it("stores a fixed split amount as the decimal string it was given", async () => {
    await author([{ amount: "25.00" }, {}]).expect(201);
    const [stored] = await storedRules();
    expect(stored.actions[0].splitConfig[0]).toEqual({ amount: "25.00" });
  });

  it.each([
    ["a JSON number", 25],
    ["more than currency scale", "25.001"],
    ["zero", "0.00"],
    ["a negative amount", "-5.00"],
    ["exponent notation", "2.5e1"],
  ])("refuses a fixed split amount given as %s before persisting anything", async (_label, amount) => {
    const response = await author([{ amount }, {}]);
    expect(response.status).toBe(400);
    expect(await storedRules()).toEqual([]);
  });

  it.each([
    ["percentages 60 + 60", [{ percentage: 60 }, { percentage: 60 }]],
    ["a fixed amount plus 100%", [{ amount: "10.00" }, { percentage: 100 }]],
  ])("refuses %s as more than the parent", async (_label, splitConfig) => {
    const response = await author(splitConfig);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("Split percentages exceed the parent amount");
    expect(await storedRules()).toEqual([]);
  });

  it("sums percentages as decimals: 64.1 + 0.1 + 35.8 is 100 even though floats make it 99.99999999999999", async () => {
    expect(64.1 + 0.1 + 35.8).not.toBe(100);
    await author([{ percentage: 64.1 }, { percentage: 0.1 }, { percentage: 35.8 }]).expect(201);
    const splits = await postAndReadSplits("10.00");
    expect(splits).toEqual(["6.41", "0.01", "3.58"]);
  });

  it("keeps the parent total across a fixed amount, a percentage and the remainder", async () => {
    await author([{ amount: "25.00" }, { percentage: 33.33 }, {}]).expect(201);
    const splits = await postAndReadSplits("100.00");
    expect(splits).toEqual(["25.00", "33.33", "41.67"]);
  });
});
