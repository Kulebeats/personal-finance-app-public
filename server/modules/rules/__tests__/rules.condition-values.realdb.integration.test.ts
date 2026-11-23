/**
 * NEW-36: a rule condition's value must fit its field. An amount condition took any string
 * ("abc" never matches, silently), a text condition took an unbounded string, and a
 * transaction-type condition took any word. Real HTTP against real Postgres: every refusal
 * is a 400 that writes no rule row; well-typed conditions still save.
 */
import request from "supertest";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rules } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const createRule = (condition: Record<string, unknown>) => request(app).post("/api/rules")
  .set("Cookie", actors.get("owner")!.cookie).set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a)
  .send({ name: "Typed condition rule", conditions: [condition], actions: [{ type: "mark_reviewed" }] });
const ruleCount = async () => (await db.select({ id: rules.id }).from(rules).where(inArray(rules.householdId, [a, b]))).length;

const refused = [
  { label: "a non-numeric amount", condition: { type: "amount", operator: "equals", value: "abc" } },
  { label: "an amount with three decimals", condition: { type: "amount", operator: "greater_than", value: "10.005" } },
  { label: "a negative amount", condition: { type: "amount", operator: "less_than", value: "-5.00" } },
  { label: "a numeric amount (money is a string)", condition: { type: "amount", operator: "equals", value: 50 } },
  { label: "a text operator on an amount", condition: { type: "amount", operator: "contains", value: "10.00" } },
  { label: "an amount range without an upper bound", condition: { type: "amount", operator: "range", value: "10.00" } },
  { label: "an amount range whose upper bound is below its lower", condition: { type: "amount", operator: "range", value: "50.00", value2: "10.00" } },
  { label: "a number operator on text", condition: { type: "merchant_name", operator: "greater_than", value: "Shop" } },
  { label: "an empty text value", condition: { type: "merchant_name", operator: "contains", value: "" } },
  { label: "an unbounded text value", condition: { type: "description", operator: "contains", value: "x".repeat(256) } },
  { label: "a list as a text value", condition: { type: "merchant_name", operator: "equals", value: ["Shop"] } },
  { label: "an unknown transaction type", condition: { type: "transaction_type", operator: "equals", value: "loan" } },
  { label: "a malformed account id", condition: { type: "account", operator: "equals", value: "not-an-id" } },
  { label: "a malformed category id", condition: { type: "category", operator: "not_equals", value: "not-an-id" } },
] as const;

describe("NEW-36 rule condition values are typed by field (real Postgres)", () => {
  beforeAll(async () => { await start(); }, 30000);
  beforeEach(async () => {
    await db.delete(rules).where(inArray(rules.householdId, [a, b]));
    await reset();
  });
  afterAll(async () => {
    await db.delete(rules).where(inArray(rules.householdId, [a, b]));
    await stop();
  });

  it.each(refused)("refuses $label with 400 and writes no rule", async ({ condition }) => {
    const res = await createRule(condition);
    expect(res.status).toBe(400);
    expect(await ruleCount()).toBe(0);
  });

  it.each([
    { label: "an amount range", condition: { type: "amount", operator: "range", value: "10.00", value2: "50" } },
    { label: "a whole amount", condition: { type: "amount", operator: "greater_than", value: "100" } },
    { label: "a text match", condition: { type: "original_statement", operator: "starts_with", value: "POS " } },
    { label: "the merchant category Other with its detail", condition: { type: "merchant_category", operator: "equals", value: "Other", value2: "Synthetic detail" } },
    { label: "a transaction type", condition: { type: "transaction_type", operator: "equals", value: "expense" } },
    { label: "an account id", condition: { type: "account", operator: "equals", value: "00000000-0000-4000-8000-000000000001" } },
  ])("saves $label", async ({ condition }) => {
    const res = await createRule(condition);
    expect(res.status).toBe(201);
    expect(await ruleCount()).toBe(1);
  });
});
