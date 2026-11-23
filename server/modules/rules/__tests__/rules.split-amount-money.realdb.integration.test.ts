/**
 * Register re-check defect 10: a rule's fixed split amount is money, so it is
 * accepted only as a positive decimal string at currency scale (the same
 * string form as every other amount), never as a float. Real HTTP against
 * the real rules router and real Postgres; the rule applies on a posting.
 */
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { outboxEvents, rules, transactionSplits } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const condition = { type: "merchant_name", operator: "contains", value: "Split amount source" };
const author = (splitConfig: object[]) => signed(request(app).post("/api/rules"))
  .send({ name: "Fixed split amount", conditions: [condition],
    actions: [{ type: "split_transaction", value: "", splitConfig }] });

async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}

async function storedRuleCount(): Promise<number> {
  return (await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, a))).length;
}

describe("defect 10: rule split amounts are decimal money strings (real Postgres)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it("accepts a decimal-string fixed amount and allocates it exactly on a posting", async () => {
    await author([{ amount: "25.00" }, {}]).expect(201);

    const created = await signed(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount,
      name: "Split amount source", date: "2026-02-12", type: "expense", amount: { amount: "100.00", currency: "ZMW" },
      idempotencyKey: randomUUID() }).expect(201);

    const rows = await db.select({ amount: transactionSplits.amount }).from(transactionSplits)
      .where(eq(transactionSplits.transactionId, created.body.data.id)).orderBy(transactionSplits.displayOrder);
    expect(rows).toEqual([{ amount: "25.00" }, { amount: "75.00" }]);
  });

  it.each([
    ["a float number", 25],
    ["a sub-cent string", "25.001"],
    ["zero", "0"],
    ["a negative string", "-5.00"],
    ["a non-numeric string", "twenty"],
  ])("refuses %s as a split amount and stores nothing", async (_label, amount) => {
    const res = await author([{ amount }, {}]);

    expect(res.status).toBe(400);
    expect(await storedRuleCount()).toBe(0);
  });
});
