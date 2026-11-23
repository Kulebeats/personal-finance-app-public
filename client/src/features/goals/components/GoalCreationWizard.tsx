/**
 * GoalCreationWizard Component
 *
 * Modal wizard for creating goals (save_up, pay_down, investment).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccounts } from "@/hooks/useAccounts";
import {
  type GoalType,
  useAssignAccountForGoal,
  useCreateGoal,
  useAvailableFunds,
} from "@/hooks/useGoals";
import { useFormatters } from "@/contexts/SettingsContext";
import { SaveUpGoalForm, type SaveUpGoalDraft } from "./SaveUpGoalForm";
import { PayDownGoalForm, type PayDownGoalDraft } from "./PayDownGoalForm";
import {
  InvestmentGoalForm,
  type InvestmentGoalDraft,
} from "./InvestmentGoalForm";
import {
  GoalAssignmentStep,
  type AssignmentDraft,
} from "./GoalAssignmentStep";
import {
  DEFAULT_SAVE_UP,
  DEFAULT_PAY_DOWN,
  DEFAULT_INVESTMENT,
  parseAmount,
  getMonthsRemaining,
  buildSaveUpPayload,
  buildInvestmentPayload,
  buildPayDownPayload,
  buildAssignmentPayload,
  calculateTotalAssigned,
} from "./GoalCreationWizardData";
import { GoalValidationSummary } from "./GoalValidationSummary";
import { saveUpRequiredErrors, payDownRequiredErrors, investmentRequiredErrors } from "./goalRequiredFields";

export function GoalCreationWizard({
  open,
  onClose,
  initialType,
}: {
  open: boolean;
  onClose: () => void;
  initialType?: GoalType;
}) {
  const createGoal = useCreateGoal();
  const assignAccount = useAssignAccountForGoal();
  const { formatCurrency, currency: defaultCurrency } = useFormatters();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts({
    includeArchived: false,
    includeHidden: false,
  });
  const { data: availableFunds = [] } = useAvailableFunds();

  const [goalType, setGoalType] = useState<GoalType>(initialType ?? "save_up");
  const [validationAttempt, setValidationAttempt] = useState(0);
  useEffect(() => { setValidationAttempt(0); }, [open]);
  const [saveUpDraft, setSaveUpDraft] =
    useState<SaveUpGoalDraft>(DEFAULT_SAVE_UP);
  const [payDownDraft, setPayDownDraft] =
    useState<PayDownGoalDraft>(DEFAULT_PAY_DOWN);
  const [investmentDraft, setInvestmentDraft] =
    useState<InvestmentGoalDraft>(DEFAULT_INVESTMENT);
  const [saveUpStep, setSaveUpStep] = useState<"details" | "assignments">(
    "details"
  );
  const [assignments, setAssignments] = useState<
    Record<string, AssignmentDraft>
  >({});

  const investmentAccounts = useMemo(
    () => accounts.filter((account) => account.type === "investment"),
    [accounts]
  );

  const debtAccounts = useMemo(
    () =>
      accounts.filter((account) => ["credit", "loan"].includes(account.type)),
    [accounts]
  );

  useEffect(() => {
    if (!open) {
      setGoalType(initialType ?? "save_up");
      setSaveUpDraft(DEFAULT_SAVE_UP);
      setPayDownDraft(DEFAULT_PAY_DOWN);
      setInvestmentDraft(DEFAULT_INVESTMENT);
      setSaveUpStep("details");
      setAssignments({});
    }
  }, [open, initialType]);

  const assignmentList = useMemo(
    () =>
      Object.values(assignments).filter(
        (assignment) => assignment.assignmentType !== "none"
      ),
    [assignments]
  );

  const totalAssigned = useMemo(
    () => calculateTotalAssigned(assignmentList, accounts),
    [assignmentList, accounts]
  );

  const targetAmount = parseAmount(saveUpDraft.targetAmount);
  const monthsRemaining = getMonthsRemaining(saveUpDraft.targetDate);
  const remainingAmount = Math.max(0, targetAmount - totalAssigned);
  const monthlyNeeded =
    monthsRemaining && remainingAmount > 0
      ? remainingAmount / monthsRemaining
      : null;

  const updateAssignment = (
    accountId: string,
    next: Partial<AssignmentDraft>
  ) => {
    setAssignments((prev) => {
      const current = prev[accountId] ?? {
        accountId,
        assignmentType: "none",
        partialAmount: "",
      };
      const updated = { ...current, ...next };
      if (updated.assignmentType === "none") {
        const clone = { ...prev };
        delete clone[accountId];
        return clone;
      }
      return { ...prev, [accountId]: updated };
    });
  };

  const handleSubmit = async () => {
    if (Object.keys(requiredErrors).length) { setValidationAttempt(value => value + 1); return; }
    const currency = defaultCurrency || "ZMW";

    if (goalType === "save_up") {
      if (saveUpStep === "details") {
        setSaveUpStep("assignments");
        return;
      }

      const payload = buildSaveUpPayload(saveUpDraft, currency);

      try {
        const created = await createGoal.mutateAsync(payload);
        for (const assignment of assignmentList) {
          try {
            await assignAccount.mutateAsync({
              goalId: created.id,
              data: buildAssignmentPayload(assignment, currency),
            });
          } catch {
            // Toast handled by hook; continue assigning remaining accounts.
          }
        }
        onClose();
      } catch {
        return;
      }
      return;
    }

    if (goalType === "investment") {
      const payload = buildInvestmentPayload(investmentDraft, currency);
      createGoal.mutate(payload, {
        onSuccess: () => onClose(),
      });
      return;
    }

    const payload = buildPayDownPayload(payDownDraft, accounts, currency);
    createGoal.mutate(payload, {
      onSuccess: () => onClose(),
    });
  };

  const requiredErrors =
    goalType === "save_up"
      ? saveUpRequiredErrors(saveUpDraft)
      : goalType === "pay_down"
        ? payDownRequiredErrors(payDownDraft)
        : investmentRequiredErrors(investmentDraft);
  const visibleErrors = validationAttempt ? requiredErrors : {};

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a goal</DialogTitle>
          <DialogDescription>Choose a goal type and enter its details. Save Up goals can then be linked to accounts.</DialogDescription>
        </DialogHeader>
        <GoalValidationSummary errors={requiredErrors} attempt={validationAttempt} />

        <Tabs
          value={goalType}
          onValueChange={(val) => { setGoalType(val as GoalType); setValidationAttempt(0); }}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="save_up">Save Up</TabsTrigger>
            <TabsTrigger value="pay_down">Pay Down</TabsTrigger>
            <TabsTrigger value="investment">Investment</TabsTrigger>
          </TabsList>
          <TabsContent value="save_up" className="mt-4">
            {saveUpStep === "details" ? (
              <SaveUpGoalForm value={saveUpDraft} onChange={setSaveUpDraft} errors={visibleErrors} />
            ) : (
              <GoalAssignmentStep
                accounts={accounts}
                assignments={assignments}
                onAssignmentChange={updateAssignment}
                availableFunds={availableFunds}
                totalAssigned={totalAssigned}
                remainingAmount={remainingAmount}
                monthsRemaining={monthsRemaining}
                monthlyNeeded={monthlyNeeded}
                spendingReducesProgress={saveUpDraft.spendingReducesProgress}
                formatCurrency={formatCurrency}
              />
            )}
          </TabsContent>
          <TabsContent value="pay_down" className="mt-4">
            <PayDownGoalForm
              value={payDownDraft}
              onChange={setPayDownDraft}
              accounts={debtAccounts}
              accountsLoading={accountsLoading}
              errors={visibleErrors}
            />
          </TabsContent>
          <TabsContent value="investment" className="mt-4">
            <InvestmentGoalForm
              value={investmentDraft}
              onChange={setInvestmentDraft}
              accounts={investmentAccounts}
              errors={visibleErrors}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {goalType === "save_up" && saveUpStep === "assignments" ? (
            <Button
              variant="ghost"
              onClick={() => setSaveUpStep("details")}
              disabled={createGoal.isPending}
            >
              Back
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={createGoal.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createGoal.isPending}
          >
            {createGoal.isPending
              ? "Creating..."
              : goalType === "save_up" && saveUpStep === "details"
                ? "Continue"
                : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
