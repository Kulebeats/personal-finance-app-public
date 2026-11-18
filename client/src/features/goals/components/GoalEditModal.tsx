import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SaveUpGoalForm, type SaveUpGoalDraft } from "./SaveUpGoalForm";
import { PayDownGoalForm, type PayDownGoalDraft } from "./PayDownGoalForm";
import {
  InvestmentGoalForm,
  type InvestmentGoalDraft,
} from "./InvestmentGoalForm";
import {
  useUpdateGoal,
  type Goal,
  type GoalType,
} from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import {
  buildInvestmentDraft,
  buildPayDownDraft,
  buildSaveUpDraft,
} from "./GoalEditModalData";


export function GoalEditModal({
  goal,
  open,
  onClose,
}: {
  goal: Goal | null;
  open: boolean;
  onClose: () => void;
}) {
  const updateGoal = useUpdateGoal();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts({
    includeArchived: false,
    includeHidden: false,
  });

  const [goalType, setGoalType] = useState<GoalType>("save_up");
  const [saveUpDraft, setSaveUpDraft] = useState<SaveUpGoalDraft | null>(null);
  const [payDownDraft, setPayDownDraft] = useState<PayDownGoalDraft | null>(null);
  const [investmentDraft, setInvestmentDraft] =
    useState<InvestmentGoalDraft | null>(null);

  useEffect(() => {
    if (!open || !goal) return;
    setGoalType(goal.type);
    if (goal.type === "save_up") {
      setSaveUpDraft(buildSaveUpDraft(goal));
      setPayDownDraft(null);
      setInvestmentDraft(null);
    } else if (goal.type === "pay_down") {
      setPayDownDraft(buildPayDownDraft(goal));
      setSaveUpDraft(null);
      setInvestmentDraft(null);
    } else {
      setInvestmentDraft(buildInvestmentDraft(goal));
      setSaveUpDraft(null);
      setPayDownDraft(null);
    }
  }, [open, goal]);

  const debtAccounts = useMemo(
    () => accounts.filter((account) => ["credit", "loan"].includes(account.type)),
    [accounts]
  );

  if (!goal) {
    return null;
  }

  const canSubmitSaveUp =
    !!saveUpDraft &&
    saveUpDraft.name.trim().length > 0 &&
    saveUpDraft.targetAmount.length > 0 &&
    (saveUpDraft.goalType !== "other" ||
      saveUpDraft.otherGoalType.trim().length > 0);
  const canSubmitPayDown =
    !!payDownDraft &&
    payDownDraft.name.trim().length > 0 &&
    payDownDraft.debtAccountId.length > 0 &&
    payDownDraft.interestRate.length > 0 &&
    payDownDraft.minimumPayment.length > 0 &&
    payDownDraft.monthlyPayment.length > 0 &&
    (payDownDraft.goalType !== "other" ||
      payDownDraft.otherGoalType.trim().length > 0);
  const canSubmitInvestment =
    !!investmentDraft &&
    investmentDraft.name.trim().length > 0 &&
    investmentDraft.targetAmount.length > 0 &&
    (investmentDraft.goalType !== "other" ||
      investmentDraft.otherGoalType.trim().length > 0);

  const handleSubmit = () => {
    const currency = goal?.currency || "ZMW";
    if (goalType === "save_up" && saveUpDraft) {
      const resolvedGoalType =
        saveUpDraft.goalType === "other"
          ? saveUpDraft.otherGoalType.trim() || "other"
          : saveUpDraft.goalType;
      updateGoal.mutate(
        {
          id: goal.id,
            data: {
              goalType: resolvedGoalType,
              name: saveUpDraft.name.trim(),
              icon: saveUpDraft.icon || undefined,
              color: saveUpDraft.color || undefined,
              customImageUrl: saveUpDraft.customImageUrl.trim()
                ? saveUpDraft.customImageUrl
                : null,
              targetAmount: {
                amount: saveUpDraft.targetAmount,
                currency,
              },
              targetDate: saveUpDraft.targetDate || undefined,
              startDate: saveUpDraft.startDate || undefined,
              description: saveUpDraft.description || undefined,
              spendingReducesProgress: saveUpDraft.spendingReducesProgress,
              priority: saveUpDraft.priority,
            notes: saveUpDraft.notes || undefined,
          },
        },
        { onSuccess: onClose }
      );
      return;
    }

    if (goalType === "pay_down" && payDownDraft) {
      const resolvedGoalType =
        payDownDraft.goalType === "other"
          ? payDownDraft.otherGoalType.trim() || "other"
          : payDownDraft.goalType;
      updateGoal.mutate(
        {
          id: goal.id,
            data: {
              goalType: resolvedGoalType,
              name: payDownDraft.name.trim(),
              debtAccountId: payDownDraft.debtAccountId,
              interestRate: payDownDraft.interestRate,
              minimumPayment: {
                amount: payDownDraft.minimumPayment,
                currency,
              },
              monthlyPayment: {
                amount: payDownDraft.monthlyPayment,
                currency,
              },
              oneTimePayment: payDownDraft.oneTimePayment
                ? {
                    amount: payDownDraft.oneTimePayment,
                    currency,
                  }
                : undefined,
              payoffMethod: payDownDraft.payoffMethod,
              priority: payDownDraft.priority,
              notes: payDownDraft.notes || undefined,
            },
        },
        { onSuccess: onClose }
      );
      return;
    }

    if (goalType === "investment" && investmentDraft) {
      const resolvedGoalType =
        investmentDraft.goalType === "other"
          ? investmentDraft.otherGoalType.trim() || "other"
          : investmentDraft.goalType;
      updateGoal.mutate(
        {
          id: goal.id,
            data: {
              goalType: resolvedGoalType,
              name: investmentDraft.name.trim(),
              icon: investmentDraft.icon || undefined,
              color: investmentDraft.color || undefined,
              customImageUrl: investmentDraft.customImageUrl.trim()
                ? investmentDraft.customImageUrl
                : null,
              targetAmount: {
                amount: investmentDraft.targetAmount,
                currency,
              },
              targetDate: investmentDraft.targetDate || undefined,
              startDate: investmentDraft.startDate || undefined,
              description: investmentDraft.description || undefined,
              linkedAccountId: investmentDraft.linkedAccountId || undefined,
            expectedReturn: investmentDraft.expectedReturn || undefined,
            inflationRate: investmentDraft.inflationRate || undefined,
            priority: investmentDraft.priority,
            notes: investmentDraft.notes || undefined,
          },
        },
        { onSuccess: onClose }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
        </DialogHeader>

        {goalType === "save_up" && saveUpDraft ? (
          <SaveUpGoalForm value={saveUpDraft} onChange={setSaveUpDraft} />
        ) : null}

        {goalType === "pay_down" && payDownDraft ? (
          <PayDownGoalForm
            value={payDownDraft}
            onChange={setPayDownDraft}
            accounts={debtAccounts}
            accountsLoading={accountsLoading}
          />
        ) : null}

        {goalType === "investment" && investmentDraft ? (
          <InvestmentGoalForm
            value={investmentDraft}
            onChange={setInvestmentDraft}
            accounts={accounts.filter((account) => account.type === "investment")}
          />
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={updateGoal.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              updateGoal.isPending ||
              (goalType === "save_up"
                ? !canSubmitSaveUp
                : goalType === "pay_down"
                ? !canSubmitPayDown
                : !canSubmitInvestment)
            }
          >
            {updateGoal.isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
