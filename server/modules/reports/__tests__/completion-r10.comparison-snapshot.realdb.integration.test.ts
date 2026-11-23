import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, auditLogs, budgets, budgetPeriods, categories, dataExports, householdMembers, households, transactions } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const categoryId = randomUUID(), budgetId = randomUUID();
async function clean() {
  await db.delete(dataExports).where(eq(dataExports.householdId, a));
  await db.delete(budgets).where(eq(budgets.householdId, a));
  await db.delete(categories).where(eq(categories.householdId, a));
}
describe("budget comparison JSON and CSV bind source, audience and limits to one snapshot", () => {
  beforeAll(async () => { await start(); }, 20_000);
  beforeEach(async () => {
    await db.insert(households).values({ id: a, name: "Snapshot household", currency: "ZMW" }).onConflictDoNothing();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await resetAccountsAndMembership(); await clean();
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Coherent category", displayOrder: 0 });
    await db.insert(budgets).values({ id: budgetId, householdId: a, categoryId, name: "Coherent limit", amount: "100", currency: "ZMW" });
    await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId, ownerUserId: actors.get("member")!.id,
      name: "Initially visible source", amount: "20", currency: "ZMW", type: "expense", date: "2026-10-15" });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  for (const transport of ["JSON", "CSV"] as const) for (const withdrawal of ["account", "membership"] as const) {
    it.each(["ZMW", "USD"] as const)(`${transport} does not combine old actuals with a new %s override after ${withdrawal} withdrawal`, async currency => {
      const actor = actors.get("admin")!;
      let path = "/api/reports/cashflow/budget?from=2026-10-01&to=2026-10-31&interval=month&scope=household";
      let exportId = "";
      if (transport === "CSV") {
        const [item] = await db.insert(dataExports).values({ householdId: a, userId: actor.id, exportType: "budget", fileFormat: "csv", status: "completed",
          dateRangeStart: "2026-10-01", dateRangeEnd: "2026-10-31", recordCount: 1,
          parameters: { reportType: "budget", format: "csv", startDate: "2026-10-01", endDate: "2026-10-31", interval: "month", scope: "household",
            includeCharts: false, includeForecast: false, forecastMonths: 3 } }).returning({ id: dataExports.id });
        exportId = item.id;
        path = `/api/reports/exports/${item.id}?download=true`;
      }
      const get = () => request(app).get(path).set("Cookie", actor.cookie);
      const actual = Client.prototype.query; let changed = false;
      vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
        const command = args[0], text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
        if (!changed && /^\s*select\b/i.test(text) && /from\s+"budgets"/i.test(text)) {
          changed = true;
          return (async () => {
            if (withdrawal === "account") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount));
            else await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
            await db.insert(budgetPeriods).values({ budgetId, startDate: "2026-10-01", endDate: "2026-10-31", budgetAmount: "1000", currency });
            return Reflect.apply(actual, this, args);
          })();
        }
        return Reflect.apply(actual, this, args);
      } as typeof Client.prototype.query);
      if (transport === "CSV" && withdrawal === "membership") {
        // C3-13: publication re-checks the current grant after generation, so a
        // grant withdrawn mid-read releases no file and writes no PROCESS audit.
        const refused = await get().expect(403); expect(changed).toBe(true);
        expect(refused.headers["content-disposition"]).toBeUndefined();
        expect(refused.text).not.toContain("Coherent category");
        const processed = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, exportId), eq(auditLogs.action, "PROCESS"),
          eq(auditLogs.entityType, "data_export")));
        expect(processed).toEqual([]);
        await get().expect(404);
        return;
      }
      const prior = await get().expect(200); expect(changed).toBe(true);
      if (transport === "JSON") {
        expect(prior.body.data.comparison).toMatchObject([{ actual: { amount: "20.00", currency: "ZMW" }, budgeted: { amount: "100.00", currency: "ZMW" } }]);
      } else {
        const [headers, row] = prior.text.trim().split(/\r?\n/).map(line => line.split(",").map(cell => cell.replace(/^"|"$/g, "")));
        expect(new Money(row[headers.indexOf("actual")], "ZMW").toString()).toBe("20.00");
        expect(new Money(row[headers.indexOf("budgeted")], "ZMW").toString()).toBe("100.00");
      }
      if (withdrawal === "membership") await get().expect(404);
      else {
        const current = await get().expect(200);
        if (transport === "JSON") expect(current.body.data.comparison).toEqual([]);
        else expect(current.text.trim().split(/\r?\n/)).toHaveLength(1);
      }
    });
  }
  for (const transport of ["JSON", "CSV"] as const) {
    it.each(["valid", "missing", "null", "malformed"] as const)(`${transport} denies a withdrawn actor uniformly before inspecting %s household currency`, async state => {
      const actor = actors.get("admin")!;
      let path = "/api/reports/cashflow/budget?from=2026-10-01&to=2026-10-31&interval=month&scope=household";
      if (transport === "CSV") {
        const [item] = await db.insert(dataExports).values({ householdId: a, userId: actor.id, exportType: "budget", fileFormat: "csv", status: "completed",
          dateRangeStart: "2026-10-01", dateRangeEnd: "2026-10-31", recordCount: 1,
          parameters: { reportType: "budget", format: "csv", startDate: "2026-10-01", endDate: "2026-10-31", interval: "month", scope: "household",
            includeCharts: false, includeForecast: false, forecastMonths: 3 } }).returning({ id: dataExports.id });
        path = `/api/reports/exports/${item.id}?download=true`;
      }
      const actual = Client.prototype.query; let withdrawn = false, currencyReads = 0;
      vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
        const command = args[0], text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
        if (withdrawn && /^\s*(select|with)\b/i.test(text) && /from\s+"households"/i.test(text) && /\bcurrency\b/i.test(text)) currencyReads++;
        if (!withdrawn && /^\s*begin\b/i.test(text) && /repeatable read/i.test(text) && /read only/i.test(text)) {
          withdrawn = true;
          return (async () => {
            await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
            if (state === "missing") await db.delete(households).where(eq(households.id, a));
            else if (state !== "valid") await db.update(households).set({ currency: state === "null" ? null : "usd" }).where(eq(households.id, a));
            return Reflect.apply(actual, this, args);
          })();
        }
        return Reflect.apply(actual, this, args);
      } as typeof Client.prototype.query);
      const response = await request(app).get(path).set("Cookie", actor.cookie).expect(403);
      expect(withdrawn).toBe(true); expect(currencyReads).toBe(0);
      expect(response.body.error).toMatchObject({ code: "FORBIDDEN", message: "Budget comparison access denied" });
    });
  }
});
