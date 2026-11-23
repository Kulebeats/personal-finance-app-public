/**
 * NEW-32 (R07.3 / R08.2): every F4 writer that still wrote no audit row now
 * writes exactly one per write, inside the same database transaction, so a
 * failed audit insert rolls the write back. REAL HTTP, REAL DB, synthetic data.
 *
 * Already covered elsewhere and not repeated here: account create and both
 * account CSV exports (completion-r08.account-audit-contract), pension
 * contributions (pension.contribution.realdb), SIP plan grant/deactivate
 * (sipPlanAuthorization), market price/FX refresh, attachment upload/delete
 * audit rows (transactions.attachments.audit.realdb), recurring
 * materialization and T-bill maturity.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetPeriods, budgets, householdPreferences, pensionHoldings, priceAlerts, securities, systemRoles,
  transactionAttachments, userSystemRoles,
} from "@shared/schema";
import { db, pool } from "../db";
import { Money } from "../core/money";
import { budgetRolloverRepository } from "../repositories/budgets/BudgetRolloverRepository";
import { priceAlertService } from "../services/PriceAlertService";
import { notificationService } from "../services/NotificationService";
import { attachmentService } from "../services/AttachmentService";
import { budgetService } from "../services/budget/BudgetService";
import type { HouseholdRole } from "../core/authz/capabilities";
import { a, actors, app, ids, reset, start, stop } from "../modules/tags/__tests__/completion-r04.tags.fixture";

const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const trigger = `new32_block_${tag}`;
const as = (call: request.Test, role: "owner" | "member" = "owner") => call.set("Cookie", actors.get(role)!.cookie);

async function auditRows(entityType: string, entityId?: string) {
  const rows = await pool.query(
    "select * from audit_logs where entity_type=$1 and ($2::uuid is null or entity_id=$2::uuid) order by created_at, id",
    [entityType, entityId ?? null]);
  return rows.rows;
}

/** Makes the next audit insert of one kind fail, as a broken audit store would. */
async function blockAudit(table: "audit_logs" | "security_audit_logs", column: string, value: string) {
  await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN
      IF NEW.${column} = '${value}' THEN RAISE EXCEPTION 'Synthetic NEW-32 audit failure'; END IF; RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

async function unblockAudit() {
  for (const table of ["audit_logs", "security_audit_logs"]) await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
}

describe("NEW-32 audit completeness (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await reset(); });
  afterEach(async () => { await unblockAudit(); vi.restoreAllMocks(); });
  afterAll(async () => {
    await unblockAudit();
    await db.delete(pensionHoldings).where(eq(pensionHoldings.householdId, a));
    await db.delete(priceAlerts).where(eq(priceAlerts.householdId, a));
    await pool.query("delete from securities where symbol like $1", [`N32${tag}%`.slice(0, 20)]);
    await pool.query("delete from audit_logs where household_id=$1", [a]);
    await pool.query("delete from security_audit_logs where user_id=any($1::uuid[])", [[...actors.values()].map(({ id }) => id)]);
    await db.delete(userSystemRoles).where(inArray(userSystemRoles.userId, [...actors.values()].map(({ id }) => id)));
    await pool.query("delete from system_roles where name like $1", [`n32-${tag}%`]);
    await stop();
  });

  describe("POST /api/investments/pension (pension holding create)", () => {
    const body = () => ({ providerName: `NAPSA ${tag}`, pensionType: "social_security", accountId: ids.sharedAccount, currentBalance: "1000.00" });
    beforeEach(async () => { await db.delete(pensionHoldings).where(eq(pensionHoldings.householdId, a)); });

    it("writes one CREATE audit row for the holding, bound to the actor and household", async () => {
      const res = await as(request(app).post("/api/investments/pension")).send(body());

      expect(res.status).toBe(200);
      const rows = await auditRows("pension_holding", res.body.data.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: actors.get("owner")!.id });
      expect(rows[0].details.newValue).toMatchObject({ providerName: `NAPSA ${tag}`, currentBalance: "1000.00" });
    });

    it("rolls the holding back when its audit row cannot be written", async () => {
      await blockAudit("audit_logs", "entity_type", "pension_holding");

      const res = await as(request(app).post("/api/investments/pension")).send(body());

      expect(res.status).toBe(500);
      expect(await db.select().from(pensionHoldings).where(eq(pensionHoldings.householdId, a))).toEqual([]);
    });
  });

  describe("PUT /api/budgets/settings", () => {
    const flexBudgets = () => db.select().from(budgets).where(and(eq(budgets.householdId, a), eq(budgets.isFlexBucket, true)));
    beforeEach(async () => {
      await db.delete(budgets).where(eq(budgets.householdId, a));
      await pool.query("delete from audit_logs where household_id=$1 and entity_type in ('budget','household_preferences')", [a]);
      await db.delete(householdPreferences).where(eq(householdPreferences.householdId, a));
      await db.insert(householdPreferences).values({ householdId: a, budgetSystem: "category", defaultBudgetScope: "current_month" });
    });

    it("writes one UPDATE row for the preferences with before and after, and one CREATE row for the flex budget it creates", async () => {
      const res = await as(request(app).put("/api/budgets/settings"), "member").send({ budgetSystem: "flex", defaultApplyScope: "all_future" });

      expect(res.status).toBe(200);
      const prefs = await auditRows("household_preferences", a);
      expect(prefs).toHaveLength(1);
      expect(prefs[0]).toMatchObject({ action: "UPDATE", household_id: a, user_id: actors.get("member")!.id });
      expect(prefs[0].details.oldValue).toMatchObject({ budgetSystem: "category", defaultBudgetScope: "current_month" });
      expect(prefs[0].details.newValue).toMatchObject({ budgetSystem: "flex", defaultBudgetScope: "all_future" });
      const [flex] = await flexBudgets();
      const created = await auditRows("budget", flex.id);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: actors.get("member")!.id });
    });

    it("writes no flex budget row and no second audit row when the flex budget already exists", async () => {
      await as(request(app).put("/api/budgets/settings"), "member").send({ budgetSystem: "flex" }).expect(200);
      await as(request(app).put("/api/budgets/settings"), "member").send({ budgetSystem: "flex" }).expect(200);

      expect(await flexBudgets()).toHaveLength(1);
      const [flex] = await flexBudgets();
      expect(await auditRows("budget", flex.id)).toHaveLength(1);
      expect(await auditRows("household_preferences", a)).toHaveLength(2);
    });

    it("keeps the old settings and creates no flex budget when the audit row cannot be written", async () => {
      await blockAudit("audit_logs", "entity_type", "household_preferences");

      const res = await as(request(app).put("/api/budgets/settings"), "member").send({ budgetSystem: "flex" });

      expect(res.status).toBe(500);
      const [prefs] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, a));
      expect(prefs.budgetSystem).toBe("category");
      expect(await flexBudgets()).toEqual([]);
    });

    const owner = () => ({ householdId: a, userId: actors.get("owner")!.id, ipAddress: "127.0.0.1" });

    it("ensureFlexBudget writes one budget CREATE audit row for the flex budget it creates, and none when one exists", async () => {
      const created = await budgetService.ensureFlexBudget(owner());
      const again = await budgetService.ensureFlexBudget(owner());

      expect(again.id).toBe(created.id);
      expect(await flexBudgets()).toHaveLength(1);
      const rows = await auditRows("budget", created.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "CREATE", household_id: a, user_id: actors.get("owner")!.id });
    });

    it("leaves exactly one flex budget and one CREATE audit row when the settings switch and ensureFlexBudget race", async () => {
      const results = await Promise.allSettled([
        as(request(app).put("/api/budgets/settings"), "member").send({ budgetSystem: "flex" }).then((res) => res.status),
        budgetService.ensureFlexBudget(owner()),
        budgetService.ensureFlexBudget(owner()),
      ]);

      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
      expect((results[0] as PromiseFulfilledResult<number>).value).toBe(200);
      const flex = await flexBudgets();
      expect(flex).toHaveLength(1);
      expect(await auditRows("budget", flex[0].id)).toHaveLength(1);
      expect((await auditRows("budget")).filter((row) => row.household_id === a)).toHaveLength(1);
    });

    it("creates no flex budget when ensureFlexBudget cannot write its audit row", async () => {
      await blockAudit("audit_logs", "entity_type", "budget");

      await expect(budgetService.ensureFlexBudget(owner())).rejects.toThrow();

      expect(await flexBudgets()).toEqual([]);
    });
  });

  describe("budget rollover persistence (the /api/cron/budget-rollover and scheduled job writer)", () => {
    const periodStart = "2026-11-01", periodEnd = "2026-11-30";
    let budgetId: string;
    beforeEach(async () => {
      await db.delete(budgets).where(eq(budgets.householdId, a));
      budgetId = randomUUID();
      await db.insert(budgets).values({ id: budgetId, householdId: a, name: `Groceries ${tag}`, amount: "500.00", currency: "ZMW", period: "monthly", isActive: true });
    });
    const progress = (spent: string, rollover: string) => [{ id: budgetId, amount: "500.00", spent: new Money(spent, "ZMW"), rolloverIn: new Money(rollover, "ZMW") }];
    const periods = () => db.select().from(budgetPeriods).where(eq(budgetPeriods.budgetId, budgetId));

    it("audits each period it creates and each it updates, as a system write in the budget's household", async () => {
      expect(await budgetRolloverRepository.persistBudgetPeriodRollovers(progress("100.00", "25.00"), periodStart, periodEnd)).toEqual({ created: 1, updated: 0 });
      expect(await budgetRolloverRepository.persistBudgetPeriodRollovers(progress("140.00", "25.00"), periodStart, periodEnd)).toEqual({ created: 0, updated: 1 });

      const [period] = await periods();
      const rows = await auditRows("budget_period", period.id);
      expect(rows.map((row) => row.action)).toEqual(["CREATE", "UPDATE"]);
      expect(rows.every((row) => row.household_id === a && row.user_id === null)).toBe(true);
      expect(rows[0].details.newValue).toMatchObject({ budgetId, spentAmount: "100.00", rolloverIn: "25.00", currency: "ZMW" });
      expect(rows[1].details.oldValue).toMatchObject({ spentAmount: "100.00", rolloverIn: "25.00" });
      expect(rows[1].details.newValue).toMatchObject({ spentAmount: "140.00", rolloverIn: "25.00" });
    });

    it("creates no period when its audit row cannot be written", async () => {
      await blockAudit("audit_logs", "entity_type", "budget_period");

      await expect(budgetRolloverRepository.persistBudgetPeriodRollovers(progress("100.00", "25.00"), periodStart, periodEnd)).rejects.toThrow();
      expect(await periods()).toEqual([]);
    });
  });

  describe("price alerts checked by the price-alert service (held from the scheduler and the cron door)", () => {
    let alertId: string;
    beforeEach(async () => {
      vi.spyOn(notificationService, "notifyHousehold").mockResolvedValue(undefined as never);
      await db.delete(priceAlerts).where(eq(priceAlerts.householdId, a));
      const [security] = await db.insert(securities).values({
        symbol: `N32${tag}`.slice(0, 20), name: "Synthetic NEW-32 security", type: "stock", currency: "ZMW",
        currentPrice: "120.0000", lastPriceUpdate: new Date(),
      }).returning();
      const [alert] = await db.insert(priceAlerts).values({ householdId: a, securityId: security.id, alertType: "above", threshold: "100.0000" }).returning();
      alertId = alert.id;
    });

    it("records the trigger with one system UPDATE audit row in the alert's household", async () => {
      await priceAlertService.checkPriceAlerts();

      const [alert] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, alertId));
      expect(alert.lastTriggered).not.toBeNull();
      const rows = await auditRows("price_alert", alertId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "UPDATE", household_id: a, user_id: null });
      expect(rows[0].details.newValue).toMatchObject({ lastTriggered: alert.lastTriggered!.toISOString() });
    });

    it("leaves the alert untriggered when its audit row cannot be written", async () => {
      await blockAudit("audit_logs", "entity_type", "price_alert");

      await expect(priceAlertService.checkPriceAlerts()).rejects.toThrow();
      const [alert] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, alertId));
      expect(alert.lastTriggered).toBeNull();
    });
  });

  describe("admin system role grant and revoke", () => {
    let superAdminId: string;
    let roleIds: { first: string; second: string };
    const owner = () => actors.get("owner")!.id;
    const target = () => actors.get("member")!.id;
    const targetRoles = async () => (await db.select({ roleId: userSystemRoles.roleId }).from(userSystemRoles)
      .where(eq(userSystemRoles.userId, target()))).map((row) => row.roleId).sort();
    const securityRows = async (eventType: string) => (await pool.query(
      "select * from security_audit_logs where event_type=$1 and target_user_id=$2 order by created_at", [eventType, target()])).rows;

    beforeAll(async () => {
      await db.insert(systemRoles).values({ name: "super_admin" }).onConflictDoNothing();
      [{ id: superAdminId }] = await db.select({ id: systemRoles.id }).from(systemRoles).where(eq(systemRoles.name, "super_admin"));
      const created = await db.insert(systemRoles).values([{ name: `n32-${tag}-a` }, { name: `n32-${tag}-b` }]).returning();
      roleIds = { first: created[0].id, second: created[1].id };
    });
    beforeEach(async () => {
      await db.delete(userSystemRoles).where(inArray(userSystemRoles.userId, [owner(), target()]));
      await db.insert(userSystemRoles).values({ userId: owner(), roleId: superAdminId });
      await pool.query("delete from security_audit_logs where target_user_id=$1", [target()]);
    });

    it("writes one ROLE_ASSIGNED row naming the actor, target and role", async () => {
      await as(request(app).post(`/api/admin/users/${target()}/roles`)).send({ roleId: roleIds.first }).expect(200);

      expect(await targetRoles()).toEqual([roleIds.first]);
      const rows = await securityRows("ROLE_ASSIGNED");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: owner(), target_user_id: target() });
      expect(rows[0].details).toMatchObject({ roleId: roleIds.first, roleName: `n32-${tag}-a` });
    });

    it("does not grant the role when its audit row cannot be written", async () => {
      await blockAudit("security_audit_logs", "event_type", "ROLE_ASSIGNED");

      const res = await as(request(app).post(`/api/admin/users/${target()}/roles`)).send({ roleId: roleIds.first });

      expect(res.status).toBe(500);
      expect(await targetRoles()).toEqual([]);
    });

    it("revokes only the named role and writes one ROLE_REMOVED row", async () => {
      await db.insert(userSystemRoles).values([{ userId: target(), roleId: roleIds.first }, { userId: target(), roleId: roleIds.second }]);

      await as(request(app).delete(`/api/admin/users/${target()}/roles/${roleIds.first}`)).expect(200);

      expect(await targetRoles()).toEqual([roleIds.second]);
      const rows = await securityRows("ROLE_REMOVED");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: owner(), target_user_id: target() });
      expect(rows[0].details).toMatchObject({ roleId: roleIds.first, roleName: `n32-${tag}-a` });
    });

    it("keeps the role when the revoke's audit row cannot be written", async () => {
      await db.insert(userSystemRoles).values({ userId: target(), roleId: roleIds.first });
      await blockAudit("security_audit_logs", "event_type", "ROLE_REMOVED");

      const res = await as(request(app).delete(`/api/admin/users/${target()}/roles/${roleIds.first}`));

      expect(res.status).toBe(500);
      expect(await targetRoles()).toEqual([roleIds.first]);
    });
  });

  describe("attachment visibility uses the caller's role", () => {
    it("refuses a delete from an actor whose role grants no financial read, instead of assuming member", async () => {
      const [attachment] = await db.insert(transactionAttachments).values({
        transactionId: ids.sharedTx, filename: `${tag}.pdf`, originalFilename: "synthetic.pdf", mimeType: "application/pdf",
        size: 10, storagePath: `/nonexistent/${tag}.pdf`, uploadedBy: actors.get("owner")!.id,
      }).returning();
      const revokedRole = "revoked" as unknown as HouseholdRole;

      await expect(attachmentService.deleteAttachment(attachment.id, a, actors.get("member")!.id, revokedRole))
        .rejects.toThrow("not found");
      expect(await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, attachment.id))).toHaveLength(1);
      expect(await auditRows("transaction_attachment", attachment.id)).toEqual([]);
    });
  });
});
