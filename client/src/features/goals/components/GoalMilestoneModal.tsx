import { useEffect, useMemo, useState } from "react";
import { MilestoneModal } from "./MilestoneModal";
import {
  useNotifications,
  useMarkAsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { useGoal } from "@/hooks/useGoals";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes"; // This failed in previous test, need to be careful. Check if @shared alias exists.
import { parseMoney } from "@/lib/utils";

function parseAmount(value?: string | null) {
  return parseMoney(value);
}

function extractGoalId(notification: Notification) {
  const metadata = notification.metadata;
  if (metadata && typeof metadata === "object") {
    const goalId = (metadata as Record<string, unknown>).goalId;
    if (typeof goalId === "string" && goalId.length > 0) {
      return goalId;
    }
  }

  if (notification.actionUrl) {
    const match = notification.actionUrl.match(/\/goals\/([^/]+)/);
    if (match) return match[1];
  }

  return null;
}

function extractMilestone(notification: Notification) {
  if (notification.type === NOTIFICATION_TYPES.GOAL_ACHIEVED) {
    return 100;
  }

  if (notification.type !== NOTIFICATION_TYPES.GOAL_PROGRESS) {
    return null;
  }

  const metadata = notification.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const milestone = (metadata as Record<string, unknown>).milestone;
  if (typeof milestone === "number") return milestone;
  if (typeof milestone === "string") {
    const parsed = Number(milestone);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function GoalMilestoneModal() {
  const { data: notifications = [] } = useNotifications({
    limit: 20,
    unreadOnly: true,
  });
  const markAsRead = useMarkAsRead();
  const [closedId, setClosedId] = useState<string | null>(null);

  const milestoneNotifications = useMemo(
    () =>
      notifications.filter((notification) => {
        const milestone = extractMilestone(notification);
        if (!milestone) return false;
        return !!extractGoalId(notification);
      }),
    [notifications]
  );

  useEffect(() => {
    if (
      closedId &&
      !milestoneNotifications.some((item) => item.id === closedId)
    ) {
      setClosedId(null);
    }
  }, [closedId, milestoneNotifications]);

  const activeNotification = useMemo(() => {
    const visible = milestoneNotifications.filter(
      (notification) => notification.id !== closedId
    );
    return visible[0] ?? null;
  }, [milestoneNotifications, closedId]);

  const goalId = activeNotification ? extractGoalId(activeNotification) : null;
  const milestone = activeNotification
    ? extractMilestone(activeNotification)
    : null;
  const { data: goal } = useGoal(goalId ?? "");

  if (!activeNotification || !goal || milestone === null) {
    return null;
  }

  const targetAmount = parseAmount(goal.originalBalance ?? goal.targetAmount);
  const currentAmount = parseAmount(goal.currentAmount);
  if (targetAmount <= 0) {
    return null;
  }
  const progressAmount =
    goal.type === "pay_down"
      ? Math.max(0, targetAmount - currentAmount)
      : Math.min(targetAmount, currentAmount);
  const isCompleted =
    milestone >= 100 ||
    activeNotification.type === NOTIFICATION_TYPES.GOAL_ACHIEVED;

  const handleClose = () => {
    setClosedId(activeNotification.id);
    markAsRead.mutate(activeNotification.id);
  };

  return (
    <MilestoneModal
      open={true}
      onClose={handleClose}
      goalName={goal.name}
      milestone={milestone}
      currentAmount={progressAmount}
      targetAmount={targetAmount}
      color={goal.color}
      isCompleted={isCompleted}
    />
  );
}
