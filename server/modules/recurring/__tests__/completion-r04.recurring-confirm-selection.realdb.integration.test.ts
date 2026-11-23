import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { accounts, auditLogs, categories, households, merchants, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions, userDisplaySettings, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { getVerifiedRecurringRuleCurrency, PATTERN_ORIGIN_ACTION, patternOriginSchema } from "../../../services/recurring/RecurringPatternProvenance";
import { recordRecurringDenomination } from "../../../services/recurring/RecurringDenomination";
import { isPostgresError } from "../../../utils/postgresError";
import { recurringService } from "../../../services/RecurringService";
import { resolvePatternWindow } from "../../../services/recurring/RecurringPatternSelection";
import { patternOptionsSchema } from "@shared/recurring-pattern";
import { a, actors, app, b, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const accountId = randomUUID(), destinationId = randomUUID(), merchantId = randomUUID(), categoryId = randomUUID();
const name = "COMPLETE_CONFIRMED_SELECTION";
function dates(count = 3) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - count + index, 10)).toISOString().slice(0, 10));
}
/**
 * `count` monthly dates inside the default detection window for `now`, in the member's
 * timezone: day 1 of each of the last `count` local months, the current one included.
 * The window starts on today's day-of-month six months back, so any fixed day (the old
 * "day 20" seed) falls out of it on later days of the month; day 1 never does.
 */
function defaultWindow(now = new Date()) {
  return resolvePatternWindow(patternOptionsSchema.parse({}), "Africa/Lusaka", now);
}
function windowDates(count: number, now = new Date()) {
  const { startDate, endDate } = defaultWindow(now);
  const [year, month] = endDate.split("-").map(Number);
  const result = Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - count + index, 1)).toISOString().slice(0, 10));
  expect(result.every(date => date >= startDate && date <= endDate)).toBe(true);
  return result;
}
/** Household clock edges the default window must survive (Lusaka is UTC+2). */
const PINNED_CLOCKS = [
  "2026-11-20T22:30:00Z", // Lusaka 21 Nov 00:30: past the old seed's day 20, UTC still the 20th
  "2026-10-31T22:30:00Z", // Lusaka 1 Nov 00:30: UTC still in the previous month
  "2026-11-15T10:00:00Z", // mid-month
] as const;
async function seed(sourceDates = dates(), currency: string | null = "ZMW", amounts?: string[]) {
  const ids = sourceDates.map(() => randomUUID());
  await db.insert(transactions).values(ids.map((id, index) => ({ id, householdId: a, accountId, ownerUserId: actors.get("owner")!.id,
    name, merchantId, categoryId, date: sourceDates[index], amount: amounts?.[index] ?? "7.25", currency,
    type: "expense" as const, isPrivate: false, isPending: false, isRecurring: false })));
  return ids;
}
async function detect(options: Record<string, unknown> = {}, viewer: Role = "member") {
  const response = await request(app).post("/api/recurring/detect").set("Cookie", actors.get(viewer)!.cookie).send(options).expect(200);
  const pattern = response.body.data.find((item: { name: string }) => item.name === name);
  expect(pattern).toBeDefined();
  return pattern;
}
function confirm(pattern: unknown, viewer: Role = "member") {
  return request(app).post("/api/recurring/confirm").set("Cookie", actors.get(viewer)!.cookie).send({ accountId: destinationId, pattern });
}
function detail(id: string, viewer: Role = "member") {
  return request(app).get(`/api/recurring/${id}`).set("Cookie", actors.get(viewer)!.cookie);
}
async function snapshot() {
  return {
    rules: await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a)).orderBy(recurringTransactions.id),
    links: await db.select().from(recurringTransactionLinks).innerJoin(recurringTransactions, eq(recurringTransactions.id, recurringTransactionLinks.recurringTransactionId))
      .where(eq(recurringTransactions.householdId, a)).orderBy(recurringTransactionLinks.id),
    history: await db.select().from(recurringTransactionHistory).innerJoin(recurringTransactions, eq(recurringTransactions.id, recurringTransactionHistory.recurringTransactionId))
      .where(eq(recurringTransactions.householdId, a)).orderBy(recurringTransactionHistory.id),
    transactions: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  // Trusted private postings write actorless, household-free audit rows.
  // Find the synthetic rows through their transactions before deleting those.
  const privatePostings = db.select({ id: transactions.id }).from(transactions).where(and(
    eq(transactions.householdId, a), eq(transactions.source, "recurring"), eq(transactions.isPrivate, true),
  ));
  await db.delete(auditLogs).where(and(
    inArray(auditLogs.entityId, privatePostings), isNull(auditLogs.householdId), isNull(auditLogs.userId),
    eq(auditLogs.action, "CREATE"), eq(auditLogs.entityType, "transaction"),
    sql`${auditLogs.details}->>'reason' = 'recurring_materialization'`,
  ));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(accounts).where(inArray(accounts.id, [accountId, destinationId]));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await db.delete(categories).where(eq(categories.id, categoryId));
  const member = actors.get("member");
  if (member) {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, member.id));
    await db.update(users).set({ timezone: "Africa/Lusaka" }).where(eq(users.id, member.id));
  }
}

// The HTTP tests above run on the real clock (pinning it breaks the session store), so the
// seed construction is pinned here against the product's own window function.
describe("default-window seed dates hold on every household day", () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(PINNED_CLOCKS)("keeps all six seeded dates inside the default window at %s", clock => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(clock));
    const seeded = windowDates(6);
    expect(new Set(seeded.map(date => date.slice(0, 7))).size).toBe(6);
  });

  it("the old fixed day-20 seed falls outside the window on Lusaka 21 Nov (the failure it replaces)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_CLOCKS[0]));
    const { startDate } = defaultWindow();
    expect(startDate).toBe("2026-05-21");
    expect(dates(6).map(date => date.slice(0, 8) + "20").filter(date => date < startDate)).toEqual(["2026-05-20"]);
  });
});

describe("R04 recurring confirmation binds complete derivation and preserves its origins", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.insert(accounts).values([accountId, destinationId].map(id => ({ id, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: `Selection ${id}`, type: "checking" as const, balance: "1000.00", currency: "ZMW", isPrivate: false })));
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: "Selection merchant" });
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Selection historical category", displayOrder: 1 });
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("links all six contributors, sets counts/dates once, and omits the internal marker before history limits", async () => {
    const ids = await seed(dates(6)), pattern = await detect({ lookbackMonths: 12 });
    expect(pattern.sampleTransactionIds).toHaveLength(5);
    expect(pattern.selection.contributorIds).toEqual(ids);
    const created = await confirm(pattern).expect(201), id = created.body.data.id;
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
    expect(await getVerifiedRecurringRuleCurrency(id, b)).toBeNull();
    expect(created.body.data).toMatchObject({ totalOccurrences: 6, lastOccurredDate: dates(6)[5] });
    const links = await db.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, id));
    expect(links).toHaveLength(6);
    expect(links.every(link => link.expectedDate === link.actualDate)).toBe(true);
    const history = await request(app).get(`/api/recurring/${id}/history?limit=2`).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(history.body.data).toHaveLength(2);
    expect(JSON.stringify(history.body)).not.toMatch(/pattern_origin_v1|denomination_confirmed_v1|fingerprint|contributors/);
    await detail(id).expect(200);
    const list = await request(app).get("/api/recurring").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(list.body.data.map((rule: { id: string }) => rule.id)).toContain(id);
    const upcoming = await request(app).get("/api/recurring/upcoming?days=365").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(upcoming.body.data.map((rule: { id: string }) => rule.id)).toContain(id);
    const summary = await request(app).get("/api/recurring/summary").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(summary.body.data).toMatchObject({ activeCount: 1, totalMonthlyExpenses: { amount: "7.25", currency: "ZMW" } });
  });

  it("accepts an exact complete default legacy request and refuses a five-sample larger preview", async () => {
    await seed();
    const exact = await detect(); delete exact.selection;
    await confirm(exact).expect(201);
    await clean(); await reset();
    await db.insert(accounts).values([accountId, destinationId].map(id => ({ id, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: "Legacy selection account", type: "checking" as const, balance: "1000.00", currency: "ZMW", isPrivate: false })));
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: "Selection merchant" });
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Selection category", displayOrder: 1 });
    // Six dates inside the default window for whatever the household's today is.
    await seed(windowDates(6));
    const preview = await detect(); delete preview.selection;
    expect(preview.occurrences).toBe(6);
    const before = await snapshot();
    await confirm(preview).expect(409);
    expect(await snapshot()).toEqual(before);
  });

  it("drops a seeded date one day before the default window, so the six-date seed above is a real check", async () => {
    const before = new Date(`${defaultWindow().startDate}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    await seed([before.toISOString().slice(0, 10), ...windowDates(5)]);
    expect((await detect()).occurrences).toBe(5);
  });

  it.each(["amount swap", "reference", "date", "options", "omitted contributor"] as const)("rejects a stale selector after %s without effects", async kind => {
    const ids = await seed(dates(), "ZMW", ["7.24", "7.25", "7.26"]), pattern = await detect();
    if (kind === "amount swap") {
      await db.update(transactions).set({ amount: "7.25" }).where(eq(transactions.id, ids[0]));
      await db.update(transactions).set({ amount: "7.24" }).where(eq(transactions.id, ids[1]));
    } else if (kind === "reference") await db.update(transactions).set({ categoryId: null }).where(eq(transactions.id, ids[1]));
    else if (kind === "date") await db.update(transactions).set({ date: dates()[1].slice(0, 8) + "11" }).where(eq(transactions.id, ids[1]));
    else if (kind === "options") pattern.selection.options.confidenceThreshold = 50;
    else pattern.selection.contributorIds.pop();
    const before = await snapshot();
    await confirm(pattern).expect(409);
    expect(await snapshot()).toEqual(before);
  });

  it("retains original account provenance after every source moves and all link rows are removed", async () => {
    const ids = await seed(), created = await confirm(await detect()).expect(201), id = created.body.data.id;
    await db.update(transactions).set({ accountId: destinationId }).where(inArray(transactions.id, ids));
    await db.delete(recurringTransactionLinks).where(eq(recurringTransactionLinks.recurringTransactionId, id));
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
    await detail(id).expect(404);
    await detail(id, "owner").expect(200);
    await request(app).post(`/api/recurring/${id}/pause`).set("Cookie", actors.get("member")!.cookie).send({}).expect(404);
    const list = await request(app).get("/api/recurring").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(list.body.data).toEqual([]);
    const summary = await request(app).get("/api/recurring/summary").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(summary.body.data.activeCount).toBe(0);
  });

  it.each(["hard", "soft"] as const)("retains full lineage when an origin is %s deleted and fails closed", async mode => {
    const ids = await seed(), created = await confirm(await detect()).expect(201), id = created.body.data.id;
    if (mode === "hard") await db.delete(transactions).where(eq(transactions.id, ids[0]));
    else await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, ids[0]));
    const marker = await db.select().from(recurringTransactionHistory).where(and(eq(recurringTransactionHistory.recurringTransactionId, id), eq(recurringTransactionHistory.action, PATTERN_ORIGIN_ACTION)));
    expect(JSON.stringify(marker)).toContain(ids[0]);
    await detail(id).expect(404); await detail(id, "owner").expect(404);
  });

  it.each(["missing", "duplicate", "malformed", "currency mismatch"] as const)("conceals a %s completeness marker", async kind => {
    await seed();
    const created = await confirm(await detect()).expect(201), id = created.body.data.id;
    const [marker] = await db.select().from(recurringTransactionHistory).where(and(eq(recurringTransactionHistory.recurringTransactionId, id), eq(recurringTransactionHistory.action, PATTERN_ORIGIN_ACTION)));
    if (kind === "missing") await db.delete(recurringTransactionHistory).where(eq(recurringTransactionHistory.id, marker.id));
    else if (kind === "duplicate") await db.insert(recurringTransactionHistory).values({ recurringTransactionId: id, action: PATTERN_ORIGIN_ACTION, newState: marker.newState });
    else if (kind === "malformed") await db.update(recurringTransactionHistory).set({ newState: { version: 2, contributors: [] } }).where(eq(recurringTransactionHistory.id, marker.id));
    else await db.update(recurringTransactionHistory).set({ newState: { ...patternOriginSchema.parse(marker.newState), currency: "USD" } }).where(eq(recurringTransactionHistory.id, marker.id));
    await detail(id).expect(404);
    // A separate definition-bound currency receipt grants no access through a broken origin marker.
    expect(await getVerifiedRecurringRuleCurrency(id, a)).toBe("ZMW");
  });

  it("keeps historical soft-deleted category metadata eligible without authoring that category onto the rule", async () => {
    await seed(); await db.update(categories).set({ deletedAt: new Date(), isArchived: true }).where(eq(categories.id, categoryId));
    const created = await confirm(await detect()).expect(201);
    expect(created.body.data.categoryId).toBeNull(); await detail(created.body.data.id).expect(200);
  });

  it.each([1, 2])("requires rescan for a legacy %s-source group unsupported by the documented default", async count => {
    const ids = await seed(), pattern = await detect();
    delete pattern.selection;
    await db.delete(transactions).where(inArray(transactions.id, ids.slice(count)));
    pattern.sampleTransactionIds = ids.slice(0, count);
    const before = await snapshot();
    const response = await confirm(pattern).expect(409);
    expect(response.body.error.message).toMatch(/scan again/i);
    expect(await snapshot()).toEqual(before);
  });

  it("lets only one of two overlapping complete selections claim its sources", async () => {
    const ids = await seed(), pattern = await detect();
    const responses = await Promise.all([confirm(pattern).then(response => response), confirm(pattern).then(response => response)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const after = await snapshot();
    expect(after.rules).toHaveLength(1); expect(after.links).toHaveLength(ids.length);
    expect(after.audit.filter(row => row.action === "CREATE" && row.entityType === "recurring_rule")).toHaveLength(1);
  });

  it.each(["USD", "unknown", "household", "account"] as const)("reports and refuses unsupported %s denomination without relabeling or writes", async kind => {
    await seed(dates(), kind === "USD" ? "USD" : kind === "unknown" ? null : "ZMW");
    if (kind === "USD") await db.update(accounts).set({ currency: "USD" }).where(inArray(accounts.id, [accountId, destinationId]));
    if (kind === "household") await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    if (kind === "account") await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, accountId));
    const pattern = await detect();
    expect(pattern.confirmationIssue).toMatch(/denomination|multi-currency/i);
    expect(pattern.estimatedAmount.currency).toBe(kind === "USD" ? "USD" : kind === "unknown" ? "" : "ZMW");
    const before = await snapshot(), response = await confirm(pattern).expect(400);
    if (kind !== "unknown") expect(response.body.error.message).toMatch(/denomination|multi-currency/i);
    expect(await snapshot()).toEqual(before);
  });

  it("preserves a real 31st anchor and a Sunday-zero off-anchor weekly observation", async () => {
    await seed(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const monthly = await detect({ lookbackMonths: 12 });
    expect(monthly.dayOfMonth).toBe(31);
    const created = await confirm(monthly).expect(201);
    expect(created.body.data).toMatchObject({ dayOfMonth: 31, nextDueDate: "2026-04-30", totalOccurrences: 3 });
    await db.delete(transactions).where(eq(transactions.householdId, a));
    await seed(["2026-10-04", "2026-10-11", "2026-10-19"]);
    const weekly = await detect({ confidenceThreshold: 50 });
    expect(weekly.dayOfWeek).toBe(0);
    const sunday = await confirm(weekly).expect(201);
    expect(sunday.body.data).toMatchObject({ dayOfWeek: 0, nextDueDate: "2026-11-01", lastOccurredDate: "2026-10-19" });
  });

  it("preserves the existing database rejection of blank stored currency", async () => {
    const before = await snapshot();
    let failure: unknown;
    try { await seed(dates(), ""); } catch (error) { failure = error; }
    expect(isPostgresError(failure, "23514")).toBe(true);
    expect(failure).toMatchObject({ cause: { constraint: "chk_transaction_currency_length" } });
    expect(await snapshot()).toEqual(before);
  });

  it("labels the actual stored personal timezone and invalidates its changed preview", async () => {
    await seed();
    await db.update(users).set({ timezone: "America/Los_Angeles" }).where(eq(users.id, actors.get("member")!.id));
    await db.insert(userDisplaySettings).values({ userId: actors.get("member")!.id, timezone: "Pacific/Auckland" })
      .onConflictDoUpdate({ target: userDisplaySettings.userId, set: { timezone: "Pacific/Auckland" } });
    const pattern = await detect();
    expect(pattern.selection).toMatchObject({ timezone: "Pacific/Auckland", timezoneSource: "display" });
    await db.update(userDisplaySettings).set({ timezone: "UTC" }).where(eq(userDisplaySettings.userId, actors.get("member")!.id));
    const before = await snapshot();
    await confirm(pattern).expect(409);
    expect(await snapshot()).toEqual(before);
  });

  it("uses an actual stored profile default and refuses an unknown timezone instead of inventing one", async () => {
    await seed();
    await db.update(users).set({ timezone: "UTC" }).where(eq(users.id, actors.get("member")!.id));
    expect((await detect()).selection).toMatchObject({ timezone: "UTC", timezoneSource: "profile" });
    await db.update(users).set({ timezone: null }).where(eq(users.id, actors.get("member")!.id));
    const response = await request(app).post("/api/recurring/detect").set("Cookie", actors.get("member")!.cookie).send({}).expect(400);
    expect(response.body.error.message).toMatch(/display or profile timezone/i);
  });

  it("preserves fractional measured deviation above 50 separately from the capped rule policy", async () => {
    await seed(dates(6), "ZMW", ["1.00", "3.00", "1.00", "3.00", "1.00", "4.00"]);
    const pattern = await detect({ confidenceThreshold: 50, lookbackMonths: 12 });
    expect(pattern.amountVariance).toBeGreaterThan(50);
    expect(pattern.amountVariance % 1).not.toBe(0);
    expect(pattern.amountTolerance).toBe(50);
    const created = await confirm(pattern).expect(201);
    expect(created.body.data).toMatchObject({ amountType: "variable", amountTolerance: 50 });
  });

  for (const caller of ["signed", "trusted"] as const) {
    it.each(["public", "private contributors", "private original account"] as const)(`keeps ${caller} materialization denomination and ordinary ledger visibility for %s`, async privacy => {
      const viewer = privacy === "private original account" ? "owner" : "member";
      const peer = viewer === "member" ? "owner" : "member";
      const sourceIds = await seed(dates().map(date => date.slice(0, 8) + "01"));
      if (privacy === "private contributors") await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get(viewer)!.id }).where(inArray(transactions.id, sourceIds));
      if (privacy === "private original account") await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
      const created = await confirm(await detect({}, viewer), viewer).expect(201), id = created.body.data.id;
      if (caller === "signed") {
        const response = await request(app).post("/api/recurring/process").set("Cookie", actors.get(viewer)!.cookie).send({}).expect(200);
        expect(response.body.data.created).toBe(1);
      } else expect((await recurringService.processRecurring(a)).created).toBe(1); // The exact trusted cron service entry point.
      const rows = await db.select().from(transactions).where(and(eq(transactions.recurringTransactionId, id), eq(transactions.source, "recurring")));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ currency: "ZMW", isPrivate: privacy !== "public",
        ownerUserId: privacy !== "public" || caller === "signed" ? actors.get(viewer)!.id : null });
      await request(app).get(`/api/transactions/${rows[0].id}`).set("Cookie", actors.get(viewer)!.cookie).expect(200);
      await request(app).get(`/api/transactions/${rows[0].id}`).set("Cookie", actors.get(peer)!.cookie).expect(privacy === "public" ? 200 : 404);
      await detail(id, viewer).expect(200);
      await request(app).get(`/api/recurring/${id}/history`).set("Cookie", actors.get(viewer)!.cookie).expect(200);
      const upcoming = await request(app).get("/api/recurring/upcoming?days=365").set("Cookie", actors.get(viewer)!.cookie).expect(200);
      expect(upcoming.body.data.map((rule: { id: string }) => rule.id)).toContain(id);
      const [account] = await db.select().from(accounts).where(eq(accounts.id, destinationId));
      expect(account.balance).toBe("992.75"); // Existing posting arithmetic; this repair supplies metadata and authorization.
    });
  }

  it.each(["linked private transaction", "linked private account", "historical private transaction", "historical private account", "unattested suggested", "unknown origin", "null origin"] as const)(
    "keeps %s rules out of signed dry-run and actual processing", async origin => {
      const sourceIds = await seed(), id = randomUUID();
      await db.insert(recurringTransactions).values({ id, householdId: a, accountId: destinationId, name: "PROCESS_PRIVATE_RULE_SECRET",
        amount: "7.25", type: "expense", frequency: "monthly", startDate: dates()[0], nextDueDate: dates()[2],
        detectionMethod: origin === "unattested suggested" ? "suggested" : origin === "unknown origin" ? "unknown" : origin === "null origin" ? null : "manual" });
      if (origin === "linked private transaction" || origin === "linked private account") {
        await db.insert(recurringTransactionLinks).values({ recurringTransactionId: id, transactionId: sourceIds[0] });
        if (origin === "linked private transaction") await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, sourceIds[0]));
        else await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
      } else if (origin === "historical private transaction") {
        await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, sourceIds[0]));
        await db.insert(recurringTransactionHistory).values({ recurringTransactionId: id, action: "unlinked", linkedTransactionId: sourceIds[0] });
      } else if (origin === "historical private account") {
        await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
        await db.insert(recurringTransactionHistory).values({ recurringTransactionId: id, action: "updated", previousState: { accountId }, newState: { accountId: destinationId } });
      }
      const before = await snapshot();
      for (const dryRun of [true, false]) {
        const response = await request(app).post("/api/recurring/process").set("Cookie", actors.get("member")!.cookie).send({ dryRun }).expect(200);
        expect(response.body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
        expect(JSON.stringify(response.body)).not.toContain("PROCESS_PRIVATE_RULE_SECRET");
        expect(JSON.stringify(response.body)).not.toContain(id);
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  it("refuses a mixed-private-owner template rather than publishing a shared or arbitrarily owned ledger row", async () => {
    const sourceIds = await seed(), id = randomUUID();
    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, sourceIds[0]));
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, sourceIds[1]));
    await db.insert(recurringTransactions).values({ id, householdId: a, accountId: destinationId, name: "MIXED_PRIVATE_ORIGIN_SECRET",
      amount: "7.25", type: "expense", frequency: "monthly", startDate: dates()[0], nextDueDate: dates()[2], detectionMethod: "manual" });
    const [knownRule] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id));
    await db.transaction(tx => recordRecurringDenomination(tx, knownRule, "ZMW", actors.get("owner")!.id, "trusted_recovery"));
    await db.insert(recurringTransactionLinks).values(sourceIds.map(transactionId => ({ recurringTransactionId: id, transactionId })));
    const before = await snapshot();
    const result = await recurringService.processRecurring(a);
    expect(result.created).toBe(0); expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/single owner/);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["grant", "source privacy", "source denomination", "destination denomination"] as const)("rechecks signed processing under a concurrent %s writer", async change => {
    const sourceIds = await seed(dates().map(date => date.slice(0, 8) + "01"));
    await confirm(await detect()).expect(201);
    const before = await snapshot(), blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined, waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "grant") await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      else if (change === "source privacy") await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [sourceIds[0]]);
      else if (change === "source denomination") await blocker.query("UPDATE transactions SET currency='USD' WHERE id=$1", [sourceIds[0]]);
      else await blocker.query("UPDATE accounts SET currency='USD' WHERE id=$1", [destinationId]);
      let settled = false;
      pending = request(app).post("/api/recurring/process").set("Cookie", actors.get("member")!.cookie).send({}).timeout(10_000)
        .then(response => { settled = true; return response; });
      void pending.catch(() => { settled = true; });
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(change === "grant" ? 403 : 200);
    if (change !== "grant") expect((await pending!).body.data).toMatchObject({ processed: 0, created: 0, errors: [] });
    expect(await snapshot()).toEqual({ ...before,
      transactions: before.transactions.map(source => source.id === sourceIds[0] && change === "source privacy" ? { ...source, isPrivate: true }
        : source.id === sourceIds[0] && change === "source denomination" ? { ...source, currency: "USD" } : source),
      accounts: before.accounts.map(account => account.id === destinationId && change === "destination denomination" ? { ...account, currency: "USD" } : account),
    });
  });

  it.each(["target", "survivor"] as const)("keeps a %s's private original marker account protected when unlinking a different public source", async subject => {
    const sourceIds = await seed(), created = await confirm(await detect()).expect(201), suggestedId = created.body.data.id;
    let targetId = suggestedId;
    const [selected] = await db.select().from(recurringTransactionLinks).where(and(eq(recurringTransactionLinks.recurringTransactionId, suggestedId), eq(recurringTransactionLinks.transactionId, sourceIds[2])));
    let linkId = selected.id;
    if (subject === "survivor") {
      targetId = randomUUID();
      await db.insert(recurringTransactions).values({ id: targetId, householdId: a, accountId: destinationId, name: "Visible legacy target",
        amount: "7.25", type: "expense", frequency: "monthly", startDate: dates()[0], nextDueDate: dates()[2], detectionMethod: "manual" });
      expect(await getVerifiedRecurringRuleCurrency(targetId, a)).toBeNull();
      const [link] = await db.insert(recurringTransactionLinks).values({ recurringTransactionId: targetId, transactionId: sourceIds[2] }).returning();
      linkId = link.id;
      await db.update(transactions).set({ recurringTransactionId: targetId }).where(eq(transactions.id, sourceIds[2]));
    }
    await db.update(transactions).set({ accountId: destinationId }).where(inArray(transactions.id, sourceIds));
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
    await detail(suggestedId).expect(404);
    if (subject === "survivor") await detail(targetId).expect(200);
    const before = await snapshot();
    await request(app).delete(`/api/recurring/${targetId}/link/${linkId}`).set("Cookie", actors.get("member")!.cookie).expect(404);
    expect(await snapshot()).toEqual(before);
  });
});
