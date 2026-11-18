import { GoalActivityList } from "../GoalActivityItem";
import type { GoalDetailData } from "./useGoalDetailData";

export interface GoalActivityTabProps {
  activity: GoalDetailData["activity"];
}

export function GoalActivityTab({ activity }: GoalActivityTabProps) {
  return <GoalActivityList activities={activity} />;
}
