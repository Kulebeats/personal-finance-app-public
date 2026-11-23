/**
 * OPS-007: the scheduled recap e-mail, once per user and household week.
 *
 * The daily `recap.weekly` run sends to a user only when their household's
 * today is the day they chose (Monday when none is saved). Each send goes
 * through the R16.2 delivery ledger under one event per household
 * Monday-to-Sunday week, so a re-run, a retry or a day moved later in the
 * week sends nothing more once that week is sent. A failed send, or one
 * withheld for consent or preference, may be tried again by a later run.
 *
 * @module modules/weekly-recap/recap-schedule
 */
import { deliverOnce, type ChannelResult } from "../../services/notification/delivery";
import { weekContaining, weekdayOf } from "./recap-week";

const LEDGER_WEEK_START_MONDAY = 1;
const RECAP_EVENT_PREFIX = "weekly_recap:week-of:";
const FAILED_REASON = "recap_failed";

/** What one user's scheduled send came to. `done`: this week was already settled. */
export type ScheduledRecapResult = "sent" | "skipped" | "failed" | "done";

/** The outcomes of one recap send that are not a delivery. */
export type WithheldRecap = "skipped_no_consent" | "skipped_preference";
const WITHHELD: readonly WithheldRecap[] = ["skipped_no_consent", "skipped_preference"];

/** Whether the user's recap day is the household's `today` (YYYY-MM-DD). */
export function isRecapDay(today: string, dayOfWeek: number): boolean {
  return weekdayOf(today) === dayOfWeek;
}

/** One ledger event per household Monday-to-Sunday week, whatever day the user chose. */
export function recapWeekEventKey(today: string): string {
  return `${RECAP_EVENT_PREFIX}${weekContaining(today, LEDGER_WEEK_START_MONDAY).from}`;
}

function channelResult(outcome: "sent" | "failed" | WithheldRecap): ChannelResult {
  if (outcome === "sent") return { status: "sent" };
  if (outcome === "failed") return { status: "failed", reason: FAILED_REASON };
  return { status: "suppressed", reason: outcome };
}

/** Send at most one recap to this user in the household week that contains `today`. */
export async function deliverWeeklyRecapOnce(
  userId: string,
  today: string,
  send: () => Promise<"sent" | "failed" | WithheldRecap>,
): Promise<ScheduledRecapResult> {
  const outcome = await deliverOnce(userId, recapWeekEventKey(today), "email",
    async () => channelResult(await send()), { retrySuppressed: WITHHELD });
  if (!outcome.attempted) return "done";
  if (outcome.status === "sent") return "sent";
  if (outcome.status === "suppressed") return "skipped";
  return "failed";
}
