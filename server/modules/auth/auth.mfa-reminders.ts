/**
 * AH-11 slice 2: e-mail each member who still has no MFA when 7 days and when
 * 1 day of the grace are left. The scheduled job security.mfa-reminders
 * (jobCatalog.ts) runs this daily under its lock and journal; there is no cron door.
 *
 * Each reminder goes through the delivery ledger (notification/delivery.ts),
 * keyed by stage and deadline, so a re-run, a recovery tick or a second
 * instance sends it once. Only a definite transport rejection is retried; a
 * lost acknowledgement is never resent. A member who missed the 7-day reminder
 * gets only the 1-day one. Each member is re-read just before sending, so one
 * who enrolled or was erased mid-run is not e-mailed and a changed address is
 * used. Every send that may have been delivered writes a security audit row.
 * The e-mail carries no financial data.
 */
import { and, eq, gt, isNull, lte, notLike, sql, type SQL } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../../db";
import type { JobSummary } from "../../core/scheduling/jobJournal";
import { AuditEventType, auditService } from "../../services/AuditService";
import { sendEmail } from "../../services/emailService";
import { deliverOnce, type ChannelResult, type DeliveryOutcome } from "../../services/notification/delivery";
import { buildEmailHtml } from "../../services/notification/email";
import { logger } from "../../utils/logger";

const DAY_MS = 86_400_000;
/** Days of grace left at which a reminder is due, most urgent first. */
const REMINDER_STAGES = [1, 7] as const;
export type MfaReminderStage = (typeof REMINDER_STAGES)[number];
const FIRST_REMINDER_DAYS = 7;
const DEADLINE_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });

interface DueMember {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly graceEndsAt: Date;
}

/** The reminder due for a deadline, or null when none is (more than 7 days left, or the grace is over). */
export function reminderStageFor(graceEndsAt: Date, now: Date): MfaReminderStage | null {
  const left = graceEndsAt.getTime() - now.getTime();
  if (!(left > 0)) return null;
  return REMINDER_STAGES.find((days) => left <= days * DAY_MS) ?? null;
}

/** One ledger key per stage and deadline: a changed deadline gets its own reminders. */
export function mfaReminderEventKey(stage: MfaReminderStage, graceEndsAt: Date): string {
  return `mfa_grace_reminder:${stage}d:${graceEndsAt.toISOString()}`;
}

const DUE_COLUMNS = {
  id: users.id, email: users.email, fullName: users.fullName, username: users.username, graceEndsAt: users.mfaGraceEndsAt,
};

/** Still owes MFA and can be e-mailed. NULL mfa_enabled counts as off, as the grace gate treats it. */
function owesMfa(now: Date): SQL | undefined {
  return and(
    sql`${users.mfaEnabled} is not true`, eq(users.emailVerified, true), isNull(users.erasedAt),
    notLike(users.passwordHash, "!erased!%"), gt(users.mfaGraceEndsAt, now),
  );
}

type DueRow = { id: string; email: string; fullName: string | null; username: string; graceEndsAt: Date };
const toMember = (row: DueRow): DueMember =>
  ({ id: row.id, email: row.email, name: row.fullName || row.username, graceEndsAt: row.graceEndsAt });

async function findDueMembers(now: Date): Promise<DueMember[]> {
  const lastDeadline = new Date(now.getTime() + FIRST_REMINDER_DAYS * DAY_MS);
  const rows = await db.select(DUE_COLUMNS).from(users)
    .where(and(owesMfa(now), lte(users.mfaGraceEndsAt, lastDeadline))).orderBy(users.mfaGraceEndsAt);
  return rows.map(toMember);
}

/** The member as they are now, or null when they no longer owe MFA or the deadline moved. */
async function rereadMember(member: DueMember, now: Date): Promise<DueMember | null> {
  const [row] = await db.select(DUE_COLUMNS).from(users)
    .where(and(eq(users.id, member.id), owesMfa(now), eq(users.mfaGraceEndsAt, member.graceEndsAt))).limit(1);
  return row ? toMember(row) : null;
}

async function sendReminder(due: DueMember, now: Date): Promise<ChannelResult> {
  const member = await rereadMember(due, now);
  if (!member) return { status: "suppressed", reason: "no_longer_due" };
  const daysLeft = Math.ceil((member.graceEndsAt.getTime() - now.getTime()) / DAY_MS);
  const title = `Turn on two-step verification: ${daysLeft === 1 ? "1 day" : `${daysLeft} days`} left`;
  const deadline = `${DEADLINE_FORMAT.format(member.graceEndsAt)} UTC`;
  const body = `Hi ${member.name}, every member now needs two-step verification. Turn it on by ${deadline}. ` +
    "After that, you will be asked to set it up before you can continue.";
  const actionUrl = `${process.env.APP_URL || "http://localhost:5000"}/settings/security`;
  const accepted = await sendEmail({
    to: member.email,
    subject: title,
    html: buildEmailHtml(title, body, actionUrl, { buttonLabel: "Set it up now", showPreferencesFooter: false }),
    text: `${title}\n\n${body}\n\nSet it up: ${actionUrl}`,
    throwOnUnknownDelivery: true,
  });
  return accepted ? { status: "sent" } : { status: "failed", reason: "transport_not_accepted" };
}

async function remind(member: DueMember, stage: MfaReminderStage, now: Date): Promise<DeliveryOutcome> {
  const outcome = await deliverOnce(member.id, mfaReminderEventKey(stage, member.graceEndsAt), "email",
    () => sendReminder(member, now));
  if (outcome.attempted && (outcome.status === "sent" || outcome.status === "unknown")) {
    await auditService.log({
      eventType: AuditEventType.MFA_GRACE_REMINDER_SENT, userId: member.id,
      details: { stage, delivery: outcome.status, graceEndsAt: member.graceEndsAt.toISOString() },
    });
  }
  return outcome;
}

/** Send every due reminder. `failed` counts definite rejections, which the next run retries. */
export async function sendMfaGraceReminders(now: Date = new Date()): Promise<JobSummary> {
  const due = await findDueMembers(now);
  let sent = 0, failed = 0, unknown = 0, skipped = 0;
  for (const member of due) {
    const stage = reminderStageFor(member.graceEndsAt, now);
    if (!stage) { skipped++; continue; }
    try {
      const outcome = await remind(member, stage, now);
      if (!outcome.attempted) skipped++;
      else if (outcome.status === "sent") sent++;
      else if (outcome.status === "failed") failed++;
      else unknown++;
    } catch (error) {
      failed++;
      logger.error("MFA grace reminder failed", { job: "security.mfa-reminders", userId: member.id, stage, error });
    }
  }
  return { sent, failed, unknown, skipped };
}
