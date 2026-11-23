import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { households, recurringTransactions, userDisplaySettings, userNotificationPreferences, users } from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { processWeeklyRecapEmails, sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

/**
 * R16.3 (OPS-007, NEW-31): the saved recap toggles govern what a recap holds,
 * every recap window is exactly seven dates of the household's own calendar,
 * and feedback is a structured, replay-safe row. Signed HTTP, the settings,
 * the recap reads and the digest are real; only SMTP is a stub, and only
 * `Date` is moved so a household far from UTC sits on another calendar day.
 */
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);

const UTC_PLUS_14 = "Pacific/Kiritimati"; // No daylight saving: always UTC+14.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const billId = randomUUID();
const BILL = "R16_TOGGLE_BILL";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
const utcToday = () => new Date().toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const owner = () => actors.get("owner")!;
const signed = (path: string) => request(app).get(`/api/weekly-recap${path}`).set("Cookie", owner().cookie);
const patchSettings = (data: object) => request(app).patch("/api/weekly-recap/settings").set("Cookie", owner().cookie).send(data);
const postFeedback = (data: object) => request(app).post("/api/weekly-recap/feedback").set("Cookie", owner().cookie).send(data);
async function ownerEmail() {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, owner().id));
  return row.email;
}
async function setFirstDay(day: string) {
  await db.insert(userDisplaySettings).values({ userId: owner().id, firstDayOfWeek: day })
    .onConflictDoUpdate({ target: userDisplaySettings.userId, set: { firstDayOfWeek: day } });
}
async function feedbackRows() {
  const result = await db.execute<{ id: string; household_id: string; week_start: string; week_end: string; step: string; choice: string; comment: string | null }>(sql`
    SELECT id, household_id, week_start::text, week_end::text, step, choice, comment
    FROM weekly_recap_feedback WHERE user_id = ${owner().id} ORDER BY step`);
  return result.rows;
}
/** An instant late on a UTC day, which is already the next day at UTC+14. */
function lateUtc(date: string) {
  return { instant: new Date(`${date}T23:30:00Z`), local: addDays(date, 1) };
}
/**
 * The same for a signed request: from 11:00 UTC on, UTC+14 is on the next
 * date. Never more than 11 hours ahead, inside the 24-hour login session.
 */
function signedNextDayInstant() {
  const now = new Date();
  const instant = now.getUTCHours() >= 11 ? now : new Date(`${utcToday()}T11:00:00Z`);
  return { instant, local: addDays(instant.toISOString().slice(0, 10), 1) };
}

describe("R16.3 weekly recap content, calendar and feedback", () => {
  beforeAll(async () => {
    await start();
    await db.insert(userNotificationPreferences).values({ userId: owner().id, notificationType: "weekly_recap", emailEnabled: true });
  }, 20_000);
  beforeEach(async () => {
    // The bill references a fixture account, so it goes before the accounts do.
    await db.delete(recurringTransactions).where(eq(recurringTransactions.id, billId));
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true, timeZone: null }).where(eq(households.id, a));
    await db.insert(recurringTransactions).values({ id: billId, householdId: a, accountId: ids.sharedAccount, name: BILL,
      amount: "42.00", type: "expense", frequency: "monthly", startDate: utcToday(), nextDueDate: addDays(utcToday(), 1) });
    await patchSettings({ includeGoals: true, includeRecurring: true }).expect(200);
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [billId]));
    await stop();
  });

  it("governs the in-app recap by the saved goals and upcoming-bills toggles", async () => {
    const week = `?weekStart=${utcToday()}&weekEnd=${addDays(utcToday(), 6)}`;
    await patchSettings({ includeGoals: false, includeRecurring: false }).expect(200);

    const excluded = await signed(week).expect(200);

    expect(excluded.body.data.sections).toEqual({ goals: false, recurring: false });
    expect(excluded.body.data.recurring.upcoming).toEqual([]);
    expect(JSON.stringify(excluded.body)).not.toContain(BILL);

    await patchSettings({ includeRecurring: true }).expect(200);
    const included = await signed(week).expect(200);
    expect(included.body.data.sections).toEqual({ goals: false, recurring: true });
    expect(included.body.data.recurring.upcoming.map((bill: { name: string }) => bill.name)).toContain(BILL);
  });

  it("leaves upcoming bills out of the emailed digest when the user excluded them", async () => {
    const from = utcToday(), to = addDays(from, 6), email = await ownerEmail();
    await patchSettings({ includeRecurring: false }).expect(200);
    expect(await sendWeeklyRecapEmail(owner().id, a, email, from, to)).toBe("sent");
    expect(smtp.mock.calls[0][0].html).not.toContain(BILL);

    await patchSettings({ includeRecurring: true }).expect(200);
    expect(await sendWeeklyRecapEmail(owner().id, a, email, from, to)).toBe("sent");
    expect(smtp.mock.calls[1][0].html).toContain(BILL);
  });

  it.each([
    ["an eight-date window", `?weekStart=2026-11-08&weekEnd=2026-11-15`],
    ["a reversed window", `?weekStart=2026-11-14&weekEnd=2026-11-08`],
    ["a start without an end", `?weekStart=2026-11-08`],
    ["a date that does not exist", `?weekStart=2026-02-24&weekEnd=2026-02-30`],
  ])("refuses %s instead of reporting a recap for it", async (_name, query) => {
    const response = await signed(query);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("starts the current week on the user's first day in the household's time zone", async () => {
    const { instant, local } = signedNextDayInstant();
    await db.update(households).set({ timeZone: UTC_PLUS_14 }).where(eq(households.id, a));
    await setFirstDay(WEEKDAYS[weekday(local)]);
    vi.useFakeTimers({ toFake: ["Date"], now: instant });

    const response = await signed("").expect(200);

    expect(response.body.data).toMatchObject({ weekStart: local, weekEnd: addDays(local, 6) });
  });

  it("lists eight consecutive seven-date weeks of the household calendar, newest first", async () => {
    const { instant, local } = signedNextDayInstant();
    await db.update(households).set({ timeZone: UTC_PLUS_14 }).where(eq(households.id, a));
    await setFirstDay(WEEKDAYS[weekday(local)]);
    vi.useFakeTimers({ toFake: ["Date"], now: instant });

    const response = await signed("/history").expect(200);

    const weeks = response.body.data.history.map((item: { weekStart: string; weekEnd: string }) => [item.weekStart, item.weekEnd]);
    expect(weeks).toEqual(Array.from({ length: 8 }, (_, index) => [addDays(local, -7 * index), addDays(local, 6 - 7 * index)]));
  });

  it("emails the household's last complete Monday-to-Sunday week by its own calendar", async () => {
    let sunday = addDays(utcToday(), 1);
    while (weekday(sunday) !== 0) sunday = addDays(sunday, 1);
    const { instant, local: monday } = lateUtc(sunday);
    await db.update(households).set({ timeZone: UTC_PLUS_14 }).where(eq(households.id, a));
    vi.useFakeTimers({ toFake: ["Date"], now: instant });

    await processWeeklyRecapEmails();

    const email = await ownerEmail();
    const subjects = smtp.mock.calls.map(([message]) => message).filter(message => message.to === email).map(message => message.subject);
    expect(subjects).toEqual([expect.stringContaining(`(${addDays(monday, -7)} to ${addDays(monday, -1)})`)]);
  });

  it("stores feedback as one structured row per user, household, week and step, safely replayed", async () => {
    const logs = ["log", "info", "warn", "error"].map(method => vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const weekStart = "2026-11-09", weekEnd = "2026-11-15";
    const first = { weekStart, weekEnd, step: "spending", feedback: "negative", comment: "PRIVATE_COMMENT_SENTINEL too slow" };

    const created = await postFeedback(first).expect(200);
    await postFeedback(first).expect(200);
    const [stored] = await feedbackRows();
    expect(await feedbackRows()).toEqual([{ id: stored.id, household_id: a, week_start: weekStart, week_end: weekEnd,
      step: "spending", choice: "negative", comment: "PRIVATE_COMMENT_SENTINEL too slow" }]);
    expect(created.body.data).toMatchObject({ recorded: true, id: stored.id });

    await postFeedback({ ...first, feedback: "positive", comment: undefined }).expect(200);
    await postFeedback({ weekStart, weekEnd, step: "goals", feedback: "positive" }).expect(200);
    expect(await feedbackRows()).toEqual([
      expect.objectContaining({ step: "goals", choice: "positive", comment: null }),
      expect.objectContaining({ id: stored.id, step: "spending", choice: "positive", comment: null }),
    ]);

    await postFeedback({ ...first, weekEnd: "2026-11-16" }).expect(400);
    await postFeedback({ ...first, comment: "x".repeat(501) }).expect(400);
    expect(await feedbackRows()).toHaveLength(2);
    expect(JSON.stringify(logs.flatMap(spy => spy.mock.calls))).not.toContain("PRIVATE_COMMENT_SENTINEL");
  });
});
