import { db } from "../db";
import { goals } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { notificationService, type NotifyData } from "../services/NotificationService";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { logger } from "../utils/logger";
import { goalsVisibleToMemberNow, notifiableMembers } from "../services/notification/audience";
import { hasRetryableChannelFailure, type ChannelResult } from "../services/notification/delivery";
import type { HouseholdContext } from "../middleware/householdGuard";
import type { TransactionType } from "../utils/withTransaction";

type GoalRow = typeof goals.$inferSelect;
type GoalNotice = Pick<NotifyData, "title" | "body" | "actionUrl" | "metadata"> & { dedupeKey: string };
/** Deliveries and member failures of one publish, so a scheduled run can journal a partial failure (A-21). */
type PublishTotals = { readonly sent: number; readonly failed: number };
const NOTHING: PublishTotals = { sent: 0, failed: 0 };
const addTotals = (a: PublishTotals, b: PublishTotals): PublishTotals => ({ sent: a.sent + b.sent, failed: a.failed + b.failed });

const DAY_MS = 1000 * 60 * 60 * 24;
const NOT_VISIBLE: ChannelResult = { status: "suppressed", reason: "not_visible" };
const CONTENT_CHANGED: ChannelResult = { status: "suppressed", reason: "content_changed" };

/** The goals a weekly check-in counts. */
const WEEKLY_GOALS = eq(goals.isArchived, false);
/** The goals a deadline reminder can be about. */
const DEADLINE_GOALS = and(
  eq(goals.isArchived, false), eq(goals.isCompleted, false), eq(goals.type, "save_up"), isNotNull(goals.targetDate),
)!;

const isOnTrack = (goal: GoalRow) => goal.status === "on_track" || goal.status === "completed";

/**
 * One member's check-in, counted over the goals whose progress that member
 * can see: a status follows progress, so a hidden goal is not counted (goals QA F4).
 */
function weeklyCheckIn(seen: GoalRow[], weekKey: string): GoalNotice {
  const saveUp = seen.filter((goal) => goal.type === "save_up");
  const payDown = seen.filter((goal) => goal.type === "pay_down");
  const saveUpOnTrack = saveUp.filter(isOnTrack).length;
  const payDownOnTrack = payDown.filter(isOnTrack).length;
  return {
    title: "Weekly goals check-in",
    body: `Save Up: ${saveUpOnTrack}/${saveUp.length} on track. Pay Down: ${payDownOnTrack}/${payDown.length} on track.`,
    actionUrl: "/goals",
    metadata: {
      reportType: "weekly",
      saveUpTotal: saveUp.length,
      saveUpOnTrack,
      payDownTotal: payDown.length,
      payDownOnTrack,
      weekKey,
    },
    dedupeKey: `goals:weekly:${weekKey}`,
  };
}

/**
 * Publishes one notice to one member, built from the goal rows and the member's
 * verdict read in one statement. The same build runs again before each channel
 * (in-app, email, every push device): a member who left or lost sight of a goal,
 * or a goal whose status, name or date changed, gets nothing more (#245, Astra
 * round 3 and its pre-check). For the in-app row the build runs in the row's
 * transaction and locks what it reads (round 4).
 *
 * One member's failure (a lock conflict, say) is logged and skips that member;
 * the rest of the household is still told.
 */
async function publishToMember(
  member: HouseholdContext, build: (tx?: TransactionType) => Promise<GoalNotice | undefined>, assertWindow?: () => void,
): Promise<PublishTotals> {
  try {
    assertWindow?.();
    const notice = await build();
    if (!notice) return NOTHING;
    assertWindow?.();
    const dispatchHold = async (tx?: TransactionType): Promise<ChannelResult | null> => {
      assertWindow?.();
      const again = await build(tx);
      assertWindow?.();
      if (!again) return NOT_VISIBLE;
      return again.body === notice.body ? null : CONTENT_CHANGED;
    };
    const outcome = await notificationService.notifyDetailed(
      member.userId, member.householdId, NOTIFICATION_TYPES.GOAL_PROGRESS, {
        ...notice, dedupeKey: `${notice.dedupeKey}:user:${member.userId}`, dispatchHold, scheduledRecovery: true,
        assertScheduledWindow: assertWindow,
      },
    );
    return { sent: outcome.delivered ? 1 : 0, failed: hasRetryableChannelFailure(outcome.channels) ? 1 : 0 };
  } catch (error) {
    logger.error("Goal notice not sent to a member", {
      householdId: member.householdId, userId: member.userId, error,
    });
    return { sent: 0, failed: 1 };
  }
}

function groupByHousehold(rows: readonly GoalRow[]): Map<string, GoalRow[]> {
  const grouped = new Map<string, GoalRow[]>();
  for (const goal of rows) {
    const list = grouped.get(goal.householdId) ?? [];
    list.push(goal);
    grouped.set(goal.householdId, list);
  }
  return grouped;
}

async function withNoticeMembers(
  householdId: string, publish: (members: readonly HouseholdContext[]) => Promise<PublishTotals>,
): Promise<PublishTotals> {
  try {
    return await publish(await notifiableMembers(householdId));
  } catch (error) {
    logger.error("Could not process scheduled goal notices for household", { householdId, error });
    return { sent: 0, failed: 1 };
  }
}

async function sendWeeklyCheckIns(
  members: readonly HouseholdContext[], householdGoals: GoalRow[], weekKey: string, assertWindow?: () => void,
): Promise<PublishTotals> {
  const goalIds = householdGoals.map((goal) => goal.id);
  let totals = NOTHING;
  for (const member of members) {
    totals = addTotals(totals, await publishToMember(member, async (tx) => {
      const seen = await goalsVisibleToMemberNow(member, goalIds, WEEKLY_GOALS, tx);
      return seen.length ? weeklyCheckIn(seen, weekKey) : undefined;
    }, assertWindow));
  }
  return totals;
}

function getIsoWeekKey(date: Date) {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export async function runWeeklyGoalReport(now: Date = new Date(), assertWindow?: () => void) {
  const activeGoals = await db
    .select()
    .from(goals)
    .where(WEEKLY_GOALS);
  assertWindow?.();

  const goalsByHousehold = groupByHousehold(activeGoals);
  const weekKey = getIsoWeekKey(now);
  let totals = NOTHING;

  for (const [householdId, householdGoals] of goalsByHousehold.entries()) {
    totals = addTotals(totals, await withNoticeMembers(householdId,
      members => sendWeeklyCheckIns(members, householdGoals, weekKey, assertWindow)));
  }

  logger.info("Weekly goal report sent", {
    job: "goal-weekly-report", outcome: totals.failed ? "failure" : "success",
    households: goalsByHousehold.size,
    notificationsSent: totals.sent,
    failed: totals.failed,
    weekKey,
  });

  return { households: goalsByHousehold.size, notificationsSent: totals.sent, failed: totals.failed, weekKey };
}

/** The reminder for a goal due within the window, from that goal's row; none outside it. */
function deadlineReminder(goal: GoalRow, todayStart: Date, reminderDays: number): GoalNotice | undefined {
  if (!goal.targetDate) return undefined;
  const daysAway = Math.ceil((new Date(goal.targetDate).getTime() - todayStart.getTime()) / DAY_MS);
  if (daysAway <= 0 || daysAway > reminderDays) return undefined;
  return {
    title: "Goal deadline approaching",
    body: `${goal.name} is due in ${daysAway} day${daysAway === 1 ? "" : "s"}.`,
    actionUrl: `/goals/${goal.id}`,
    metadata: { goalId: goal.id, daysAway, targetDate: goal.targetDate },
    dedupeKey: `goal:${goal.id}:deadline:${goal.targetDate}`,
  };
}

/**
 * Only an open goal is reminded of, and whether it is open follows its progress,
 * so only the members who can see that progress hear (goals QA F4).
 */
async function sendDeadlineReminders(
  members: readonly HouseholdContext[], householdGoals: GoalRow[], todayStart: Date, reminderDays: number, assertWindow?: () => void,
): Promise<PublishTotals> {
  let totals = NOTHING;
  for (const goal of householdGoals) {
    for (const member of members) {
      totals = addTotals(totals, await publishToMember(member, async (tx) => {
        const [current] = await goalsVisibleToMemberNow(member, [goal.id], DEADLINE_GOALS, tx);
        return current && deadlineReminder(current, todayStart, reminderDays);
      }, assertWindow));
    }
  }
  return totals;
}

export async function runGoalDeadlineReminders(today: Date = new Date(), assertWindow?: () => void) {
  const reminderDaysRaw = Number(
    process.env.GOAL_DEADLINE_REMINDER_DAYS ?? 7
  );
  const reminderDays = Number.isFinite(reminderDaysRaw)
    ? reminderDaysRaw
    : 7;

  const candidates = await db.select().from(goals).where(DEADLINE_GOALS);
  assertWindow?.();

  const todayStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );

  let totals = NOTHING;

  const dueByHousehold = groupByHousehold(candidates.filter(goal => deadlineReminder(goal, todayStart, reminderDays)));
  for (const [householdId, householdGoals] of dueByHousehold) {
    totals = addTotals(totals, await withNoticeMembers(householdId,
      members => sendDeadlineReminders(members, householdGoals, todayStart, reminderDays, assertWindow)));
  }

  logger.info("Goal deadline reminders sent", {
    job: "goal-deadline-reminder", outcome: totals.failed ? "failure" : "success",
    remindersSent: totals.sent,
    failed: totals.failed,
    reminderDays,
  });

  return { remindersSent: totals.sent, failed: totals.failed, reminderDays };
}
