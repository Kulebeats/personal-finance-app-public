import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rules } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, b, actors, app, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const trigger = `r08_rule_audit_${randomUUID().replaceAll("-", "")}`;
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const body = (name: string, priority = 0) => ({ name, priority,
  conditions: [{ type: "merchant_name", operator: "contains", value: "Rule audit source" }],
  actions: [{ type: "rename_merchant", value: "Reviewed merchant" }] });
let first: string, second: string;
async function snapshots() {
  return {
    rules: (await pool.query("select * from rules where household_id=$1 order by id", [a])).rows,
    audits: (await pool.query("select * from audit_logs where user_id=$1 order by id", [actors.get("owner")!.id])).rows,
  };
}
async function dropFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}
async function rejectAudit(entityId?: string) {
  await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id='${actors.get("owner")!.id}'::uuid AND NEW.entity_type IN ('rule','rule_order')
        AND (${entityId ? `NEW.entity_id='${entityId}'::uuid` : 'true'}) THEN
        RAISE EXCEPTION 'Synthetic mandatory rule audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}
type Operation = "create" | "update" | "delete" | "reorder" | "bulk enable" | "bulk disable";
const operations: Operation[] = ["create", "update", "delete", "reorder", "bulk enable", "bulk disable"];
function run(operation: Operation) {
  switch (operation) {
    case "create": return signed(request(app).post("/api/rules")).send(body("Third rule"));
    case "update": return signed(request(app).put(`/api/rules/${first}`)).send({ name: "Changed rule" });
    case "delete": return signed(request(app).delete(`/api/rules/${first}`));
    case "reorder": return signed(request(app).put("/api/rules/reorder")).send({ rules: [{ id: second, priority: 0 }, { id: first, priority: 1 }] });
    case "bulk enable": return signed(request(app).post("/api/rules/bulk-enable")).send({ ruleIds: [first, second] });
    case "bulk disable": return signed(request(app).post("/api/rules/bulk-disable")).send({ ruleIds: [first, second] });
  }
}
async function prepare(operation: Operation) {
  if (operation === "bulk enable") await db.update(rules).set({ enabled: false }).where(inArray(rules.id, [first, second]));
}
describe("R08 NEW-32 mandatory audit atomicity for signed rule writes", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await dropFailure();
    await db.delete(rules).where(inArray(rules.householdId, [a, b]));
    await reset();
    first = (await signed(request(app).post("/api/rules")).send(body("First rule", 0)).expect(201)).body.data.rule.id;
    second = (await signed(request(app).post("/api/rules")).send(body("Second rule", 1)).expect(201)).body.data.rule.id;
  });
  afterEach(dropFailure);
  afterAll(async () => { await dropFailure(); await db.delete(rules).where(inArray(rules.householdId, [a, b])); await stop(); });

  it.each(operations)("rolls back %s when its mandatory audit cannot be inserted", async operation => {
    await prepare(operation);
    const before = await snapshots();
    await rejectAudit();
    const result = await run(operation);
    expect.soft(result.status).toBe(500);
    expect(await snapshots()).toEqual(before);
  });

  it.each(["bulk enable", "bulk disable"] as const)("rolls back the whole %s when its later audit fails", async operation => {
    await prepare(operation);
    const before = await snapshots();
    const later = [first, second].sort()[1];
    await rejectAudit(later);
    const result = await run(operation);
    expect(result.status).toBe(500);
    expect(await snapshots()).toEqual(before);
  });

  it.each(operations)("records one audit per affected rule on successful %s", async operation => {
    await prepare(operation);
    const before = await snapshots();
    const result = await run(operation);
    expect(result.status).toBe(operation === "create" ? 201 : 200);
    const after = await snapshots();
    const prior = new Set(before.audits.map(row => row.id));
    const added = after.audits.filter(row => !prior.has(row.id));
    expect(added).toHaveLength(operation.startsWith("bulk") ? 2 : 1);
    expect(added.every(row => row.user_id === actors.get("owner")!.id && row.household_id === a)).toBe(true);
    if (operation.startsWith("bulk")) {
      const expectedOperation = operation === "bulk enable" ? "bulkEnable" : "bulkDisable";
      for (const row of added) expect(row.details).toMatchObject({ operation: expectedOperation, batchSize: 2 });
    }
    const expectedAction = operation === "create" ? "CREATE" : operation === "delete" ? "DELETE" : "UPDATE";
    expect(added.map(row => row.action)).toEqual(Array(added.length).fill(expectedAction));
    expect(added.map(row => row.entity_id).sort()).toEqual(operation === "create" ? [result.body.data.rule.id]
      : operation === "reorder" ? [a] : operation.startsWith("bulk") ? [first, second].sort() : [first]);
  });
  it.each(["bulk enable", "bulk disable"] as const)("canonicalizes repeated rule IDs for %s without duplicate audit", async operation => {
    await prepare(operation);
    const before = await snapshots();
    const path = operation === "bulk enable" ? "/api/rules/bulk-enable" : "/api/rules/bulk-disable";
    const result = await signed(request(app).post(path))
      .send({ ruleIds: [second, first.toUpperCase(), second] }).expect(200);
    expect(result.body.data.count).toBe(2);
    expect(result.body.data.rules.map((row: { id: string }) => row.id)).toEqual([second, first]);
    const prior = new Set(before.audits.map(row => row.id));
    const added = (await snapshots()).audits.filter(row => !prior.has(row.id));
    expect(added.map(row => row.entity_id).sort()).toEqual([first, second].sort());
    for (const row of added) expect(row.details).toMatchObject({ batchSize: 2 });
  });

});
