/**
 * OPS-007: the scheduled recap e-mail, once per user and household week.
 *
 * The daily `recap.weekly` run sends to a user only when their household's
 * today is the day they chose (Monday when none is saved). Each send goes
 * through the R16.2 delivery ledger under one event per household
 * Monday-to-Sunday week, so a re-run, a retry or a day moved later in the
 * week sends nothing more once that week is sent. Only a send SMTP definitely
 * refused, or one withheld for consent, preference or an unverified address,
 * may be tried again by a later run. A send SMTP may have accepted is never
 * repeated, and neither is one accepted whose egress audit row failed. A
 * digest its own data cannot make (`unbuildable`) is not rebuilt that week:
 * it fails the run once and is settled in the ledger.
 *
 * @module modules/weekly-recap/recap-schedule
 */
import { deliverOnce, type ChannelResult } from "../../services/notification/delivery";
import { weekContaining, weekdayOf } from "./recap-week";

const LEDGER_WEEK_START_MONDAY = 1;
const RECAP_EVENT_PREFIX = "weekly_recap:week-of:";
const FAILED_REASON = "recap_failed";
const UNCONFIRMED_REASON = "smtp_unconfirmed";
const UNAUDITED_REASON = "audit_failed";
const UNBUILDABLE_REASON = "recap_unbuildable";

/** The outcomes of one recap send that are not a delivery; each may be taken again later. */
export type WithheldRecap = "skipped_no_consent" | "skipped_preference" | "skipped_unverified";
const WITHHELD: readonly WithheldRecap[] = ["skipped_no_consent", "skipped_preference", "skipped_unverified"];

/**
 * Outcome of attempting to send one weekly-recap digest.
 * `unknown`: SMTP may have accepted it. `sent_unaudited`: accepted, but the egress audit row failed.
 * `unbuildable`: the digest's own data cannot make it; nothing left the server and a retry would fail the same way.
 */
export type RecapSendOutcome = "sent" | "sent_unaudited" | "unknown" | "failed" | "unbuildable" | WithheldRecap;

/** What one user's scheduled send came to. `done`: this week was already settled. `unknown`: SMTP may have accepted it. */
export type ScheduledRecapResult = "sent" | "sent_unaudited" | "unknown" | "skipped" | "failed" | "done";

/** Whether the user's recap day is the household's `today` (YYYY-MM-DD). */
export function isRecapDay(today: string, dayOfWeek: number): boolean {
  return weekdayOf(today) === dayOfWeek;
}

/** One ledger event per household Monday-to-Sunday week, whatever day the user chose. */
export function recapWeekEventKey(today: string): string {
  return `${RECAP_EVENT_PREFIX}${weekContaining(today, LEDGER_WEEK_START_MONDAY).from}`;
}

function channelResult(outcome: RecapSendOutcome): ChannelResult {
  if (outcome === "sent") return { status: "sent" };
  if (outcome === "sent_unaudited") return { status: "sent", reason: UNAUDITED_REASON };
  if (outcome === "unknown") return { status: "unknown", reason: UNCONFIRMED_REASON };
  if (outcome === "failed") return { status: "failed", reason: FAILED_REASON };
  // Settled, never retried: not one of the withheld reasons a later run may take again.
  if (outcome === "unbuildable") return { status: "suppressed", reason: UNBUILDABLE_REASON };
  return { status: "suppressed", reason: outcome };
}

/** Send at most one recap to this user in the household week that contains `today`. */
export async function deliverWeeklyRecapOnce(
  userId: string,
  today: string,
  send: () => Promise<RecapSendOutcome>,
): Promise<ScheduledRecapResult> {
  let sendOutcome: RecapSendOutcome | undefined;
  const outcome = await deliverOnce(userId, recapWeekEventKey(today), "email", async () => {
    sendOutcome = await send();
    return channelResult(sendOutcome);
  }, { retrySuppressed: WITHHELD });
  if (!outcome.attempted) return "done";
  if (sendOutcome === "sent_unaudited") return "sent_unaudited";
  if (sendOutcome === "unbuildable") return "failed";
  if (outcome.status === "sent") return "sent";
  if (outcome.status === "suppressed") return "skipped";
  // Not a failure of the run: SMTP may have accepted it, and the ledger never repeats it.
  if (outcome.status === "unknown") return "unknown";
  return "failed";
}
