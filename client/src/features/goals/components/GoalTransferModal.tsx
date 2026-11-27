import { userErrorMessage } from "@/lib/errorCopy";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { calendarDateAsLocalDate, useHouseholdDateDefault } from "@/lib/calendarZone";
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
  useTransferBetweenGoals,
  type Goal,
} from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useToast } from "@/hooks/use-toast";
import { GoalTransferForm } from "./GoalTransferForm";
import { OverfundConfirm, needsOverfundConfirm } from "./OverfundConfirm";
import { isOverfundRefusal, useContributeFromAccount } from "../hooks/useContributeFromAccount";
import { generateIdempotencyKey } from "@/lib/api";
import { checkTransferAmount } from "./transferAmount";
import { afterContributionFailure, contributionRequestFor, type SentContribution } from "./contributionRequest";

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
  const { toast } = useToast();

  const [mode, setMode] = useState<"goal-to-goal" | "account-to-goal">(
    "goal-to-goal"
  );

  // Form State
  const [fromId, setFromId] = useState(""); // Goal ID or Account ID
  const [toGoalId, setToGoalId] = useState("");
  const [amount, setAmount] = useState("");
  // NEW-15: the server's day, UTC for a legacy household; reset each time the dialog opens.
  const dateDefault = useHouseholdDateDefault();
  const date = useMemo(() => calendarDateAsLocalDate(dateDefault.date), [dateDefault.date]);
  const [isBudget, setIsBudget] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmOverfund, setConfirmOverfund] = useState(false);
  // The server refused with its over-fund 409: nothing was written, and a
  // confirmation lets the same request go through (#245, Astra round 2).
  const [serverAskedOverfund, setServerAskedOverfund] = useState(false);
  const contributeFromAccount = useContributeFromAccount(toGoalId);
  // One key per contribution as entered: resending it unchanged replays, so a
  // double submit records one expense; any edit makes it a new contribution.
  const contributionKey = useMemo(
    () => generateIdempotencyKey(),
    [open, mode, fromId, toGoalId, amount, dateDefault.date, reason, isBudget]
  );
  useEffect(() => setServerAskedOverfund(false), [contributionKey]);
  const sentContribution = useRef<SentContribution | null>(null);
  const fromAccount = useMemo(
    () => accounts.find((account) => account.id === fromId),
    [accounts, fromId]
  );

  // Only a closed-to-open change resets the date: a refetch must not move a picked date (and so the key).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) dateDefault.reset();
    wasOpen.current = open;
  }, [open, dateDefault.reset]);

  useEffect(() => {
    if (!open) {
      setFromId("");
      setToGoalId("");
      setAmount("");
      setReason("");
      setIsBudget(false);
      setConfirmOverfund(false);
      setMode("goal-to-goal");
      return;
    }

    if (sourceGoal) {
      setFromId(sourceGoal.id);
      setMode("goal-to-goal");
    }
  }, [open, sourceGoal?.id]); // the id, not the object: a refetch of the same goal changes nothing

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

  const targetGoal = useMemo(
    () => goals.find((goal) => goal.id === toGoalId),
    [goals, toGoalId]
  );
  // A confirmation given for one goal never carries over to another.
  useEffect(() => setConfirmOverfund(false), [toGoalId]);
  // Both modes move money into the target, so both follow the over-fund rule (goals QA F5).
  // The amount is only comparable with the goal's balance in the goal's own currency;
  // across currencies the server's 409 is what asks.
  const comparable = mode === "goal-to-goal" || fromAccount?.currency === targetGoal?.currency;
  const hintsOverfund = targetGoal?.progressAvailability === "unavailable" || comparable
    ? needsOverfundConfirm(targetGoal, amount)
    : false;
  const asksOverfund = serverAskedOverfund || hintsOverfund;
  const overfundConfirmed = asksOverfund && confirmOverfund ? true : undefined;

  // Sent exactly as typed: a JS number would round 2.675 to 2.67 (#245, Astra round 3).
  const amountCheck = checkTransferAmount(amount);
  const exactAmount = amountCheck.amount;
  const canSubmit =
    fromId &&
    toGoalId &&
    exactAmount &&
    fromId !== toGoalId &&
    (!asksOverfund || confirmOverfund) &&
    (!isBudget || !!budgetCategory);

  const handleSubmit = async () => {
    if (!canSubmit || !exactAmount) return;

    try {
      if (mode === "goal-to-goal") {
        await transferMutation.mutateAsync({
          fromGoalId: fromId,
          toGoalId,
          amount: {
            amount: exactAmount,
            currency: fromGoal?.currency || "ZMW",
          },
          reason: reason || undefined,
          confirmOverfund: overfundConfirmed,
        });
      } else {
        // The expense and its link are one server write (#245, Astra round 2). A retry
        // under the same key resends the first request; only the confirmation is fresh.
        dateDefault.hold(); // sent with this key: a late zone must not move it
        const sent = contributionRequestFor(sentContribution.current, contributionKey, () => ({
          accountId: fromId,
          amount: { amount: exactAmount, currency: fromAccount?.currency || "ZMW" },
          date: dateDefault.date,
          reason: reason || undefined,
          categoryId: isBudget ? budgetCategory?.id : undefined,
          idempotencyKey: contributionKey,
        }));
        sentContribution.current = sent;
        await contributeFromAccount.mutateAsync({ ...sent.request, confirmOverfund: overfundConfirmed });

        toast({
          title: "Contribution added",
          description: `Added ${exactAmount} to ${
            targetGoal?.name ?? "goal"
          }.`,
        });
      }
      onClose();
    } catch (error) {
      sentContribution.current = afterContributionFailure(sentContribution.current, error);
      // Nothing was written; the server asks for a confirmation the member can give.
      if (isOverfundRefusal(error)) {
        setServerAskedOverfund(true);
        setConfirmOverfund(false);
      }
      // A transfer's hook shows its own error; the contribution's is shown here.
      if (mode === "account-to-goal") {
        toast({
          title: "Contribution not recorded",
          description: userErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
      }
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
          amountError={amountCheck.error}
          onAmountChange={setAmount}
          date={date}
          // The picker's Date is a local calendar day; UTC would shift it east of Greenwich.
          onDateChange={(picked) => dateDefault.choose(format(picked, "yyyy-MM-dd"))}
          reason={reason}
          onReasonChange={setReason}
          isBudget={isBudget}
          onBudgetChange={setIsBudget}
          budgetCategory={budgetCategory}
        />

        {asksOverfund && targetGoal ? (
          <OverfundConfirm goal={targetGoal} checked={confirmOverfund} onCheckedChange={setConfirmOverfund} />
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !canSubmit ||
              transferMutation.isPending ||
              contributeFromAccount.isPending
            }
          >
            {transferMutation.isPending || contributeFromAccount.isPending
              ? "Transferring..."
              : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
