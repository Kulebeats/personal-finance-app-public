import {
  useGoals,
  useGoalsSummary,
  Goal,
  GoalsSummaryResponse,
} from "@/hooks/useGoals";
import { useMemo } from "react";

export type { GoalsSummaryResponse };

// Function to sort goals by priority
function sortGoalsByPriority(list: Goal[]) {
  return [...list].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.name.localeCompare(b.name);
  });
}

export function useGoalsData() {
  const {
    data: goals,
    isLoading,
    error,
    refetch,
  } = useGoals({
    includeArchived: false,
    includeCompleted: true,
  });

  const { data: summary, isLoading: isSummaryLoading } = useGoalsSummary();

  const { saveUpGoals, payDownGoals, goalsOnTrack } = useMemo(() => {
    const list = goals ?? [];
    const saveUp = sortGoalsByPriority(
      list.filter((goal) => goal.type === "save_up")
    );
    const payDown = sortGoalsByPriority(
      list.filter((goal) => goal.type === "pay_down")
    );
    const onTrack = list.filter(
      (goal) => goal.status === "on_track" || goal.status === "completed"
    ).length;

    return {
      saveUpGoals: saveUp,
      payDownGoals: payDown,
      goalsOnTrack: onTrack,
    };
  }, [goals]);

  return {
    goals,
    summary,
    isLoading,
    isSummaryLoading,
    error,
    refetch,
    saveUpGoals,
    payDownGoals,
    goalsOnTrack,
  };
}
