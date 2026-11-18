import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { LucideIcon } from "lucide-react";
import type { Account } from "@/lib/api";

import { AccountGoalSetting, parseAmount } from "./GoalAccountsModalData";
import type { Goal } from "../types";
import type { GoalAccountAssignmentWithGoal } from "@/hooks/useGoals";

type GoalAccountCardProps = {
  account: Account;
  icon: LucideIcon;
  setting: AccountGoalSetting;
  accountAssignments: GoalAccountAssignmentWithGoal[];
  goals: Goal[];
  goalsById: Map<string, any>;
  formatCurrency: (value: number) => string;
  isSaving: boolean;
  onUpdateSetting: (updates: Partial<AccountGoalSetting>) => void;
  toast: (options: {
    title: string;
    description: string;
    variant?: "destructive" | "default";
  }) => void;
};

export function GoalAccountCard({
  account,
  icon: Icon,
  setting,
  accountAssignments,
  goals,
  goalsById,
  formatCurrency,
  isSaving,
  onUpdateSetting,
  toast,
}: GoalAccountCardProps) {
  const hasMultipleAssignments = accountAssignments.length > 1;
  const selectedGoal = setting.linkedGoalId
    ? goalsById.get(setting.linkedGoalId)
    : undefined;
  const usesHoldings =
    selectedGoal?.type === "investment" &&
    selectedGoal.progressSource === "holdings";
  const disableFullBalance = selectedGoal?.spendingReducesProgress ?? false;

  const eligibleGoals = useMemo(() => {
    const base = goals.filter((goal) => {
      if (goal.type === "pay_down") return false;
      if (goal.isArchived) return false;
      const goalUsesHoldings =
        goal.type === "investment" && goal.progressSource === "holdings";
      if (!goalUsesHoldings && goal.currency !== account.currency) {
        return false;
      }
      return true;
    });

    if (selectedGoal && !base.some((goal) => goal.id === selectedGoal.id)) {
      return [selectedGoal, ...base];
    }
    return base;
  }, [account.currency, goals, selectedGoal]);

  const handleGoalChange = (value: string) => {
    const goal = goalsById.get(value);
    const goalUsesHoldings =
      goal?.type === "investment" && goal.progressSource === "holdings";
    const fullBalanceDisabled = goal?.spendingReducesProgress ?? false;

    onUpdateSetting({
      linkedGoalId: value,
      useEntireBalance: goalUsesHoldings
        ? true
        : fullBalanceDisabled
        ? false
        : setting.useEntireBalance,
      partialAmount: goalUsesHoldings ? "" : setting.partialAmount,
    });
  };

  const handleUseEntireBalanceChange = (checked: boolean) => {
    if (disableFullBalance && checked) {
      toast({
        title: "Full balance disabled",
        description:
          "This goal disallows full balance assignments when spending reduces progress.",
        variant: "destructive",
      });
      return;
    }

    onUpdateSetting({
      useEntireBalance: checked,
    });
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">{account.name}</div>
            <div className="text-sm text-muted-foreground">
              Account balance: {formatCurrency(parseAmount(account.balance))}
            </div>
          </div>
        </div>
        <Switch
          checked={setting.enabled}
          onCheckedChange={(checked) =>
            onUpdateSetting({
              enabled: checked,
            })
          }
          disabled={hasMultipleAssignments || isSaving}
          className="data-[state=checked]:bg-orange-500"
        />
      </div>

      {hasMultipleAssignments ? (
        <div className="space-y-2 pl-[52px]">
          <p className="text-xs text-muted-foreground">
            This account is assigned to multiple goals. Manage assignments
            inside each goal.
          </p>
          <div className="space-y-1">
            {accountAssignments.map((assignment) => {
              const label =
                assignment.assignmentType === "full_balance"
                  ? "Full balance"
                  : `Partial ${formatCurrency(
                      parseAmount(assignment.partialAmount)
                    )}`;
              return (
                <div
                  key={assignment.id}
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span>{assignment.goalName ?? "Goal"}</span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        setting.enabled && (
          <div className="space-y-4 pl-[52px]">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`entire-balance-${account.id}`}
                checked={usesHoldings ? true : setting.useEntireBalance}
                onCheckedChange={(checked) =>
                  handleUseEntireBalanceChange(checked as boolean)
                }
                disabled={
                  !setting.enabled ||
                  hasMultipleAssignments ||
                  usesHoldings ||
                  isSaving
                }
                className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
              />
              <Label
                htmlFor={`entire-balance-${account.id}`}
                className="text-sm cursor-pointer"
              >
                Use entire account balance and future activity
              </Label>
            </div>
            {disableFullBalance ? (
              <p className="text-xs text-amber-600">
                Full balance assignments are disabled when spending reduces
                progress.
              </p>
            ) : null}
            {usesHoldings ? (
              <p className="text-xs text-muted-foreground">
                Holdings-tracked investment goals require full balance
                assignments.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label className="text-sm">Linked goal</Label>
              <Select
                value={setting.linkedGoalId}
                onValueChange={handleGoalChange}
                disabled={!setting.enabled || hasMultipleAssignments || isSaving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a goal" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleGoals.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No compatible goals
                    </SelectItem>
                  ) : (
                    eligibleGoals.map((goal) => (
                      <SelectItem key={goal.id} value={goal.id}>
                        {goal.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {!usesHoldings && !setting.useEntireBalance ? (
              <div className="space-y-2">
                <Label className="text-sm">Partial amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={setting.partialAmount}
                  onChange={(event) =>
                    onUpdateSetting({
                      partialAmount: event.target.value,
                    })
                  }
                  disabled={isSaving}
                />
              </div>
            ) : null}
          </div>
        )
      )}
    </div>
  );
}
