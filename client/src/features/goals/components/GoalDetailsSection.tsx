import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { GoalProgressBar } from "./GoalProgressBar";
import { useArchiveGoal, useCompleteGoal } from "@/hooks/useGoals";
import { parseMoney } from "@/lib/utils";
import type { Goal } from "../types";

function parseAmount(value?: string | number | null) {
  return parseMoney(value);
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

interface GoalDetailsSectionProps {
  goal: Goal;
  formatCurrency: (amount: number) => string;
  onEdit: () => void;
  onClose: () => void;
  percentComplete: number;
  progressAmount: number;
  targetAmount: number;
  remainingAmount: number;
  usesHoldings: boolean;
  children?: React.ReactNode;
}

export function GoalDetailsSection({
  goal,
  formatCurrency,
  onEdit,
  onClose,
  percentComplete,
  progressAmount,
  targetAmount,
  remainingAmount,
  usesHoldings,
  children,
}: GoalDetailsSectionProps) {
  const archiveGoal = useArchiveGoal();
  const completeGoal = useCompleteGoal();

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{goal.name}</h3>
          <p className="text-sm text-muted-foreground">
            {goal.description || goal.goalType || "Goal"}
          </p>
        </div>
        <GoalStatusBadge status={goal.status} />
      </div>

      {goal.customImageUrl ? (
        <div className="overflow-hidden rounded-lg border">
          <img
            src={goal.customImageUrl}
            alt=""
            className="h-40 w-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            Spending reduces progress:{" "}
            {goal.spendingReducesProgress ? "On" : "Off"}
          </div>
          {goal.type === "investment" ? (
            <div>
              Progress source:{" "}
              {usesHoldings ? "Holdings (auto-synced)" : "Contributions"}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit goal
          </Button>
          {!goal.isCompleted && goal.status !== "completed" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => completeGoal.mutate(goal.id)}
              disabled={completeGoal.isPending}
            >
              Mark complete
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={archiveGoal.isPending}
              >
                {goal.isArchived ? "Restore" : "Archive"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {goal.isArchived ? "Restore goal?" : "Archive goal?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {goal.isArchived
                    ? "This goal will be visible again and included in summaries."
                    : "Archived goals are hidden from the main list but can be restored later."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    archiveGoal.mutate(
                      { id: goal.id, archive: !goal.isArchived },
                      {
                        onSuccess: () => {
                          if (!goal.isArchived) {
                            onClose();
                          }
                        },
                      }
                    );
                  }}
                >
                  {goal.isArchived ? "Restore" : "Archive"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium text-foreground">
            {percentComplete}%
          </span>
        </div>
        <GoalProgressBar
          current={progressAmount}
          target={targetAmount}
          color={goal.color}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatCurrency(progressAmount)}</span>
          <span>{formatCurrency(targetAmount)}</span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>
          {goal.type === "pay_down"
            ? `Remaining debt: ${formatCurrency(remainingAmount)}`
            : `Remaining: ${formatCurrency(remainingAmount)}`}
        </span>
        {goal.targetDate ? (
          <span>Target: {formatDate(goal.targetDate)}</span>
        ) : null}
      </div>

      {goal.type === "save_up" && goal.monthlyProjection ? (
        <div className="text-xs text-muted-foreground">
          Monthly projection:{" "}
          {formatCurrency(parseAmount(goal.monthlyProjection))}
        </div>
      ) : null}

      {goal.type === "pay_down" && goal.monthlyPayment ? (
        <div className="text-xs text-muted-foreground">
          Monthly payment: {formatCurrency(parseAmount(goal.monthlyPayment))}
        </div>
      ) : null}

      {children}
    </Card>
  );
}
