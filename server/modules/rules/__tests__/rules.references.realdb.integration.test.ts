/**
 * ORG-003 / spec R04.3: every id-valued rule action is validated against the
 * saving household at save time and re-checked at apply time. REAL HTTP, REAL DB.
 *
 * Households: A (owner, admin, member, view_only, professional) and B (outsider),
 * from the shared R04 fixture. A rule that names an owner, member, goal or
 * merchant outside A, or one the saver may not use, is refused with a 400 and
 * leaves every rule row untouched.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, goals, merchants, rules, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { ruleService } from "../../../services/RuleService";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const condition = { type: "merchant_name", operator: "contains", value: "Refs source" };
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);
const createRule = (actions: unknown[]) =>
  signed(request(app).post("/api/rules")).send({ name: "Refs rule", conditions: [condition], actions });
const updateRule = (id: string, actions: unknown[]) =>
  signed(request(app).put(`/api/rules/${id}`)).send({ actions });

const userId = (role: "owner" | "admin" | "member" | "view_only" | "professional" | "outsider") => actors.get(role)!.id;

let goalA: string;
let goalB: string;
let privateGoalA: string;
let merchantA: string;
let merchantB: string;
let memberPrivateAccount: string;

async function clean() {
  await db.delete(rules).where(inArray(rules.householdId, [a, b]));
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(goals).where(inArray(goals.householdId, [a, b]));
  await db.delete(merchants).where(inArray(merchants.householdId, [a, b]));
}

async function seed() {
  goalA = randomUUID(); goalB = randomUUID(); privateGoalA = randomUUID();
  merchantA = randomUUID(); merchantB = randomUUID(); memberPrivateAccount = randomUUID();
  // reset() (re)creates the household accounts, so extras are seeded after it.
  await db.insert(accounts).values({
    id: memberPrivateAccount, householdId: a, name: "Member private", type: "checking", currency: "ZMW",
    balance: "0", isPrivate: true, ownerUserId: userId("member"),
  });
  await db.insert(goals).values([
    { id: goalA, householdId: a, name: "Shared goal", targetAmount: "100.00" },
    { id: goalB, householdId: b, name: "Foreign goal", targetAmount: "100.00" },
    // Tied to another member's private account: not visible to the owner.
    { id: privateGoalA, householdId: a, name: "Member private goal", targetAmount: "100.00", linkedAccountId: memberPrivateAccount },
  ]);
  await db.insert(merchants).values([
    { id: merchantA, householdId: a, name: "Refs merchant A" },
    { id: merchantB, householdId: b, name: "Refs merchant B" },
  ]);
}

async function ruleRows() {
  return (await pool.query("select id, name, enabled, actions, updated_at from rules where household_id=$1 order by id", [a])).rows;
}

describe("ORG-003 rule action reference validation (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterAll(async () => { await clean(); await stop(); });

  describe("set_owner", () => {
    it("refuses another household's user on create and leaves no rule behind", async () => {
      const before = await ruleRows();
      const res = await createRule([{ type: "set_owner", value: userId("outsider") }]);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Invalid rule owner reference");
      expect(await ruleRows()).toEqual(before);
    });

    it("refuses another household's user on update and leaves the stored rule unchanged", async () => {
      const created = await createRule([{ type: "set_owner", value: userId("member") }]).expect(201);
      const before = await ruleRows();
      const res = await updateRule(created.body.data.rule.id, [{ type: "set_owner", value: userId("outsider") }]);
      expect(res.status).toBe(400);
      expect(await ruleRows()).toEqual(before);
    });

    it("validates disabled actions and malformed values too", async () => {
      const before = await ruleRows();
      for (const action of [
        { type: "set_owner", value: userId("outsider"), enabled: false },
        { type: "set_owner", value: "not-a-uuid" },
        { type: "set_owner", value: randomUUID() },
      ]) {
        expect((await createRule([action])).status).toBe(400);
      }
      expect(await ruleRows()).toEqual(before);
    });

    it("refuses members who may not own transactions (view_only, professional)", async () => {
      for (const role of ["view_only", "professional"] as const) {
        const res = await createRule([{ type: "set_owner", value: userId(role) }]);
        expect(res.status, role).toBe(400);
        expect(res.body.error.message).toBe("Invalid rule owner reference");
      }
    });

    it("keeps today's behaviour for current members and for shared/empty", async () => {
      for (const value of [userId("member"), userId("admin"), "shared", ""]) {
        await createRule([{ type: "set_owner", value }]).expect(201);
      }
    });
  });

  describe("assign_member (removed, A-44)", () => {
    const removed = (res: request.Response) => {
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toEqual([expect.objectContaining({
        field: "actions.0.type",
        message: "The \"Assign member\" rule action was removed. Take it off this rule to save it.",
      })]);
    };

    it("refuses it on create, even for a current member, and leaves no rule behind", async () => {
      const before = await ruleRows();
      removed(await createRule([{ type: "assign_member", value: userId("member") }]));
      expect(await ruleRows()).toEqual(before);
    });

    it("refuses it on update and leaves the stored rule unchanged", async () => {
      const created = await createRule([{ type: "set_owner", value: userId("member") }]).expect(201);
      const before = await ruleRows();
      removed(await updateRule(created.body.data.rule.id, [{ type: "assign_member", value: userId("member") }]));
      expect(await ruleRows()).toEqual(before);
    });

    it("a rule stored with it before the removal still lists, edits and applies; the action does nothing", async () => {
      const created = await createRule([{ type: "set_owner", value: "shared" }]).expect(201);
      const ruleId = created.body.data.rule.id as string;
      // Stored before the removal: a member who has since left the household.
      await pool.query("update rules set actions = $1::jsonb where id = $2",
        [JSON.stringify([{ type: "assign_member", value: userId("outsider"), enabled: true }]), ruleId]);

      const list = await signed(request(app).get("/api/rules")).expect(200);
      expect(list.body.data.rules.find((rule: { id: string }) => rule.id === ruleId)?.actions)
        .toEqual([{ type: "assign_member", value: userId("outsider"), enabled: true }]);
      // An edit that does not carry the action (rename) still saves.
      await signed(request(app).put(`/api/rules/${ruleId}`)).send({ name: "Renamed" }).expect(200);

      const transactionId = randomUUID();
      await db.insert(transactions).values({
        id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: userId("owner"),
        date: "2026-10-08", name: "Refs source stored", amount: "5.00", type: "expense", isPrivate: false,
      });
      const [transaction] = await db.select().from(transactions).where(inArray(transactions.id, [transactionId]));
      // The executor ignores it: no throw over the departed member, the row is unchanged.
      await ruleService.applyRules(transaction, a, { userId: userId("owner") });
      const owner = await pool.query("select owner_user_id from transactions where id=$1", [transactionId]);
      expect(owner.rows[0].owner_user_id).toBe(userId("owner"));
    });
  });

  describe("link_goal", () => {
    it("refuses another household's goal and an unknown goal", async () => {
      const before = await ruleRows();
      for (const value of [goalB, randomUUID()]) {
        const res = await createRule([{ type: "link_goal", value }]);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe("Invalid rule goal reference");
      }
      expect(await ruleRows()).toEqual(before);
    });

    it("refuses a goal tied to another member's private account, accepts a shared goal", async () => {
      const before = await ruleRows();
      const hidden = await createRule([{ type: "link_goal", value: privateGoalA }]);
      expect(hidden.status).toBe(400);
      expect(hidden.body.error.message).toBe("Invalid rule goal reference");
      expect(await ruleRows()).toEqual(before);
      await createRule([{ type: "link_goal", value: goalA }]).expect(201);
    });
  });

  describe("set_merchant", () => {
    it("refuses another household's merchant, accepts this household's", async () => {
      const before = await ruleRows();
      const bad = await createRule([{ type: "set_merchant", value: merchantB }]);
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toBe("Invalid rule merchant reference");
      expect(await ruleRows()).toEqual(before);
      await createRule([{ type: "set_merchant", value: merchantA }]).expect(201);
    });
  });

  it("bulk enable with one bad stored action fails whole and enables nothing", async () => {
    const [good, bad] = await db.insert(rules).values([
      { householdId: a, name: "Bulk good", enabled: false, priority: 1, conditions: [condition], conditionLogic: "all",
        actions: [{ type: "set_owner", value: userId("member") }] },
      { householdId: a, name: "Bulk bad", enabled: false, priority: 2, conditions: [condition], conditionLogic: "all",
        actions: [{ type: "set_owner", value: userId("outsider") }] },
    ]).returning();
    const before = await ruleRows();
    const res = await signed(request(app).post("/api/rules/bulk-enable")).send({ ruleIds: [good.id, bad.id] });
    expect(res.status).toBe(400);
    expect(await ruleRows()).toEqual(before);
  });

  describe("apply time", () => {
    async function seedOwnerRuleAndTransaction() {
      const [rule] = await db.insert(rules).values({
        householdId: a, name: "Owner on apply", enabled: true, priority: 1, conditions: [condition],
        conditionLogic: "all", actions: [{ type: "set_owner", value: userId("member") }],
      }).returning();
      const transactionId = randomUUID();
      await db.insert(transactions).values({
        id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: userId("owner"),
        date: "2026-10-05", name: "Refs source purchase", amount: "10.00", type: "expense", isPrivate: false,
      });
      return { rule, transactionId };
    }
    const ownerOf = async (transactionId: string) =>
      (await pool.query("select owner_user_id from transactions where id=$1", [transactionId])).rows[0].owner_user_id;

    it("refuses to apply or dry-run once the owner has left, and writes no owner", async () => {
      const { rule, transactionId } = await seedOwnerRuleAndTransaction();
      // Control: while the member is current, the dry run proposes the owner.
      await signed(request(app).post(`/api/rules/${rule.id}/dry-run`)).send({ transactionId }).expect(200);

      await pool.query("delete from household_members where household_id=$1 and user_id=$2", [a, userId("member")]);

      const dryRun = await signed(request(app).post(`/api/rules/${rule.id}/dry-run`)).send({ transactionId });
      expect(dryRun.status).toBe(400);

      const [transaction] = await db.select().from(transactions).where(inArray(transactions.id, [transactionId]));
      await expect(ruleService.applyRules(transaction, a, { userId: userId("owner") })).rejects.toThrow("Invalid rule owner reference");
      expect(await ownerOf(transactionId)).toBe(userId("owner"));

      // The apply-to-past batch path fails closed per transaction: unruled, owner untouched.
      const { transactions: results } = await ruleService.applyRulesToTransactions([transaction], a, { userId: userId("owner") });
      expect(results[0].ownerUserId).toBe(userId("owner"));
      expect(await ownerOf(transactionId)).toBe(userId("owner"));
    });
  });
});
