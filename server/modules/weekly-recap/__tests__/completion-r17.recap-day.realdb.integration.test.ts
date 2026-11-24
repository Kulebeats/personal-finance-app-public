import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, householdMembers, households, notificationDeliveries, userDisplaySettings, userNotificationPreferences, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { runWeeklyRecap } from "../../../core/scheduling/jobRunners";
import { SCHEDULED_JOBS } from "../../../core/scheduling/jobRegistry";
import { runScheduledJob, type JobRunDependencies, type JobSummary } from "../../../core/scheduling/scheduledJob";
import type { JobLease, JobLockRequest } from "../../../core/scheduling/advisoryLock";
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
const PAGO_PAGO = "Pacific/Pago_Pago"; // UTC-11, no DST: still the previous day at 09:00 UTC
const LAGOS = "Africa/Lagos"; // UTC+1, no DST
const MONDAY = 1, TUESDAY = 2, WEDNESDAY = 3, FRIDAY = 5;
// The week of Monday 23 November 2026, at the scheduler's 09:00 UTC tick.
const MONDAY_RUN = new Date("2026-11-23T09:00:00Z");
const TUESDAY_RUN = new Date("2026-11-24T09:00:00Z");
const WEDNESDAY_RUN = new Date("2026-11-25T09:00:00Z");
const FRIDAY_RUN = new Date("2026-11-27T09:00:00Z");
// Tuesday 14:00 in Lusaka, Wednesday 02:00 in Kiritimati.
const TUESDAY_NOON_UTC = new Date("2026-11-24T12:00:00Z");
const THURSDAY_RUN = new Date("2026-11-26T09:00:00Z");
// A late retry tick of Monday's period: already Tuesday 00:52 in Lagos.
const MONDAY_LATE_TICK = new Date("2026-11-23T23:52:00Z");
const RECAP_JOB = SCHEDULED_JOBS.find((job) => job.name === "recap.weekly")!;

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
async function runAt(instant: Date): Promise<JobSummary> {
  vi.setSystemTime(instant);
  return runWeeklyRecap({ identity: `recap.weekly@${instant.toISOString()}`, scheduledFor: instant });
}
async function ledgerStatus(recipient: Recipient): Promise<string | undefined> {
  const [row] = await db.select({ status: notificationDeliveries.status }).from(notificationDeliveries)
    .where(eq(notificationDeliveries.userId, actors.get(recipient)!.id));
  return row?.status;
}
const immediateLease: JobLease = { isLost: () => false, onRenewed: () => undefined };
/** The scheduler's own path, with the locks and journal stubbed: only the period instant matters here. */
const unjournaled: JobRunDependencies = {
  withLock: async <T,>(_request: JobLockRequest, work: (lease: JobLease) => Promise<T>) => ({ acquired: true as const, result: await work(immediateLease) }),
  hasCompletedPeriod: async () => false,
  startRun: async () => "r17-recap-run",
  renewRun: async () => undefined,
  finishRun: async () => undefined,
};
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
    await db.update(households).set({ aiConsentGiven: true, timeZone: LUSAKA, currency: "ZMW" }).where(eq(households.id, a));
    await db.update(households).set({ aiConsentGiven: true, timeZone: LUSAKA }).where(eq(households.id, b));
    await db.update(users).set({ emailVerified: true }).where(inArray(users.id, allActorIds()));
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

  // OPS-007 follow-up (P2 review of #377).
  it("retries a send SMTP definitely refused, later the same day", async () => {
    await enableRecap("owner", WEDNESDAY);
    smtp.mockResolvedValueOnce(false);

    expect((await runAt(WEDNESDAY_RUN)).failed).toBe(1);
    expect(await ledgerStatus("owner")).toBe("failed");
    await runAt(new Date("2026-11-25T09:20:00Z"));

    expect(await sendsTo("owner")).toBe(2);
    expect(await ledgerStatus("owner")).toBe("sent");
  });

  it("never resends when SMTP may have accepted the message", async () => {
    await enableRecap("owner", WEDNESDAY);
    // The real transport throws on an ambiguous reply only when asked to, and returns false otherwise.
    smtp.mockImplementationOnce(async (message) => {
      if (message.throwOnUnknownDelivery) throw new Error("SMTP acceptance could not be determined");
      return false;
    });

    await runAt(WEDNESDAY_RUN);
    await runAt(new Date("2026-11-25T09:20:00Z"));

    expect(await sendsTo("owner")).toBe(1);
    expect(await ledgerStatus("owner")).toBe("unknown");
  });

  it("counts an ambiguous SMTP reply as unknown, not as a failed run", async () => {
    await enableRecap("owner", WEDNESDAY);
    smtp.mockImplementationOnce(async (message) => {
      if (message.throwOnUnknownDelivery) throw new Error("SMTP acceptance could not be determined");
      return false;
    });

    const summary = await runAt(WEDNESDAY_RUN);

    expect(summary).toMatchObject({ sent: 0, failed: 0, unknown: 1 });
  });

  it("reports the run failed when Postgres refuses the egress audit row after SMTP accepted", async () => {
    await enableRecap("owner", WEDNESDAY);
    const ownerId = actors.get("owner")!.id;
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    // A real insert failure, not a mocked service: the audit row is refused by the database itself.
    await pool.query(`CREATE OR REPLACE FUNCTION r17_refuse_recap_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${ownerId}' AND NEW.details->>'exportType' = 'weekly_recap_email' THEN
          RAISE EXCEPTION 'synthetic audit outage';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query("CREATE TRIGGER r17_refuse_recap_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION r17_refuse_recap_audit()");
    try {
      expect(await runAt(WEDNESDAY_RUN)).toMatchObject({ sent: 1, failed: 1 });
      await runAt(new Date("2026-11-25T09:20:00Z"));
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS r17_refuse_recap_audit ON audit_logs");
      await pool.query("DROP FUNCTION IF EXISTS r17_refuse_recap_audit()");
    }

    expect(await sendsTo("owner")).toBe(1);
    expect(await ledgerStatus("owner")).toBe("sent");
  });

  it("does not rebuild a digest its data cannot make on every later tick that day", async () => {
    await enableRecap("owner", WEDNESDAY);
    await db.update(households).set({ currency: null }).where(eq(households.id, a));

    const first = await runAt(WEDNESDAY_RUN);
    const later = await runAt(new Date("2026-11-25T09:20:00Z"));

    expect(first.failed).toBe(1);
    expect(later.failed).toBe(0);
    expect(smtp).not.toHaveBeenCalled();
  });

  it("never resends after SMTP accepted it but the egress audit failed, and reports the run failed", async () => {
    await enableRecap("owner", WEDNESDAY);
    const audit = vi.spyOn(businessAuditService, "log").mockRejectedValueOnce(new Error("synthetic audit outage"));
    try {
      expect((await runAt(WEDNESDAY_RUN)).failed).toBe(1);
      await runAt(new Date("2026-11-25T09:20:00Z"));
    } finally { audit.mockRestore(); }

    expect(await sendsTo("owner")).toBe(1);
    expect(await ledgerStatus("owner")).toBe("sent");
  });

  it("writes the egress audit row for a scheduled send", async () => {
    await enableRecap("owner", WEDNESDAY);

    await runAt(WEDNESDAY_RUN);

    const rows = await db.select({ details: auditLogs.details }).from(auditLogs).where(and(
      eq(auditLogs.userId, actors.get("owner")!.id), eq(auditLogs.entityType, "data_export"),
    ));
    expect(rows).toEqual([{ details: expect.objectContaining({
      exportType: "weekly_recap_email", weekStart: "2026-11-18", weekEnd: "2026-11-24",
    }) }]);
  });

  it("sends on the new day when the user moves Friday to Wednesday before it, and not again on Friday", async () => {
    await enableRecap("owner", FRIDAY);
    await runAt(MONDAY_RUN);
    await patchWeeklyRecapSettings(actors.get("owner")!.id, { dayOfWeek: WEDNESDAY });

    await runAt(WEDNESDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);
    await runAt(FRIDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);
  });

  it("sends nothing more when the household's zone changes so the day comes round again", async () => {
    await enableRecap("owner", WEDNESDAY);
    await runAt(WEDNESDAY_RUN);
    expect(await sendsTo("owner")).toBe(1);

    await db.update(households).set({ timeZone: PAGO_PAGO }).where(eq(households.id, a));
    await runAt(THURSDAY_RUN); // Wednesday 22:00 in Pago Pago, the same household week

    expect(await sendsTo("owner")).toBe(1);
  });

  it("sends a household west of UTC-9 on its own local day, for its own week", async () => {
    await db.update(households).set({ timeZone: PAGO_PAGO }).where(eq(households.id, a));
    await enableRecap("owner", MONDAY);

    await runAt(MONDAY_RUN); // Sunday 22:00 in Pago Pago
    expect(await sendsTo("owner")).toBe(0);
    await runAt(TUESDAY_RUN); // Monday 22:00 in Pago Pago
    expect(await sendsTo("owner")).toBe(1);
    expect(smtp.mock.calls[0][0].subject).toContain("2026-11-16 to 2026-11-22");
  });

  it("judges a late retry tick by its scheduled period, not the wall clock", async () => {
    await db.update(households).set({ timeZone: LAGOS }).where(eq(households.id, a));
    await enableRecap("owner", MONDAY);
    await enableRecap("member", TUESDAY);
    vi.setSystemTime(MONDAY_LATE_TICK);

    const outcome = await runScheduledJob(RECAP_JOB, unjournaled, MONDAY_LATE_TICK);

    expect(outcome.status).toBe("completed");
    expect(await sendsTo("owner")).toBe(1);
    expect(await sendsTo("member")).toBe(0);
  });

  it("skips, not fails, a user with no household or an unverified address", async () => {
    await enableRecap("member");
    await enableRecap("admin");
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, actors.get("admin")!.id));

    const summary = await runAt(MONDAY_RUN);

    expect(summary).toMatchObject({ sent: 0, failed: 0, skipped: 2 });
    expect(smtp).not.toHaveBeenCalled();
  });
});
