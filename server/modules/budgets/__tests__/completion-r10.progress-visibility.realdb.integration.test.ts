import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, lte } from "drizzle-orm";
import { accounts, auditLogs, budgetPeriods, budgets, categories, categoryGroups, fxRates, householdFxRateOverrides, householdMembers, householdPreferences, households, notifications, transactions, transactionSplits, userNotificationPreferences, userPushSubscriptions, users } from "@shared/schema";
import { db } from "../../../db";
import { budgetService } from "../../../services/BudgetService";
import { budgetRepository } from "../../../repositories/BudgetRepository";
import { budgetQueryRepository } from "../../../repositories/BudgetQueryRepository";
import { notificationService } from "../../../services/NotificationService";
import * as emailDelivery from "../../../services/emailService";
import { pushNotificationService } from "../../../services/notification/push";
import { calendarClock } from "../../../services/householdCalendarToday";
// @ts-expect-error - web-push has no type declarations in this project.
import webpush from "web-push";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";
import { postCronDoor } from "../../../__tests__/cron-door-fixture";

const group = randomUUID(), categoryA = randomUUID(), categoryB = randomUUID();
const categoryBudget = randomUUID(), groupBudget = randomUUID(), flexBudget = randomUUID();
const rateIds: string[] = [];
const date = "2026-02-15", from = "2026-02-01", to = "2026-02-28";
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({}) } }));
type Source = { amount: string; accountId?: string; owner?: string; private?: boolean; currency?: string; pending?: boolean;
  status?: "pending" | "cleared" | "reconciled" | null; excluded?: boolean; deleted?: boolean; split?: [string, string]; date?: string };
type ProgressRow = { id: string; spent: { amount: string; currency: string }; remaining: { amount: string; currency: string } };
async function source(input: Source) {
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: a, accountId: input.accountId ?? ids.sharedAccount,
    ownerUserId: input.owner ?? actors.get("member")!.id, categoryId: categoryA, date: input.date ?? date,
    name: "Synthetic actor-bound budget progress", amount: input.amount, currency: input.currency ?? "ZMW", type: "expense",
    isPrivate: input.private ?? false, isPending: input.pending ?? false, ...(input.status === undefined ? {} : { status: input.status }),
    isExcludedFromBudget: input.excluded ?? false, deletedAt: input.deleted ? new Date(`${date}T12:00:00Z`) : null });
  if (input.split) await db.insert(transactionSplits).values([
    { transactionId: id, categoryId: categoryA, amount: input.split[0], displayOrder: 0 },
    { transactionId: id, categoryId: categoryB, amount: input.split[1], displayOrder: 1 },
  ]);
  return id;
}
async function privateAccount(role: Role, currency = "ZMW") {
  const id = randomUUID();
  await db.insert(accounts).values({ id, householdId: a, name: "Synthetic private progress account", type: "checking",
    currency, isPrivate: true, ownerUserId: actors.get(role)!.id });
  return id;
}
async function clean() {
  await db.delete(notifications).where(eq(notifications.householdId, a));
  if (actors.size) await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, Array.from(actors.values()).map(row => row.id)));
  if (actors.size) await db.delete(userPushSubscriptions).where(inArray(userPushSubscriptions.userId, Array.from(actors.values()).map(row => row.id)));
  await db.delete(budgets).where(inArray(budgets.householdId, [a, b]));
  await db.delete(categories).where(inArray(categories.householdId, [a, b]));
  await db.delete(categoryGroups).where(inArray(categoryGroups.householdId, [a, b]));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
  if (rateIds.length) await db.delete(fxRates).where(inArray(fxRates.id, rateIds.splice(0)));
}
function get(role: Role = "member", month = 2, year = 2026) {
  return request(app).get(`/api/budgets/progress?year=${year}&month=${month}`).set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
}
async function progress(role: Role = "member") {
  await db.update(categoryGroups).set({ budgetMode: "by_category" }).where(eq(categoryGroups.id, group));
  const categoryRows = (await get(role).expect(200)).body.data as ProgressRow[];
  await db.update(categoryGroups).set({ budgetMode: "by_group" }).where(eq(categoryGroups.id, group));
  const groupRows = (await get(role).expect(200)).body.data as ProgressRow[];
  expect(categoryRows.map(row => row.id).sort()).toEqual([categoryBudget, flexBudget].sort());
  expect(groupRows.map(row => row.id).sort()).toEqual([groupBudget, flexBudget].sort());
  const result = [categoryRows.find(row => row.id === categoryBudget)!, groupRows.find(row => row.id === groupBudget)!, groupRows.find(row => row.id === flexBudget)!];
  expect(categoryRows.find(row => row.id === flexBudget)!.spent).toEqual(result[2].spent);
  return result.map(({ id, spent, remaining }) => ({ id, spent, remaining }));
}
function expected(category: string, categoryRemaining: string, total: string, totalRemaining: string) {
  return [{ id: categoryBudget, spent: { amount: category, currency: "ZMW" }, remaining: { amount: categoryRemaining, currency: "ZMW" } },
    ...[groupBudget, flexBudget].map(id => ({ id, spent: { amount: total, currency: "ZMW" }, remaining: { amount: totalRemaining, currency: "ZMW" } }))];
}
async function financialState() {
  return {
    budgets: await db.select().from(budgets).where(eq(budgets.householdId, a)).orderBy(budgets.id),
    periods: await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, [categoryBudget, groupBudget, flexBudget])).orderBy(budgetPeriods.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
  };
}
// FIN-06: budgets read the same rates as Reports: the shared fx_rates row the
// market refresh writes, or the household's own manual rate.
async function quote(rateDate = date, rate = "2") {
  const id = randomUUID(); rateIds.push(id);
  await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate, date: rateDate, source: "yahoo_finance" });
  return id;
}
async function householdRate(householdId: string, rate: string, effectiveDate: string) {
  await db.insert(householdFxRateOverrides).values({ householdId, actorUserId: actors.get(householdId === a ? "owner" : "outsider")!.id,
    fromCurrency: "USD", toCurrency: "ZMW", effectiveDate, validThrough: effectiveDate, rate });
}
async function noOtherRates(onOrBefore: string) {
  const rows = await db.select({ id: fxRates.id }).from(fxRates)
    .where(and(eq(fxRates.fromCurrency, "USD"), eq(fxRates.toCurrency, "ZMW"), lte(fxRates.date, onOrBefore)));
  expect(rows.filter(row => !rateIds.includes(row.id))).toEqual([]);
}
async function alignCurrentCronMonth() {
  const today = new Date();
  await db.update(transactions).set({ date: today.toISOString().slice(0, 10) }).where(eq(transactions.householdId, a));
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
}
async function channelPreferences(inApp: boolean, email: boolean) {
  await db.insert(userNotificationPreferences).values(Array.from(actors.values()).flatMap(({ id }) => ["budget_warning", "budget_exceeded"].map(notificationType =>
    ({ userId: id, notificationType, inAppEnabled: id === actors.get("member")!.id && inApp,
      emailEnabled: id === actors.get("member")!.id && email, pushEnabled: false }))));
}

describe("R10 signed budget progress uses the reader's visible posted activity and verified denomination", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await reset(); await clean();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(householdPreferences).values({ householdId: a, autoRolloverBudget: false, rolloverPercentage: 100 })
      .onConflictDoUpdate({ target: householdPreferences.householdId, set: { autoRolloverBudget: false, rolloverPercentage: 100 } });
    await db.insert(categoryGroups).values({ id: group, householdId: a, name: "Progress expense group", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values([{ id: categoryA, name: "Progress A" }, { id: categoryB, name: "Progress B" }]
      .map((row, displayOrder) => ({ ...row, householdId: a, groupId: group, includeInBudget: true, displayOrder })));
    await db.insert(budgets).values([
      { id: categoryBudget, householdId: a, name: "Progress category", categoryId: categoryA, amount: "20000", currency: "ZMW" },
      { id: groupBudget, householdId: a, name: "Progress group", categoryGroupId: group, amount: "20000", currency: "ZMW" },
      { id: flexBudget, householdId: a, name: "Progress flex", isFlexBucket: true, amount: "20000", currency: "ZMW" },
    ].map(row => ({ ...row, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") })));
    await source({ amount: "100" }); await source({ amount: "60", split: ["40", "20"] });
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("includes the actor's private accounts and transactions while excluding other members' private ordinary and split parents", async () => {
    const member = actors.get("member")!.id, owner = actors.get("owner")!.id;
    const mine = await privateAccount("member");
    await source({ accountId: mine, owner: member, amount: "50" }); await source({ accountId: mine, owner: member, amount: "30", split: ["20", "10"] });
    await source({ owner: member, private: true, amount: "40" }); await source({ owner: member, private: true, amount: "20", split: ["15", "5"] });
    await source({ accountId: ids.privateAccount, owner, amount: "7000" }); await source({ owner, private: true, amount: "6000", split: ["4000", "2000"] });
    expect(await progress("member")).toEqual(expected("265.00", "19735.00", "300.00", "19700.00"));
    expect(await progress("owner")).toEqual(expected("11140.00", "8860.00", "13160.00", "6840.00"));
    expect(await progress("admin")).toEqual(expected("140.00", "19860.00", "160.00", "19840.00"));
  });

  it.each(["view_only", "professional"] as const)("supports an actual %s member's authorized read without exposing other owners' private totals", async role => {
    const mine = await privateAccount(role), owner = actors.get(role)!.id;
    await source({ accountId: mine, owner, amount: "17" }); await source({ owner, private: true, amount: "19", split: ["11", "8"] });
    await source({ accountId: ids.privateAccount, amount: "9000" });
    expect(await progress(role)).toEqual(expected("168.00", "19832.00", "196.00", "19804.00"));
  });

  it("rechecks a signed member's downgraded view_only audience and denies removed membership", async () => {
    await source({ accountId: ids.privateAccount, amount: "9000" });
    await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    expect(await progress()).toEqual(expected("140.00", "19860.00", "160.00", "19840.00"));
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    const denied = await get(); expect([403, 404, 409]).toContain(denied.status); expect(denied.body.data).toBeUndefined();
  });

  it("converts visible ordinary and split foreign spend at the dated shared rate Reports uses", async () => {
    await noOtherRates(date); await quote("2026-02-10");
    await source({ amount: "15", currency: "USD" }); await source({ amount: "10", currency: "USD", split: ["6", "4"] });
    expect(await progress()).toEqual(expected("182.00", "19818.00", "210.00", "19790.00"));
  });

  it("uses the same visible audience for previous-month rollover without persisting the calculation", async () => {
    const mine = await privateAccount("member");
    await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
    await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.householdId, a));
    await source({ amount: "100", date: "2026-01-15" });
    await source({ accountId: mine, amount: "50", date: "2026-01-15" });
    await source({ accountId: ids.privateAccount, amount: "9000", date: "2026-01-15" });
    const before = await financialState();
    expect(await progress()).toEqual(expected("140.00", "39710.00", "160.00", "39690.00"));
    expect(await financialState()).toEqual(before);
  });

  it("does not expose inaccessible private foreign activity through totals or missing-rate failures", async () => {
    const hidden = await privateAccount("owner", "QPX");
    await source({ accountId: hidden, owner: actors.get("owner")!.id, amount: "7777", currency: "QPX" });
    await source({ owner: actors.get("owner")!.id, private: true, amount: "6666", currency: "QPX", split: ["4444", "2222"] });
    expect(await progress()).toEqual(expected("140.00", "19860.00", "160.00", "19840.00"));
    const own = await get("owner").expect(422); expect(own.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
    expect(JSON.stringify(own.body)).not.toMatch(/7777|6666|QPX/);
  });

  it.each(["no rate", "only a later shared rate", "only another household's manual rate"])("fails closed for visible foreign spend with %s without modifying financial state", async kind => {
    await noOtherRates(date);
    await source({ amount: "15", currency: "USD" });
    if (kind === "only a later shared rate") await quote("2026-02-16");
    if (kind === "only another household's manual rate") await householdRate(b, "999", date);
    const before = await financialState(), failed = await get().expect(422);
    expect(failed.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE"); expect(await financialState()).toEqual(before);
  });

  it("preserves posting, exclusion and split-parent de-duplication controls in the actor-bound path", async () => {
    await source({ amount: "900", pending: true }); await source({ amount: "800", status: "pending", split: ["500", "300"] });
    await source({ amount: "700", excluded: true, split: ["400", "300"] }); await source({ amount: "600", deleted: true });
    await source({ amount: "10", status: null });
    expect(await progress()).toEqual(expected("150.00", "19850.00", "170.00", "19830.00"));
  });

  it("quarantines genuine legacy null currency even when current account settings say ZMW", async () => {
    const id = await source({ amount: "15" });
    await db.update(transactions).set({ currency: null }).where(eq(transactions.id, id));
    const failed = await get().expect(422); expect(failed.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });

  it("persists only shareable rollover facts and keeps other owners' private prior activity out of later signed months", async () => {
    await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
    await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.householdId, a));
    await source({ amount: "100", date: "2026-01-15" });
    await source({ accountId: ids.privateAccount, owner: actors.get("owner")!.id, amount: "9000", date: "2026-01-15" });
    await source({ accountId: ids.privateAccount, owner: actors.get("owner")!.id, amount: "2000" });
    await budgetService.processBudgetRollover(a, new Date("2026-02-15T12:00:00Z"));
    const saved = await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, [categoryBudget, flexBudget]));
    expect(saved).toHaveLength(2);
    for (const row of saved) expect(row.rolloverIn).toBe("19900.00");
    expect(saved.find(row => row.budgetId === categoryBudget)?.spentAmount).toBe("140.00");
    expect(saved.find(row => row.budgetId === flexBudget)?.spentAmount).toBe("160.00");
    await source({ amount: "30", date: "2026-03-15" });
    const later = await get("view_only", 3).expect(200);
    expect(later.body.data.find((row: ProgressRow) => row.id === categoryBudget).remaining).toEqual({ amount: "59730.00", currency: "ZMW" });
    expect(later.body.data.find((row: ProgressRow) => row.id === flexBudget).remaining).toEqual({ amount: "59710.00", currency: "ZMW" });
  });

  // FIN-12 / NEW-16: the rollover month is the household calendar month, not
  // the server UTC month. Lusaka is UTC+2, so 22:00Z on 28 Feb is already 1 March.
  it.each([
    ["2026-02-28T21:59:59Z", "2026-02-01"],
    ["2026-02-28T22:00:00Z", "2026-03-01"],
  ])("rolls over into the household calendar month at %s", async (instant, startDate) => {
    await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, a));
    try {
      await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
      await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.householdId, a));
      vi.spyOn(calendarClock, "now").mockReturnValue(new Date(instant));
      await budgetService.processBudgetRollover(a);
      const saved = await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, [categoryBudget, flexBudget]));
      expect(saved.map(row => row.startDate)).toEqual([startDate, startDate]);
    } finally {
      await db.update(households).set({ timeZone: null }).where(eq(households.id, a));
    }
  });

  it("preserves a manual amount, USD denomination and version written after a rollover read", async () => {
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    await db.update(budgets).set({ currency: "USD", rolloverEnabled: true }).where(eq(budgets.householdId, a));
    await db.update(transactions).set({ currency: "USD" }).where(eq(transactions.householdId, a));
    const calculated = await budgetQueryRepository.getBudgetsWithProgress(a, 2026, 2, { currency: "USD", autoRolloverBudget: true,
      context: { kind: "system", purpose: "rollover-old-caller-regression" } });
    const manual = randomUUID();
    await db.insert(budgetPeriods).values({ id: manual, budgetId: categoryBudget, startDate: from, endDate: to,
      budgetAmount: "777.77", currency: "USD", version: 9 });
    await budgetRepository.persistBudgetPeriodRollovers(calculated.filter(row => row.id === categoryBudget), from, to);
    const [saved] = await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, manual));
    expect(saved).toMatchObject({ budgetAmount: "777.77", currency: "USD", version: 9 });
    expect(saved.rolloverIn).toBe("20000.00");
  });

  it("reads limits, currencies, spend and membership from one coherent financial projection", async () => {
    const original = Client.prototype.query; let changed = false;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!changed && /^\s*(select|with)\b/i.test(statement) && /from\s+"transactions"/i.test(statement)) {
        changed = true;
        return db.update(budgets).set({ amount: "30000" }).where(eq(budgets.id, categoryBudget))
          .then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    const result = await get().expect(200); expect(changed).toBe(true);
    expect(result.body.data.find((row: ProgressRow) => row.id === categoryBudget)).toMatchObject({
      amount: { amount: "30000.00", currency: "ZMW" }, remaining: { amount: "29860.00", currency: "ZMW" },
    });
  });

  it("delivers cron alerts only to the actor whose visible percentage was calculated without sending externally", async () => {
    await db.update(budgets).set({ amount: "200" }).where(eq(budgets.householdId, a));
    await source({ accountId: ids.privateAccount, owner: actors.get("owner")!.id, amount: "130" });
    await alignCurrentCronMonth(); vi.stubEnv("CRON_SECRET", "synthetic-progress-cron");
    const delivered = vi.spyOn(notificationService, "notify").mockResolvedValue(null);
    const evaluated = vi.spyOn(budgetService, "getBudgetAlerts");
    expect((await postCronDoor(app, "budget-alerts", "synthetic-progress-cron")).status).toBe(200);
    const values = delivered.mock.calls.filter(([, household]) => household === a);
    const percentageFor = async (role: Role) => {
      const index = evaluated.mock.calls.findIndex(([, , , context]) => context.kind === "actor" && context.actor.userId === actors.get(role)!.id);
      expect(index).toBeGreaterThanOrEqual(0);
      const alerts: Awaited<ReturnType<typeof budgetService.getBudgetAlerts>> = await evaluated.mock.results[index].value;
      return alerts.find(row => row.budget.id === flexBudget)?.percentUsed;
    };
    expect(await percentageFor("member")).toBe(80); expect(await percentageFor("owner")).toBe(145);
    expect(JSON.stringify(values.map(([, , , data]) => ({ title: data.title, body: data.body, metadata: data.metadata })))).not.toMatch(/percentUsed|alertLevel|Progress flex|Progress category|145%/);
    expect(values.some(([user]) => user === actors.get("view_only")!.id || user === actors.get("professional")!.id)).toBe(false);
  });

  it("does not trust historical prepopulated carry that embedded a different owner's private spending", async () => {
    await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
    await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.householdId, a));
    await source({ amount: "100", date: "2026-01-15" });
    await source({ accountId: ids.privateAccount, amount: "9000", date: "2026-01-15" });
    await db.insert(budgetPeriods).values([categoryBudget, flexBudget].map(budgetId => ({ budgetId, startDate: from, endDate: to,
      budgetAmount: "20000", currency: "ZMW", rolloverIn: "10900", spentAmount: "2160" })));
    await source({ amount: "30", date: "2026-03-15" });
    const result = await get("view_only", 3).expect(200);
    expect(result.body.data.find((row: ProgressRow) => row.id === flexBudget).remaining).toEqual({ amount: "59710.00", currency: "ZMW" });
  });

  it("recomputes the permitted source chain after a previously shareable account becomes private", async () => {
    await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
    await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.householdId, a));
    const changed = await privateAccount("owner"); await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, changed));
    await source({ amount: "100", date: "2026-01-15" }); await source({ accountId: changed, amount: "500", date: "2026-01-15" });
    await budgetService.processBudgetRollover(a, new Date("2026-02-15T12:00:00Z"));
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, changed));
    await source({ amount: "30", date: "2026-03-15" });
    const result = await get("view_only", 3).expect(200);
    expect(result.body.data.find((row: ProgressRow) => row.id === flexBudget).remaining).toEqual({ amount: "59710.00", currency: "ZMW" });
  });

  it("returns explicit unavailable when an old default changed and its historical monthly limit cannot be proved", async () => {
    await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
    await db.update(budgets).set({ rolloverEnabled: true, updatedAt: new Date("2026-02-10T00:00:00Z") }).where(eq(budgets.householdId, a));
    const result = await get().expect(422); expect(result.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });

  it("keeps opted-out rollover a no-op even when visible FX valuation is unavailable", async () => {
    await source({ amount: "15", currency: "USD" });
    const before = await financialState();
    expect(await budgetService.processBudgetRollover(a, new Date("2026-02-15T12:00:00Z"))).toEqual({ created: 0, updated: 0, total: 0 });
    expect(await financialState()).toEqual(before);
  });

  it.each([false, true])("publishes only a safe current in-app review after contribution withdrawal (crossingRemoved=%s)", async crossingRemoved => {
    await db.update(budgets).set({ amount: crossingRemoved ? "500" : "200" }).where(eq(budgets.householdId, a));
    const changed = await privateAccount("owner"); await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, changed));
    await source({ accountId: changed, amount: crossingRemoved ? "500" : "130" });
    await db.insert(userNotificationPreferences).values(Array.from(actors.values()).flatMap(({ id }) => ["budget_warning", "budget_exceeded"].map(notificationType =>
      ({ userId: id, notificationType, inAppEnabled: true, emailEnabled: false, pushEnabled: false }))));
    const actualNotify = notificationService.notify.bind(notificationService); let withdrawn = false;
    vi.spyOn(notificationService, "notify").mockImplementation(async (...args) => {
      if (!withdrawn && args[0] === actors.get("member")!.id) { withdrawn = true; await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, changed)); }
      return actualNotify(...args);
    });
    const currentMonth = await alignCurrentCronMonth(); vi.stubEnv("CRON_SECRET", "synthetic-progress-cron");
    expect((await postCronDoor(app, "budget-alerts", "synthetic-progress-cron")).status).toBe(200);
    expect(withdrawn).toBe(true);
    const saved = await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, actors.get("member")!.id)));
    if (crossingRemoved) expect(saved).toHaveLength(0); else expect(saved.length).toBeGreaterThan(0);
    expect(saved.every(row => row.actionUrl === "/budget")).toBe(true);
    expect(JSON.stringify(saved.map(({ title, body, metadata }) => ({ title, body, metadata })))).not.toMatch(/145%|290\.00|130\.00|Progress flex|Progress category|percentUsed|alertLevel/);
    const current = await get("member", currentMonth.month, currentMonth.year).expect(200);
    expect(current.body.data.find((row: ProgressRow) => row.id === flexBudget).percentUsed).toBe(crossingRemoved ? 32 : 80);
  });

  it.each(["default", "current period", "historical period"])("rejects a non-finite %s limit instead of suppressing a crossing", async sourceKind => {
    if (sourceKind === "default") await db.update(budgets).set({ amount: "NaN" }).where(eq(budgets.id, categoryBudget));
    else {
      if (sourceKind === "historical period") {
        await db.update(householdPreferences).set({ autoRolloverBudget: true }).where(eq(householdPreferences.householdId, a));
        await db.update(budgets).set({ rolloverEnabled: true }).where(eq(budgets.id, categoryBudget));
      }
      await db.insert(budgetPeriods).values({ budgetId: categoryBudget, startDate: sourceKind === "current period" ? from : "2026-01-01",
        endDate: sourceKind === "current period" ? to : "2026-01-31", budgetAmount: "NaN", currency: "ZMW" });
    }
    const failed = await get().expect(422); expect(failed.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
  });

  it("claims email-only review delivery once per recipient and counts no denied or duplicate notifications", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const mine = await privateAccount("member"); await source({ accountId: mine, amount: "500" });
    await alignCurrentCronMonth(); await channelPreferences(false, true);
    vi.stubEnv("CRON_SECRET", "synthetic-progress-cron");
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(true);
    const run = async () => {
      const response = await postCronDoor(app, "budget-alerts", "synthetic-progress-cron");
      expect(response.status).toBe(200);
      return response.body.jobs[0].summary;
    };
    expect((await run()).notificationsSent).toBe(1); expect((await run()).notificationsSent).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(transport.mock.calls)).not.toMatch(/percentUsed|alertLevel|Progress flex|132%|128%/);
    const claims = await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, actors.get("member")!.id)));
    expect(claims).toHaveLength(1); expect(claims[0].isArchived).toBe(true);
  });

  it.each(["source withdrawal", "role downgrade", "channel withdrawal"])("rechecks %s after claim storage and before the mocked email adapter", async change => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const changed = await privateAccount("owner"); await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, changed));
    await source({ accountId: changed, amount: "500" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, true);
    const userId = actors.get("member")!.id;
    const unreadBefore = await notificationService.getUnreadCount(userId);
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(true);
    let withdrawn = false;
    const quietHours = notificationService as unknown as { isInQuietHours(id: string): Promise<boolean> };
    vi.spyOn(quietHours, "isInQuietHours").mockImplementation(async id => {
      if (id === userId && !withdrawn) {
        withdrawn = true;
        if (change === "source withdrawal") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, changed));
        else if (change === "role downgrade") await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, userId)));
        else await db.update(userNotificationPreferences).set({ emailEnabled: false }).where(eq(userNotificationPreferences.userId, userId));
      }
      return false;
    });
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, userId)).toBe(false);
    expect(withdrawn).toBe(true); expect(transport).not.toHaveBeenCalled();
    const claims = await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, userId)));
    expect(claims).toHaveLength(1); expect(claims[0].isArchived).toBe(true);
    expect(await notificationService.getUnreadCount(userId)).toBe(unreadBefore);
    await get("member", current.month, current.year).expect(200);
  });

  it("keeps an in-flight mocked email source-free and its destination protected after withdrawal", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const changed = await privateAccount("owner"); await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, changed));
    await source({ accountId: changed, amount: "500" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, true);
    let entered!: () => void, release!: () => void;
    const atAdapter = new Promise<void>(done => { entered = done; });
    const complete = new Promise<void>(done => { release = done; });
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockImplementation(async () => { entered(); await complete; return true; });
    const publishing = notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, actors.get("member")!.id);
    try {
      await Promise.race([atAdapter, new Promise<never>((_done, reject) => setTimeout(() => reject(new Error("mock adapter was not entered")), 4000))]);
      await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, changed));
      const protectedRead = await get("member", current.month, current.year).expect(200);
      expect(protectedRead.body.data.find((row: ProgressRow) => row.id === flexBudget).percentUsed).toBe(32);
    } finally { release(); }
    expect(await publishing).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
    const [message] = transport.mock.calls[0];
    expect(message.subject).toBe("Review your budget"); expect(message.text).toContain("/budget");
    expect(JSON.stringify(message)).not.toMatch(/retired financial title|132%|128%|percentUsed|alertLevel|Progress flex|Progress category/);
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, actors.get("member")!.id)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("does not label an unconfirmed mocked email as sent or silently resend its claim", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const mine = await privateAccount("member"); await source({ accountId: mine, amount: "500" });
    await alignCurrentCronMonth(); await channelPreferences(false, true); vi.stubEnv("CRON_SECRET", "synthetic-progress-cron");
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(false);
    const run = async () => {
      const response = await postCronDoor(app, "budget-alerts", "synthetic-progress-cron");
      expect(response.status).toBe(200);
      return response.body.jobs[0].summary;
    };
    expect((await run()).notificationsSent).toBe(0); expect((await run()).notificationsSent).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not expose or mutate an internal unconfirmed delivery claim through signed notification callers", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const mine = await privateAccount("member"); await source({ accountId: mine, amount: "500" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, true);
    const userId = actors.get("member")!.id, cookie = actors.get("member")!.cookie;
    const unreadBefore = await notificationService.getUnreadCount(userId);
    vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(false);
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, userId)).toBe(false);
    const [claim] = await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, userId)));
    expect(claim).toBeDefined();
    const listed = await request(app).get("/api/notifications?includeArchived=true&limit=100").set("Cookie", cookie).expect(200);
    expect(listed.body.data.map((row: { id: string }) => row.id)).not.toContain(claim.id);
    await request(app).get(`/api/notifications/${claim.id}`).set("Cookie", cookie).expect(404);
    await request(app).put(`/api/notifications/${claim.id}/read`).set("Cookie", cookie).expect(404);
    await request(app).delete(`/api/notifications/${claim.id}`).set("Cookie", cookie).expect(404);
    expect((await request(app).put("/api/notifications/batch-read").set("Cookie", cookie).send({ notificationIds: [claim.id] }).expect(200)).body.data.count).toBe(0);
    expect((await request(app).delete("/api/notifications/batch-archive").set("Cookie", cookie).send({ notificationIds: [claim.id] }).expect(200)).body.data.count).toBe(0);
    await request(app).put("/api/notifications/read-all").set("Cookie", cookie).expect(200);
    const [untouched] = await db.select().from(notifications).where(eq(notifications.id, claim.id)); expect(untouched).toEqual(claim);
    await db.update(notifications).set({ isArchived: false }).where(eq(notifications.id, claim.id));
    expect((await request(app).get("/api/notifications/unread-count").set("Cookie", cookie).expect(200)).body.data.count).toBe(0);
    expect(unreadBefore).toBeGreaterThanOrEqual(0);
  });

  it("revalidates a newly inserted valid FX quote in the same statement that stores the review", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    await source({ amount: "200", currency: "USD" });
    const current = await alignCurrentCronMonth(); await channelPreferences(true, false);
    const effectiveDate = new Date().toISOString().slice(0, 10);
    await quote(effectiveDate, "3");
    const original = Client.prototype.query; let changed = false;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!changed && /insert into "notifications"/i.test(statement)) {
        changed = true;
        // A new household manual rate outranks the shared row the gate locked.
        return householdRate(a, "0.1", effectiveDate).then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 152, "exceeded", current.year, current.month, actors.get("member")!.id)).toBe(false);
    expect(changed).toBe(true);
    expect(await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, actors.get("member")!.id)))).toHaveLength(0);
  });

  it("does not dispatch to an old email replaced and verified during final eligibility", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const mine = await privateAccount("member"); await source({ accountId: mine, amount: "500" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, true);
    const userId = actors.get("member")!.id;
    const [before] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(true);
    const original = Client.prototype.query; let userLocks = 0, changed = false;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (/from "users"/i.test(statement) && /for update/i.test(statement) && ++userLocks === 2) {
        changed = true;
        return db.update(users).set({ email: `replacement-${randomUUID()}@example.invalid`, emailVerified: true }).where(eq(users.id, userId)).then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    try {
      expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, userId)).toBe(false);
      expect(changed).toBe(true); expect(transport).not.toHaveBeenCalled();
    } finally { await db.update(users).set({ email: before.email, emailVerified: true }).where(eq(users.id, userId)); }
  });

  it.each(["unsubscribe", "rotate keys"])("binds the mocked push adapter to the signed current subscription after %s", async change => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const mine = await privateAccount("member"); await source({ accountId: mine, amount: "500" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, false);
    const userId = actors.get("member")!.id, cookie = actors.get("member")!.cookie;
    await db.update(userNotificationPreferences).set({ pushEnabled: true }).where(eq(userNotificationPreferences.userId, userId));
    vi.stubEnv("VAPID_PUBLIC_KEY", "synthetic-mocked-key"); vi.stubEnv("VAPID_PRIVATE_KEY", "synthetic-mocked-key");
    const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: "old-key", auth: "old-auth" } };
    await request(app).post("/api/notifications/push/subscribe").set("Cookie", cookie).send({ subscription }).expect(200);
    const actual = pushNotificationService.getUserSubscriptions.bind(pushNotificationService); let changed = false;
    vi.spyOn(pushNotificationService, "getUserSubscriptions").mockImplementation(async id => {
      const cached = await actual(id);
      if (!changed && id === userId) {
        changed = true;
        if (change === "unsubscribe") await request(app).delete("/api/notifications/push/unsubscribe").set("Cookie", cookie).send({ endpoint: subscription.endpoint }).expect(200);
        else await request(app).post("/api/notifications/push/subscribe").set("Cookie", cookie).send({ subscription: { ...subscription, keys: { p256dh: "new-key", auth: "new-auth" } } }).expect(200);
      }
      return cached;
    });
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 132, "exceeded", current.year, current.month, userId)).toBe(false);
    expect(changed).toBe(true); expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it.each(["email", "push"] as const)("binds the last %s destination check to the same financial cut after a competing FX insert", async channel => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    await source({ amount: "200", currency: "USD" });
    const current = await alignCurrentCronMonth(); await channelPreferences(false, channel === "email");
    const userId = actors.get("member")!.id;
    if (channel === "push") {
      await db.update(userNotificationPreferences).set({ pushEnabled: true }).where(eq(userNotificationPreferences.userId, userId));
      vi.stubEnv("VAPID_PUBLIC_KEY", "synthetic-mocked-key"); vi.stubEnv("VAPID_PRIVATE_KEY", "synthetic-mocked-key");
      await request(app).post("/api/notifications/push/subscribe").set("Cookie", actors.get("member")!.cookie)
        .send({ subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: "mock-key", auth: "mock-auth" } } }).expect(200);
    }
    const effectiveDate = new Date().toISOString().slice(0, 10);
    await quote(effectiveDate, "3");
    const transport = vi.spyOn(emailDelivery, "sendEmail").mockResolvedValue(true);
    const original = Client.prototype.query; let changed = false;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      const destinationRead = channel === "email"
        ? /from "users"/i.test(statement) && /"email"/.test(statement) && /"email_verified"/.test(statement) && !/for update/i.test(statement)
        : /from "user_push_subscriptions"/i.test(statement) && /for share/i.test(statement);
      if (!changed && destinationRead) {
        changed = true;
        return householdRate(a, "0.1", effectiveDate).then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    expect(await notificationService.triggerBudgetAlert(a, flexBudget, "retired financial title", 152, "exceeded", current.year, current.month, userId)).toBe(false);
    expect(changed).toBe(true); expect(transport).not.toHaveBeenCalled(); expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("allows an overlapping normal transaction-to-account edit to finish without publisher lock inversion", async () => {
    await db.update(budgets).set({ amount: "500" }).where(eq(budgets.householdId, a));
    const changingAccount = await privateAccount("owner"); await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, changingAccount));
    const changingTransaction = await source({ accountId: changingAccount, amount: "500" });
    await alignCurrentCronMonth(); await channelPreferences(true, false); vi.stubEnv("CRON_SECRET", "synthetic-progress-cron");
    let unlock!: () => void, locked!: () => void, boundary!: (value: string) => void;
    const release = new Promise<void>(done => { unlock = done; }), hasLock = new Promise<void>(done => { locked = done; });
    const firstBoundary = new Promise<string>(done => { boundary = done; });
    const writer = db.transaction(async tx => {
      await tx.select().from(transactions).where(eq(transactions.id, changingTransaction)).for("update"); locked(); await release;
      await tx.select().from(accounts).where(eq(accounts.id, changingAccount)).for("update");
      await tx.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, changingTransaction));
    });
    await hasLock;
    const original = Client.prototype.query; let signaled = false;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      const kind = /from\s+"transactions"/i.test(statement) ? "transactions" : /from\s+"accounts"/i.test(statement) ? "accounts" : null;
      if (!signaled && kind && /for update/i.test(statement)) {
        signaled = true;
        if (kind === "transactions") { boundary(kind); return Reflect.apply(original, this, args); }
        return Promise.resolve(Reflect.apply(original, this, args)).then(value => { boundary(kind); return value; });
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    const publishing = postCronDoor(app, "budget-alerts", "synthetic-progress-cron");
    let first: string;
    try { first = await Promise.race([firstBoundary, new Promise<string>(done => setTimeout(() => done("no lock"), 4000))]); }
    finally { unlock(); }
    const [, result] = await Promise.all([writer, publishing]); expect(result.status).toBe(200); expect(first).toBe("transactions");
    const recipientRows = await db.select().from(notifications).where(and(eq(notifications.householdId, a), eq(notifications.userId, actors.get("member")!.id)));
    expect(recipientRows).toHaveLength(0);
  }, 15_000);
});
