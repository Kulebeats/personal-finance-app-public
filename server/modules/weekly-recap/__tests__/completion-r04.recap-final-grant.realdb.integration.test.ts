import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, categories, categoryGroups, fxRates, providerFxQuotes, transactions, householdMembers, households, notificationDeliveries, recurringTransactions, userNotificationPreferences, users } from "@shared/schema";
import { db } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { sendEmail } from "../../../services/emailService";
import { Client } from "pg";

import { weeklyRecapService } from "../weekly-recap.service";
import { processWeeklyRecapEmails, sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

// No replacement financial data: spies only coordinate real work or inject an
// actual PostgreSQL error at the protected query boundary. SMTP never leaves test.
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);
const memberAccountId = randomUUID();
const ruleIds = { shared: randomUUID(), ownerPrivate: randomUUID(), memberPrivate: randomUUID() };
let from: string, to: string;
// A-26: the scheduled digest lists bills due in the household's next seven
// dates (UTC here: no zone is set), not in the week that ended.
let due: string, dueEnd: string;

function previousWeek() {
  const now = new Date();
  let offset = now.getDay() - 1;
  if (offset < 0) offset += 7;
  const start = new Date(now);
  start.setDate(now.getDate() - offset - 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
// OPS-007: the scheduled run sends on the recipient's day, Monday when none is
// saved. Run it at this week's Monday, so its digest is the week previousWeek()
// returns (UTC here: no zone is set).
function mondayRun() {
  const now = new Date();
  const back = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back, 12));
}
function upcomingWeek() {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { due: start, dueEnd: end.toISOString().slice(0, 10) };
}
function revokeMember() {
  return db.delete(householdMembers).where(and(
    eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id),
  ));
}
function signedRecap(path = `?weekStart=${from}&weekEnd=${to}`) {
  return request(app).get(`/api/weekly-recap${path}`).set("Cookie", actors.get("member")!.cookie);
}
async function email(viewer: "owner" | "member") {
  return (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.id, actors.get(viewer)!.id) }))!.email;
}
async function enableRecipients(viewers: Array<"owner" | "member">) {
  await db.insert(userNotificationPreferences).values(viewers.map(viewer => ({
    userId: actors.get(viewer)!.id, notificationType: "weekly_recap", emailEnabled: true,
  })));
}
async function clearOwnRows() {
  if (actors.size) await db.delete(notificationDeliveries)
    .where(inArray(notificationDeliveries.userId, Array.from(actors.values(), actor => actor.id)));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, Object.values(ruleIds)));
  await db.delete(accounts).where(eq(accounts.id, memberAccountId));
  if (actors.size) await db.delete(userNotificationPreferences)
    .where(inArray(userNotificationPreferences.userId, Array.from(actors.values(), actor => actor.id)));
}

describe("R04 recap final recipient grant and protected recurring query failures", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    ({ from, to } = previousWeek());
    ({ due, dueEnd } = upcomingWeek());
    await db.update(households).set({ aiConsentGiven: true }).where(eq(households.id, a));
    await db.insert(accounts).values({ id: memberAccountId, householdId: a, name: "MEMBER_PRIVATE_ACCOUNT",
      type: "checking", currency: "ZMW", isPrivate: true, ownerUserId: actors.get("member")!.id });
    await db.insert(recurringTransactions).values([
      { id: ruleIds.shared, accountId: ids.sharedAccount, name: "VISIBLE_SHARED_BILL", amount: "11.11" },
      { id: ruleIds.ownerPrivate, accountId: ids.privateAccount, name: "OWNER_PRIVATE_BILL", amount: "777.77" },
      { id: ruleIds.memberPrivate, accountId: memberAccountId, name: "MEMBER_PRIVATE_BILL", amount: "55.55" },
    ].map(rule => ({ ...rule, householdId: a, type: "expense" as const,
      frequency: "monthly" as const, startDate: from, nextDueDate: due })));
  });
  afterEach(async () => { vi.restoreAllMocks(); await clearOwnRows(); });
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it("rejects the signed response if membership is revoked after the recurring SQL snapshot", async () => {
    const original = recurringService.getUpcomingBills.bind(recurringService);
    vi.spyOn(recurringService, "getUpcomingBills").mockImplementationOnce(async (...args) => {
      const bills = await original(...args);
      expect(bills.map(bill => bill.id)).toContain(ruleIds.memberPrivate);
      await revokeMember();
      return bills;
    });
    const response = await signedRecap().expect(403);
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/MEMBER_PRIVATE|55\.55/);
  });

  it("does not publish accumulated history after a later projection loses membership", async () => {
    const original = weeklyRecapService.getRecap.bind(weeklyRecapService);
    vi.spyOn(weeklyRecapService, "getRecap").mockImplementationOnce(async (...args) => {
      const recap = await original(...args);
      await revokeMember();
      return recap;
    });
    const response = await signedRecap("/history").expect(403);
    expect(response.body.data).toBeUndefined();
  });

  it("rechecks before publishing a generated recap after its audit await", async () => {
    const original = businessAuditService.log.bind(businessAuditService);
    vi.spyOn(businessAuditService, "log").mockImplementation(async entry => {
      await original(entry);
      if (entry.details?.action === "weekly_recap_generated") await revokeMember();
    });
    const response = await request(app).post("/api/weekly-recap/generate")
      .set("Cookie", actors.get("member")!.cookie).send({ weekOf: from }).expect(403);
    expect(response.body.data).toBeUndefined();
  });

  it.each(["consent", "preference", "address", "verification"] as const)(
    "withholds the scheduled financial email when %s changes during real assembly", async change => {
      await enableRecipients(["member"]);
      const recipient = actors.get("member")!.id;
      const originalEmail = await email("member");
      const assembly = onRelease(async text => {
        if (change === "consent") await db.update(households).set({ aiConsentGiven: false }).where(eq(households.id, a));
        if (change === "preference") await db.update(userNotificationPreferences).set({ emailEnabled: false })
          .where(and(eq(userNotificationPreferences.userId, recipient), eq(userNotificationPreferences.notificationType, "weekly_recap")));
        if (change === "address") await db.update(users).set({ email: `changed-${recipient}@example.invalid` }).where(eq(users.id, recipient));
        if (change === "verification") await db.update(users).set({ emailVerified: false }).where(eq(users.id, recipient));
        return text;
      });
      try {
        const result = await processWeeklyRecapEmails(mondayRun());
        expect(assembly).toHaveBeenCalledOnce();
        expect(smtp).not.toHaveBeenCalled();
        expect(result.sent).toBe(0);
        expect(result.skipped + result.failed).toBe(1);
        const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.householdId, a), eq(auditLogs.entityId, recipient)));
        expect(logs.some(row => (row.details as { exportType?: string } | null)?.exportType === "weekly_recap_email")).toBe(false);
      } finally {
        await db.update(users).set({ email: originalEmail, emailVerified: true }).where(eq(users.id, recipient));
      }
    },
  );

  it.each([true, false])("deduplicates scheduled recipients and respects a second legacy preference of %s", async enabled => {
    await enableRecipients(["member"]);
    await db.insert(userNotificationPreferences).values({ userId: actors.get("member")!.id, notificationType: "weekly_recap", emailEnabled: enabled });
    const result = await processWeeklyRecapEmails(mondayRun());
    expect(result).toEqual({ sent: enabled ? 1 : 0, skipped: enabled ? 0 : 1, failed: 0, unknown: 0 });
    expect(smtp).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it.each(["recap", "notifications"])("signed %s settings reconcile old conflicting opt-ins before the next digest", async surface => {
    const actor = actors.get("member")!;
    await enableRecipients(["member"]);
    await db.insert(userNotificationPreferences).values({
      userId: actor.id, notificationType: "weekly_recap", emailEnabled: false, pushEnabled: true,
    });
    const recapRead = () => request(app).get("/api/weekly-recap/settings").set("Cookie", actor.cookie).expect(200);
    const generalRead = () => request(app).get("/api/settings/notifications").set("Cookie", actor.cookie).expect(200);
    expect((await recapRead()).body.data.emailEnabled).toBe(false);
    const preferences = (await generalRead()).body.data.preferences.filter((row: { notificationType: string }) => row.notificationType === "weekly_recap");
    expect(preferences.length).toBeGreaterThan(0);
    expect(preferences.every((row: { emailEnabled: boolean }) => row.emailEnabled === false)).toBe(true);
    if (surface === "recap") {
      await request(app).patch("/api/weekly-recap/settings").set("Cookie", actor.cookie).send({ emailEnabled: true }).expect(200);
    } else {
      await request(app).put("/api/settings/notifications").set("Cookie", actor.cookie)
        .send({ preferences: [{ notificationType: "weekly_recap", emailEnabled: true }] }).expect(200);
    }
    expect((await recapRead()).body.data.emailEnabled).toBe(true);
    const rows = await db.select().from(userNotificationPreferences).where(and(eq(userNotificationPreferences.userId, actor.id),
      eq(userNotificationPreferences.notificationType, "weekly_recap")));
    expect(rows.map(row => row.emailEnabled)).toEqual([true, true]);
    expect(rows.filter(row => row.pushEnabled)).toHaveLength(1);
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
    expect(smtp).toHaveBeenCalledOnce();
  });

  // Change live state or inject a PostgreSQL error at the actual transport-decision read.
  function onRelease(change: (text: string) => Promise<string>, recipient?: string) {
    const run = vi.fn(change);
    const original = Client.prototype.query;
    function intercept(this: Client, ...args: unknown[]) {
      const request = args[0];
      const text = typeof request === "string" ? request : request && typeof request === "object" && "text" in request ? String(request.text) : "";
      const values = request && typeof request === "object" && "values" in request ? request.values : args[1];
      if (text.includes("WITH grant_rows AS") && !run.mock.calls.length && (!recipient || (Array.isArray(values) && values.includes(recipient)))) {
        return run(text).then(updated => {
          args[0] = typeof request === "object" ? { ...request, text: updated } : updated;
          return Reflect.apply(original, this, args);
        });
      }
      return Reflect.apply(original, this, args);
    }
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    return run;
  }

  it.each(["all confirmed", "one legacy", "amount changed"])("renders only recipient-visible and currently denominated bills: %s", async mode => {
    await enableRecipients(["member"]);
    const actor = actors.get("member")!;
    async function confirm(id: string, amount: string) {
      const path = "/api/recurring/" + id;
      const read = await request(app).get(path).set("Cookie", actor.cookie).expect(200);
      await request(app).put(path).set("Cookie", actor.cookie).send({
        confirmDenomination: true, expectedDefinition: read.body.data.definitionToken, amount: { amount, currency: "ZMW" },
      }).expect(200);
    }
    await confirm(ruleIds.shared, "11.11");
    if (mode !== "one legacy") await confirm(ruleIds.memberPrivate, "55.55");
    if (mode === "amount changed") onRelease(async text => {
      await db.update(recurringTransactions).set({ amount: "68.90" }).where(eq(recurringTransactions.id, ruleIds.memberPrivate));
      return text;
    });
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    try {
      expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
      const html = smtp.mock.calls[0][0].html;
      expect(html).toContain("Upcoming Bills (2)");
      expect(html).toMatch(/ZMW\s*11\.11 .*?Due/);
      expect(html).not.toContain("OWNER_PRIVATE_BILL");
      if (mode === "all confirmed") {
        expect(html).toMatch(/metric-value">ZMW\s*66\.66<\/div>/);
        expect(html).toMatch(/ZMW\s*55\.55 .*?Due/);
      } else {
        expect(html).toContain("Total unavailable because bill currency was not recorded");
        expect(html).toContain((mode === "one legacy" ? "55.55" : "68.90") + " (currency unrecorded)");
      }
    } finally {
      await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    }
  });

  it.each(["income only", "fixed expense", "estimated expense"])("classifies signed recurring rules in a digest with %s", async mode => {
    await enableRecipients(["member"]);
    const cookie = actors.get("member")!.cookie;
    const created: string[] = [];
    async function add(name: string, type: "income" | "expense", amount: string, amountType: "fixed" | "variable") {
      const result = await request(app).post("/api/recurring").set("Cookie", cookie).send({
        accountId: ids.sharedAccount, name, type, amount: { amount, currency: "ZMW" },
        amountType, frequency: "monthly", startDate: from, nextDueDate: due,
      }).expect(201);
      created.push(result.body.data.id);
    }
    try {
      await db.update(recurringTransactions).set({ isActive: false }).where(inArray(recurringTransactions.id, Object.values(ruleIds)));
      await add("MONTHLY_SALARY", "income", "1000.00", "fixed");
      if (mode !== "income only") await add("POWER_BILL", "expense", "100.00", mode === "estimated expense" ? "variable" : "fixed");
      expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
      const html = smtp.mock.calls[0][0].html;
      expect(html).not.toContain("MONTHLY_SALARY");
      if (mode === "income only") expect(html).not.toContain("Upcoming Bills");
      else {
        expect(html).toContain("Upcoming Bills (1)");
        expect(html).toContain("POWER_BILL");
        if (mode === "estimated expense") {
          expect(html).toMatch(/metric-value">Estimated total: ZMW 100\.00<\/div>/);
          expect(html).toMatch(/Estimated ZMW 100\.00 .*?Due/);
        } else {
          expect(html).toMatch(/metric-value">ZMW 100\.00<\/div>/);
          expect(html).not.toContain("Estimated total");
        }
      }
    } finally {
      if (created.length) await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, created));
    }
  });

  it("suppresses a digest when the household withdraws consent immediately before the release read", async () => {
    await enableRecipients(["member"]);
    const handoff = onRelease(async text => {
      await db.update(households).set({ aiConsentGiven: false }).where(eq(households.id, a));
      return text;
    });
    const result = await processWeeklyRecapEmails(mondayRun());
    expect(handoff).toHaveBeenCalledOnce();
    expect(smtp).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1, unknown: 0 });
  });

  it("removes a bill whose account became private after digest assembly", async () => {
    await enableRecipients(["member"]);
    const recap = await weeklyRecapService.getRecap(a, actors.get("member")!.id, due, dueEnd);
    expect(recap.recurring.upcoming.map(bill => bill.id)).toContain(ruleIds.shared);
    const handoff = onRelease(async text => {
      await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id })
        .where(eq(accounts.id, ids.sharedAccount));
      return text;
    });
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
    expect(handoff).toHaveBeenCalledOnce();
    const html = smtp.mock.calls[0][0].html;
    expect(html).toContain("MEMBER_PRIVATE_BILL");
    expect(html).not.toContain("VISIBLE_SHARED_BILL");
    expect(html).not.toContain("11.11");
  });

  it.each(["account", "transaction"])("withdraws both spending periods after %s privacy changes", async source => {
    await enableRecipients(["member"]);
    const groupId = randomUUID(), publicId = randomUUID(), privateId = randomUUID();
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, type: "expenses", displayOrder: 0, name: "Digest spending" });
    await db.insert(categories).values([{ id: publicId, name: "Public groceries" }, { id: privateId, name: "Private category marker" }]
      .map(row => ({ ...row, householdId: a, groupId, displayOrder: 0 })));
    const prior = new Date(from); prior.setUTCDate(prior.getUTCDate() - 7);
    const priorDate = prior.toISOString().slice(0, 10);
    const owner = actors.get("owner")!.id;
    await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
    await db.insert(transactions).values([
      { categoryId: publicId, accountId: ids.sharedAccount, amount: "20.00", date: from },
      { categoryId: publicId, accountId: ids.sharedAccount, amount: "10.00", date: priorDate },
      { categoryId: privateId, accountId: ids.privateAccount, amount: "30.00", date: from },
      { categoryId: privateId, accountId: ids.privateAccount, amount: "60.00", date: priorDate },
    ].map(row => ({ ...row, householdId: a, ownerUserId: owner, type: "expense" as const, currency: "ZMW", name: "Digest fixture" })));
    const data = await weeklyRecapService.getRecap(a, actors.get("member")!.id, from, to);
    expect(data.spending.topCategories.map(row => row.name)).toContain("Private category marker");
    const handoff = onRelease(async text => {
      if (source === "transaction") await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.categoryId, privateId));
      else await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.privateAccount));
      return text;
    });
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
    expect(handoff).toHaveBeenCalledOnce();
    const html = smtp.mock.calls[0][0].html;
    expect(html).toContain("Public groceries");
    expect(html).not.toContain("Private category marker");
    expect(html).toMatch(/20\.00/);
    expect(html).toContain("+100.0%");
  });

  it("never sends a fabricated zero or records delivery when the last spending read aborts", async () => {
    await enableRecipients(["member"]);
    const failure = onRelease(async text => text.replace("SELECT outcome,", "SELECT (1 / 0) AS forced_failure, outcome,"));
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 0, failed: 1, skipped: 0, unknown: 0 });
    expect(failure).toHaveBeenCalledOnce();
    expect(smtp).not.toHaveBeenCalled();
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.householdId, a));
    expect(logs.some(row => (row.details as { exportType?: string } | null)?.exportType === "weekly_recap_email")).toBe(false);
  });

  it("renders a visible bill name as text in the financial email", async () => {
    await enableRecipients(["member"]);
    await db.update(recurringTransactions).set({ name: "<b>Tea & coffee</b>" }).where(eq(recurringTransactions.id, ruleIds.shared));
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 0, skipped: 0, unknown: 0 });
    const html = smtp.mock.calls[0][0].html;
    expect(html).toContain("&lt;b&gt;Tea &amp; coffee&lt;/b&gt;");
    expect(html).not.toContain("<b>Tea & coffee</b>");
  });

  it.each(["0", "-1", "NaN", "round", "decline"])("validates dated spending FX and compares displayed money for %s", async mode => {
    const prior = new Date(from); prior.setUTCDate(prior.getUTCDate() - 7);
    const priorDate = prior.toISOString().slice(0, 10);
    const rateIds = [randomUUID(), randomUUID()];
    const groupId = randomUUID(), categoryId = randomUUID();
    await enableRecipients(["member"]);
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "FX fixture", displayOrder: 0, type: "expenses" });
    await db.insert(categories).values({ id: categoryId, groupId, householdId: a, name: "FX grocery", displayOrder: 0 });
    await db.insert(transactions).values([priorDate, from].map(date => ({
      householdId: a, accountId: ids.sharedAccount, categoryId, date, type: "expense" as const,
      currency: "XTS", amount: "0.01", name: "Synthetic currency purchase",
    })));
    try {
      const valid = mode === "round" || mode === "decline";
      await db.insert(fxRates).values([
        { id: rateIds[0], date: priorDate, rate: mode === "decline" ? "2" : "0.6" },
        { id: rateIds[1], date: from, rate: mode === "decline" ? "1" : mode === "round" ? "1.4" : mode },
      ].map(row => ({ ...row, fromCurrency: "XTS", toCurrency: "ZMW", source: "manual" })));
      if (valid) await db.insert(providerFxQuotes).values([
        { id: rateIds[0], date: priorDate, rate: mode === "decline" ? "2" : "0.6" },
        { id: rateIds[1], date: from, rate: mode === "decline" ? "1" : "1.4" },
      ].map(row => ({ id: row.id, rate: row.rate, fromCurrency: "XTS", toCurrency: "ZMW",
        provider: "yahoo_finance", effectiveDate: row.date, validThrough: row.date, quotedAt: new Date(row.date) })));
      const result = await processWeeklyRecapEmails(mondayRun());
      expect(result).toEqual({ sent: valid ? 1 : 0, failed: valid ? 0 : 1, skipped: 0, unknown: 0 });
      expect(smtp).toHaveBeenCalledTimes(valid ? 1 : 0);
      if (valid) {
        const html = smtp.mock.calls[0][0].html;
        expect(html).toContain("FX grocery");
        expect(html).toContain("0.01");
        if (mode === "round") expect(html).not.toContain("vs last week");
        else expect(html).toContain("↓ -50.0% vs last week");
      }
    } finally {
      await db.delete(providerFxQuotes).where(inArray(providerFxQuotes.id, rateIds));
      await db.delete(fxRates).where(inArray(fxRates.id, rateIds));
    }
  });

  it.each(["expired", "unattested provider label", "future only", "missing"])(
    "withholds an uncategorized foreign expense when its only rate is %s", async mode => {
      await enableRecipients(["member"]);
      const id = randomUUID();
      await db.insert(transactions).values({
        householdId: a, accountId: ids.sharedAccount, categoryId: null, date: from, type: "expense",
        currency: "XTS", amount: "10.00", name: "Foreign currency fixture",
      });
      try {
        if (mode !== "missing") await db.insert(fxRates).values({
          id, fromCurrency: "XTS", toCurrency: "ZMW", rate: "20", source: "yahoo_finance",
          date: mode === "expired" ? "2020-01-01" : mode === "future only" ? "2099-01-01" : from,
        });
        if (mode === "expired") await db.insert(providerFxQuotes).values({
          id, fromCurrency: "XTS", toCurrency: "ZMW", provider: "yahoo_finance", rate: "20",
          effectiveDate: "2020-01-01", validThrough: "2020-01-04", quotedAt: new Date("2020-01-01"),
        });
        expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 0, failed: 1, skipped: 0, unknown: 0 });
        expect(smtp).not.toHaveBeenCalled();
      } finally {
        await db.delete(providerFxQuotes).where(eq(providerFxQuotes.id, id));
        await db.delete(fxRates).where(eq(fxRates.id, id));
      }
    },
  );

  it.each([3, 4])("uses the approved carry boundary for an actual digest expense %i days after its quote", async days => {
    await enableRecipients(["member"]);
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get("member")!.id));
    const observation = new Date(from);
    observation.setUTCDate(observation.getUTCDate() - days);
    const expiry = new Date(observation);
    expiry.setUTCDate(expiry.getUTCDate() + 3);
    const id = randomUUID();
    try {
      await db.insert(providerFxQuotes).values({ id, fromCurrency: "XTS", toCurrency: "ZMW", rate: "20",
        provider: "yahoo_finance", quotedAt: observation, effectiveDate: observation.toISOString().slice(0, 10),
        validThrough: expiry.toISOString().slice(0, 10) });
      await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, categoryId: null,
        date: from, type: "expense", currency: "XTS", amount: "10.00", name: "Quote boundary expense" });
      const outcome = await sendWeeklyRecapEmail(actors.get("member")!.id, a, recipient.email, from, to);
      if (days === 3) {
        expect(outcome).toBe("sent");
        expect(smtp).toHaveBeenCalledOnce();
        expect(smtp.mock.calls[0][0].html).toMatch(/Spending<\/div>\s*<div class="metric-value">ZMW\s*200\.00<\/div>/);
      } else {
        // OPS-007 P2: a missing rate is the digest's own data, settled rather than retried every tick.
        expect(outcome).toBe("unbuildable");
        expect(smtp).not.toHaveBeenCalled();
      }
    } finally {
      await db.delete(providerFxQuotes).where(eq(providerFxQuotes.id, id));
    }
  });

  it("the real digest job selects each recipient and suppresses one revoked during projection", async () => {
    await enableRecipients(["owner", "member"]);
    const recipient = actors.get("member")!.id;
    const handoff = onRelease(async text => {
      await revokeMember();
      return text;
    }, recipient);
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 1, failed: 1, skipped: 0, unknown: 0 });
    expect(handoff).toHaveBeenCalledOnce();
    expect(smtp).toHaveBeenCalledTimes(1);
    const message = smtp.mock.calls[0][0];
    expect(message.to).toBe(await email("owner"));
    expect(message.html).toContain("OWNER_PRIVATE_BILL");
    expect(message.html).not.toContain("MEMBER_PRIVATE_BILL");
  });

  it("rechecks a cached completed projection immediately before the mail transport", async () => {
    await enableRecipients(["member"]);
    const recap = await weeklyRecapService.getRecap(a, actors.get("member")!.id, due, dueEnd);
    expect(recap.recurring.upcoming.map(bill => bill.id)).toContain(ruleIds.memberPrivate);
    const handoff = onRelease(async text => {
      await revokeMember();
      return text;
    });
    expect(await sendWeeklyRecapEmail(actors.get("member")!.id, a, await email("member"), from, to)).toBe("failed");
    expect(handoff).toHaveBeenCalledOnce();
    expect(smtp).not.toHaveBeenCalled();
  });

  it.each(["recap", "history"])("does not publish partial %s data after a protected PostgreSQL failure", async route => {
    const original = recurringService.getUpcomingBills.bind(recurringService);
    vi.spyOn(recurringService, "getUpcomingBills").mockImplementationOnce(async (...args) => {
      await db.execute(sql`select 1 / 0`);
      return original(...args);
    });
    const response = await signedRecap(route === "history" ? "/history" : undefined).expect(500);
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("MEMBER_PRIVATE");
  });

  it("the real digest job records a failed recurring read without sending a fake empty recap", async () => {
    await enableRecipients(["member"]);
    const failure = onRelease(async text => text.replace("END AS bills", "END AS bills, (1 / 0) AS forced_recurring_failure"));
    expect(await processWeeklyRecapEmails(mondayRun())).toEqual({ sent: 0, failed: 1, skipped: 0, unknown: 0 });
    expect(failure).toHaveBeenCalledOnce();
    expect(smtp).not.toHaveBeenCalled();
  });
});
