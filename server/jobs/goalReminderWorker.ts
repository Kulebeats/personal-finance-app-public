import { db } from "../db";
import { goals } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { notificationService } from "../services/NotificationService";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { logger } from "../utils/logger";

function getIsoWeekKey(date: Date) {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export async function runWeeklyGoalReport() {
  const activeGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.isArchived, false));

  const goalsByHousehold = new Map<string, typeof activeGoals>();
  for (const goal of activeGoals) {
    const list = goalsByHousehold.get(goal.householdId) ?? [];
    list.push(goal);
    goalsByHousehold.set(goal.householdId, list);
  }

  const weekKey = getIsoWeekKey(new Date());
  let householdCount = 0;
  let notificationsSent = 0;

  for (const [householdId, householdGoals] of goalsByHousehold.entries()) {
    if (householdGoals.length === 0) continue;

    householdCount += 1;
    const saveUp = householdGoals.filter((goal) => goal.type === "save_up");
    const payDown = householdGoals.filter((goal) => goal.type === "pay_down");

    const saveUpOnTrack = saveUp.filter(
      (goal) => goal.status === "on_track" || goal.status === "completed"
    ).length;
    const payDownOnTrack = payDown.filter(
      (goal) => goal.status === "on_track" || goal.status === "completed"
    ).length;

    const title = "Weekly goals check-in";
    const body = `Save Up: ${saveUpOnTrack}/${saveUp.length} on track. Pay Down: ${payDownOnTrack}/${payDown.length} on track.`;

    const count = await notificationService.notifyHousehold(
      householdId,
      NOTIFICATION_TYPES.GOAL_PROGRESS,
      {
        title,
        body,
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
      }
    );

    notificationsSent += count;
  }

  logger.info("Weekly goal report sent", {
    households: householdCount,
    notificationsSent,
    weekKey,
  });

  return { households: householdCount, notificationsSent, weekKey };
}

export async function runGoalDeadlineReminders() {
  const reminderDaysRaw = Number(
    process.env.GOAL_DEADLINE_REMINDER_DAYS ?? 7
  );
  const reminderDays = Number.isFinite(reminderDaysRaw)
    ? reminderDaysRaw
    : 7;

  const candidates = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.isArchived, false),
        eq(goals.isCompleted, false),
        eq(goals.type, "save_up"),
        isNotNull(goals.targetDate)
      )
    );

  const today = new Date();
  const todayStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );

  let remindersSent = 0;

  for (const goal of candidates) {
    if (!goal.targetDate) continue;

    const target = new Date(goal.targetDate);
    const diffMs = target.getTime() - todayStart.getTime();
    const daysAway = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysAway <= 0 || daysAway > reminderDays) continue;

    const count = await notificationService.notifyHousehold(
      goal.householdId,
      NOTIFICATION_TYPES.GOAL_PROGRESS,
      {
        title: `Goal deadline approaching` as const,
        body: `${goal.name} is due in ${daysAway} day${daysAway === 1 ? "" : "s"}.`,
        actionUrl: `/goals/${goal.id}`,
        metadata: { goalId: goal.id, daysAway, targetDate: goal.targetDate },
        dedupeKey: `goal:${goal.id}:deadline:${goal.targetDate}`,
      }
    );

    remindersSent += count;
  }

  logger.info("Goal deadline reminders sent", {
    remindersSent,
    reminderDays,
  });

  return { remindersSent, reminderDays };
}
