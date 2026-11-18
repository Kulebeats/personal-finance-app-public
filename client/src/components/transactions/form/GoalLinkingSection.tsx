import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { TransactionFormValues } from "./schema";
import { useState } from "react";
import {
  useLinkTransaction,
  useUnlinkTransactionFromGoal,
  type TransactionGoalLinkWithGoal,
} from "@/hooks/useGoals";
import { calculateMoneyProgressPercent } from "@/lib/money";
import type { Goal } from "@/features/goals/types";
import type { Transaction } from "@/lib/api";

interface GoalLinkingSectionProps {
  form: UseFormReturn<TransactionFormValues>;
  isEditMode: boolean;
  isTransferMode: boolean;
  goals: Goal[];
  goalsLoading: boolean;
  transaction?: Transaction | null;
  linkableGoals: Goal[];
  availableLinkGoals: Goal[];
  transactionGoalLinks: TransactionGoalLinkWithGoal[];
  resolveCurrency: (accountId?: string) => string;
}

export function GoalLinkingSection({
  form,
  isEditMode,
  isTransferMode,
  goalsLoading,
  transaction,
  linkableGoals,
  availableLinkGoals,
  transactionGoalLinks,
  resolveCurrency,
}: GoalLinkingSectionProps) {
  const [linkGoalId, setLinkGoalId] = useState("");

  const selectedGoalId = form.watch("goalId");
  const linkTransactionGoalId = isEditMode
    ? linkGoalId
    : selectedGoalId && selectedGoalId !== "_none"
    ? selectedGoalId
    : "";

  const linkTransaction = useLinkTransaction(linkTransactionGoalId);
  const unlinkGoalLink = useUnlinkTransactionFromGoal();

  const handleLinkGoal = async () => {
    if (!transaction?.id || !linkGoalId) return;

    const selectedGoal = linkableGoals.find((goal) => goal.id === linkGoalId);
    const currentType = form.getValues("type");
    const currentAmount =
      form.getValues("amount") ||
      (typeof transaction.amount === "string"
        ? transaction.amount
        : transaction.amount.amount);
    const linkType = currentType === "expense" ? "spending" : "contribution";
    const currency = resolveCurrency(transaction.accountId);

    if (
      linkType === "spending" &&
      selectedGoal &&
      !selectedGoal.spendingReducesProgress
    ) {
      toast.error("Selected goal doesn't allow spending to reduce progress.");
      return;
    }

    try {
      await linkTransaction.mutateAsync({
        transactionId: transaction.id,
        linkType,
        amount: { amount: currentAmount, currency },
      });
      setLinkGoalId("");
    } catch (err) {
      console.error("Failed to link transaction to goal:", err);
      toast.error("Failed to link transaction to goal.");
    }
  };

  if (isTransferMode) return null;

  return (
    <>
      {!isEditMode && (
        <FormField
          control={form.control}
          name="goalId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Goal (Optional)</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={goalsLoading}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={goalsLoading ? "Loading..." : "Select goal"}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {linkableGoals.map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>
                      {goal.name} (
                      {calculateMoneyProgressPercent(
                        goal.currentAmount,
                        goal.targetAmount,
                      )}
                      %)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Link this transaction to a savings goal.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {isEditMode && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="text-sm font-medium">Linked goals</div>
          {transactionGoalLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No goals linked yet.
            </p>
          ) : (
            <div className="space-y-2">
              {transactionGoalLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{link.goal.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {link.linkType === "spending"
                        ? "Spending"
                        : "Contribution"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      unlinkGoalLink.mutate({
                        goalId: link.goalId,
                        transactionId: transaction?.id ?? "",
                      })
                    }
                    disabled={unlinkGoalLink.isPending}
                  >
                    Unlink
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2">
            <Label>Link to goal</Label>
            <Select
              value={linkGoalId}
              onValueChange={setLinkGoalId}
              disabled={goalsLoading || availableLinkGoals.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    goalsLoading
                      ? "Loading..."
                      : availableLinkGoals.length === 0
                      ? "No goals available"
                      : "Select goal"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableLinkGoals.map((goal) => (
                  <SelectItem key={goal.id} value={goal.id}>
                    {goal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            onClick={handleLinkGoal}
            disabled={!linkGoalId || linkTransaction.isPending}
          >
            Link goal
          </Button>
        </div>
      )}
    </>
  );
}
