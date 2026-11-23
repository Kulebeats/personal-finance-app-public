/**
 * PUT /api/rules/reorder validates its body: an array of { id: uuid, priority } with no
 * duplicate ids and a bounded length (400), and every rule must belong to the caller's
 * household. Real HTTP against real Postgres; no write happens on a refused request.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rules } from "@shared/schema";
import { db, pool } from "../../../db";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";

const MAX_RULES = 500;
let home: SignedHousehold;
let other: SignedHousehold;
let first: string;
let second: string;
let foreign: string;

async function seedRule(householdId: string, name: string, priority: number): Promise<string> {
  const [row] = await db.insert(rules).values({
    householdId, name, enabled: true, priority, conditionLogic: "all",
    conditions: [{ type: "merchant_name", operator: "contains", value: "x", enabled: true }],
    actions: [{ type: "categorize", value: "x", enabled: true }],
  }).returning({ id: rules.id });
  return row.id;
}

async function priorities() {
  return (await pool.query("SELECT id, priority FROM rules WHERE id = ANY($1::uuid[]) ORDER BY id", [[first, second, foreign]])).rows;
}

const reorder = (body: unknown) => request(home.app).put("/api/rules/reorder").set(home.headers).send(body as object);

describe("PUT /api/rules/reorder (real Postgres)", () => {
  beforeAll(async () => {
    home = await createSignedHousehold("rules-reorder-home");
    other = await createSignedHousehold("rules-reorder-other");
    first = await seedRule(home.householdId, "First", 0);
    second = await seedRule(home.householdId, "Second", 1);
    foreign = await seedRule(other.householdId, "Foreign", 0);
  }, 30000);

  afterAll(async () => {
    if (home) await home.cleanup(async () => { await db.delete(rules).where(eq(rules.householdId, home.householdId)); });
    if (other) await other.cleanup(async () => { await db.delete(rules).where(eq(rules.householdId, other.householdId)); });
  });

  it("reorders the household's rules", async () => {
    await reorder({ rules: [{ id: second, priority: 0 }, { id: first, priority: 1 }] }).expect(200);

    const saved = Object.fromEntries((await priorities()).map(row => [row.id, row.priority]));
    expect(saved[second]).toBe(0);
    expect(saved[first]).toBe(1);
  });

  const invalid: ReadonlyArray<readonly [string, () => unknown]> = [
    ["a non-array body", () => ({ rules: "nope" })],
    ["a missing rules key", () => ({})],
    ["an empty list", () => ({ rules: [] })],
    ["a non-uuid id", () => ({ rules: [{ id: "not-a-uuid", priority: 0 }] })],
    ["a duplicate id", () => ({ rules: [{ id: first, priority: 0 }, { id: first, priority: 1 }] })],
    ["a negative priority", () => ({ rules: [{ id: first, priority: -1 }] })],
    ["a fractional priority", () => ({ rules: [{ id: first, priority: 0.5 }] })],
    ["more rules than the bound", () => ({ rules: Array.from({ length: MAX_RULES + 1 }, (_, priority) => ({ id: randomUUID(), priority })) })],
  ];

  it.each(invalid)("refuses %s with 400 and changes nothing", async (_label, body) => {
    const before = await priorities();

    const res = await reorder(body());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    expect(await priorities()).toEqual(before);
  });

  it("refuses another household's rule id with 404 and changes nothing", async () => {
    const before = await priorities();

    const res = await reorder({ rules: [{ id: first, priority: 1 }, { id: foreign, priority: 0 }] });

    expect(res.status).toBe(404);
    expect(await priorities()).toEqual(before);
  });
});
