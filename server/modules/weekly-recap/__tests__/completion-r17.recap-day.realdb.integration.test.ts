import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { households, notificationDeliveries, userDisplaySettings, userNotificationPreferences, users } from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { runWeeklyRecap } from "../../../core/scheduling/jobRunners";
import { getWeeklyRecapSettings, patchWeeklyRecapSettings } from "../../../repositories/UserDisplayPreferences";
import { a, actors, b, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

/**
 * OPS-007: the recap e-mail goes out on the day each user chose, judged in
 * their household's time zone, once per household week. With no saved day it
 * stays on Monday. The scheduler's own job runner is called at fixed instants;
 * settings, consent and the digest are real Postgres, and only SMTP is a stub.
 */
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);

const LUSAKA = "Africa/Lusaka"; // UTC+2
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14: already the next day for most of the UTC day
const MONDAY = 1, WEDNESDAY = 3, FRIDAY = 5;
// The week of Monday 23 November 2026, at the scheduler's 09:00 UTC tick.
const MONDAY_RUN = new Date("2026-11-23T09:00:00Z");
const TUESDAY_RUN = new Date("2026-11-24T09:00:00Z");
const WEDNESDAY_RUN = new Date("2026-11-25T09:00:00Z");
const FRIDAY_RUN = new Date("2026-11-27T09:00:00Z");
// Tuesday 14:00 in Lusaka, Wednesday 02:00 in Kiritimati.
const TUESDAY_NOON_UTC = new Date("2026-11-24T12:00:00Z");

type Recipient = Role | "outsider";
const allActorIds = () => Array.from(actors.values(), (actor) => actor.id);

async function emailOf(recipient: Recipient): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get(recipient)!.id));
  return row.email;
}
async function sendsTo(recipient: Recipient): Promise<number> {
  const to = await emailOf(recipient);
  return smtp.mock.calls.filter(([message]) => message.to === to).length;
}
/** Recap e-mail on, through the settings writer; `day` omitted leaves no saved day. */
async function enableRecap(recipient: Recipient, day?: number): Promise<void> {
  await patchWeeklyRecapSettings(actors.get(recipient)!.id, day === undefined ? { emailEnabled: true } : { emailEnabled: true, dayOfWeek: day });
}
async function runAt(instant: Date): Promise<void> {
  vi.setSystemTime(instant);
  await runWeeklyRecap();
}
async function clearRecapRows(): Promise<void> {
  if (!actors.size) return;
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, allActorIds()));
  await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, allActorIds()));
  await db.delete(userDisplaySettings).where(inArray(userDisplaySettings.userId, allActorIds()));
}

describe("OPS-007: each user's recap goes out on their chosen day, in household time", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearRecapRows();
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true, timeZone: LUSAKA }).where(eq(households.id, a));
    await db.update(households).set({ aiConsentGiven: true, timeZone: LUSAKA }).where(eq(households.id, b));
    vi.useFakeTimers({ toFake: ["Date"], now: MONDAY_RUN });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await clearRecapRows(); await stop(); });

  it("sends a Wednesday user nothing on Monday's run and one recap on Wednesday's", async () => {
    await enableRecap("owner", WEDNESDAY);

    await runAt(MONDAY_RUN);
    expect(await sendsTo("owner")).toBe(0);

    await runAt(WEDNESDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);
  });

  it("sends nothing more when the job runs again on the same day", async () => {
    await enableRecap("owner", WEDNESDAY);

    await runAt(WEDNESDAY_RUN);
    await runAt(new Date("2026-11-25T09:20:00Z"));

    expect(await sendsTo("owner")).toBe(1);
  });

  it("judges the day in the household's time zone, where it may already be the next day", async () => {
    await db.update(households).set({ timeZone: KIRITIMATI }).where(eq(households.id, b));
    await enableRecap("owner", WEDNESDAY); // Lusaka: still Tuesday
    await enableRecap("outsider", WEDNESDAY); // Kiritimati: already Wednesday

    await runAt(TUESDAY_NOON_UTC);

    expect(await sendsTo("outsider")).toBe(1);
    expect(await sendsTo("owner")).toBe(0);
  });

  it("still applies the consent gate on the user's day, and sends once consent is given", async () => {
    await db.update(households).set({ aiConsentGiven: false }).where(eq(households.id, a));
    await enableRecap("owner", WEDNESDAY);

    await runAt(WEDNESDAY_RUN);
    expect(await sendsTo("owner")).toBe(0);

    await db.update(households).set({ aiConsentGiven: true }).where(eq(households.id, a));
    await runAt(new Date("2026-11-25T09:20:00Z"));
    expect(await sendsTo("owner")).toBe(1);
  });

  it("keeps Monday as the day when none is saved, and the settings say so", async () => {
    await enableRecap("owner");
    expect((await getWeeklyRecapSettings(actors.get("owner")!.id)).dayOfWeek).toBe(MONDAY);

    await runAt(MONDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);

    await runAt(TUESDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);
  });

  it("sends nothing more that week when the user moves the day later in the week", async () => {
    await enableRecap("owner", WEDNESDAY);
    await runAt(WEDNESDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);

    await patchWeeklyRecapSettings(actors.get("owner")!.id, { dayOfWeek: FRIDAY });
    await runAt(FRIDAY_RUN);

    expect(await sendsTo("owner")).toBe(1);
  });
});
