import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useGoals,
  useLinkTransaction,
  useTransferBetweenGoals,
  type Goal,
} from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { useCreateTransaction } from "@/hooks/useTransactions";
import { useCategories } from "@/hooks/useCategories";
import { useToast } from "@/hooks/use-toast";
import { GoalTransferForm } from "./GoalTransferForm";
import { parseMoney } from "@/lib/utils";

export function GoalTransferModal({
  open,
  onClose,
  sourceGoal,
}: {
  open: boolean;
  onClose: () => void;
  sourceGoal?: Goal | null;
}) {
  const { data: goals = [] } = useGoals({ includeArchived: false });
  const { data: accounts = [] } = useAccounts();
  const { data: categoriesData } = useCategories({ includeArchived: false });
  const transferMutation = useTransferBetweenGoals();
  const createTransaction = useCreateTransaction();
  const { toast } = useToast();

  const [mode, setMode] = useState<"goal-to-goal" | "account-to-goal">(
    "goal-to-goal"
  );

  // Form State
  const [fromId, setFromId] = useState(""); // Goal ID or Account ID
  const [toGoalId, setToGoalId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [isBudget, setIsBudget] = useState(false);
  const [reason, setReason] = useState("");
  const linkTransaction = useLinkTransaction(toGoalId);
  const fromAccount = useMemo(
    () => accounts.find((account) => account.id === fromId),
    [accounts, fromId]
  );

  useEffect(() => {
    if (!open) {
      setFromId("");
      setToGoalId("");
      setAmount("");
      setReason("");
      setDate(new Date());
      setIsBudget(false);
      setMode("goal-to-goal");
      return;
    }

    if (sourceGoal) {
      setFromId(sourceGoal.id);
      setMode("goal-to-goal");
    }
  }, [open, sourceGoal]);

  const fromGoal = useMemo(
    () =>
      mode === "goal-to-goal" ? goals.find((goal) => goal.id === fromId) : null,
    [goals, fromId, mode]
  );

  const availableTargets = useMemo(() => {
    if (mode === "account-to-goal") return goals;
    if (!fromGoal) return goals;
    return goals.filter(
      (goal) =>
        goal.id !== fromGoal.id &&
        goal.type === fromGoal.type &&
        goal.currency === fromGoal.currency &&
        !goal.isArchived
    );
  }, [goals, fromGoal, mode]);

  const budgetCategory = useMemo(() => {
    if (!categoriesData) return null;
    const groupById = new Map(
      categoriesData.groups.map((group) => [group.id, group])
    );
    const savingsCategories = categoriesData.categories.filter((category) => {
      if (!category.groupId || category.isArchived) return false;
      const group = groupById.get(category.groupId);
      if (!group || group.isArchived) return false;
      if (group.type !== "expenses") return false;
      const groupName = group.name.toLowerCase();
      return groupName.includes("savings") || groupName.includes("investment");
    });

    if (savingsCategories.length === 0) return null;
    return (
      savingsCategories.find((category) =>
        category.name.toLowerCase().includes("goal")
      ) ?? savingsCategories[0]
    );
  }, [categoriesData]);

  const amountValue = parseMoney(amount);
  const canSubmit =
    fromId &&
    toGoalId &&
    amount &&
    amountValue > 0 &&
    fromId !== toGoalId &&
    (!isBudget || !!budgetCategory);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      if (mode === "goal-to-goal") {
        // Format amount as decimal string (e.g., "100.00") for API
        const formattedAmount = amountValue.toFixed(2);
        await transferMutation.mutateAsync({
          fromGoalId: fromId,
          toGoalId,
          amount: {
            amount: formattedAmount,
            currency: fromGoal?.currency || "ZMW",
          },
          reason: reason || undefined,
        });
      } else {
        const targetGoal = goals.find((goal) => goal.id === toGoalId);
        const formattedAmount = amountValue.toFixed(2);
        const formattedDate = date.toISOString().split("T")[0];
        const marker = `Goal contribution: ${targetGoal?.name ?? "Goal"} [goal:${toGoalId}]`;
        const notes = reason ? `${reason} | ${marker}` : marker;
        const currency = fromAccount?.currency || "ZMW";

        const transaction = await createTransaction.mutateAsync({
          accountId: fromId,
          date: formattedDate,
          name: marker,
          amount: { amount: formattedAmount, currency },
          type: "expense",
          categoryId: isBudget ? budgetCategory?.id : undefined,
          isExcludedFromBudget: !isBudget,
          notes,
        });

        await linkTransaction.mutateAsync({
          transactionId: transaction.transaction.id,
          linkType: "contribution",
          amount: { amount: formattedAmount, currency },
        });

        toast({
          title: "Contribution added",
          description: `Added ${formattedAmount} to ${
            targetGoal?.name ?? "goal"
          }.`,
        });
      }
      onClose();
    } catch {
      // Error handled by mutation usually, or toast here
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer / Contribute</DialogTitle>
        </DialogHeader>

        <GoalTransferForm
          mode={mode}
          onModeChange={setMode}
          goals={goals}
          accounts={accounts}
          availableTargets={availableTargets}
          fromId={fromId}
          onFromChange={setFromId}
          toGoalId={toGoalId}
          onToGoalChange={setToGoalId}
          amount={amount}
          onAmountChange={setAmount}
          date={date}
          onDateChange={setDate}
          reason={reason}
          onReasonChange={setReason}
          isBudget={isBudget}
          onBudgetChange={setIsBudget}
          budgetCategory={budgetCategory}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !canSubmit ||
              transferMutation.isPending ||
              createTransaction.isPending ||
              linkTransaction.isPending
            }
          >
            {transferMutation.isPending ||
            createTransaction.isPending ||
            linkTransaction.isPending
              ? "Transferring..."
              : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
