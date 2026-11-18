import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import {
  useGoals,
  useGoalAssignmentsAll,
  useAssignAccountForGoal,
  useUpdateAssignmentForGoal,
  useRemoveAssignmentForGoal,
} from "@/hooks/useGoals";
import { useFormatters } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";

import {
  AccountGoalSetting,
  areAccountSettingsEqual,
  groupAccountsByType,
  parseAmount,
  validateAssignmentSetting,
  buildAssignmentPayload,
  needsAssignmentUpdate,
} from "./GoalAccountsModalData";
import { GoalAccountsList } from "./GoalAccountsList";

export function GoalAccountsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: accounts } = useAccounts();
  const { data: goals } = useGoals({
    includeArchived: true,
    includeCompleted: true,
  });
  const { data: assignments = [] } = useGoalAssignmentsAll();
  const assignAccount = useAssignAccountForGoal();
  const updateAssignment = useUpdateAssignmentForGoal();
  const removeAssignment = useRemoveAssignmentForGoal();
  const { toast } = useToast();
  const { formatCurrency } = useFormatters();
  const groupedAccounts = useMemo(
    () => groupAccountsByType(accounts || []),
    [accounts]
  );
  const assignmentsByAccount = useMemo(() => {
    const map = new Map<string, typeof assignments>();
    assignments.forEach((assignment) => {
      const list = map.get(assignment.accountId) ?? [];
      list.push(assignment);
      map.set(assignment.accountId, list);
    });
    return map;
  }, [assignments]);
  const goalsById = useMemo(
    () => new Map((goals ?? []).map((goal) => [goal.id, goal])),
    [goals]
  );
  const hasAccounts = (accounts ?? []).length > 0;

  // Local draft state for account settings before persisting.
  const [accountSettings, setAccountSettings] = useState<
    Record<string, AccountGoalSetting>
  >({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setAccountSettings((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const nextSettings: Record<string, AccountGoalSetting> = {};
    (accounts ?? []).forEach((account) => {
      const accountAssignments = assignmentsByAccount.get(account.id) ?? [];
      if (accountAssignments.length === 1) {
        const assignment = accountAssignments[0];
        nextSettings[account.id] = {
          enabled: true,
          useEntireBalance: assignment.assignmentType === "full_balance",
          linkedGoalId: assignment.goalId,
          partialAmount: assignment.partialAmount ?? "",
        };
      } else {
        nextSettings[account.id] = {
          enabled: accountAssignments.length > 0,
          useEntireBalance: true,
          linkedGoalId: "",
          partialAmount: "",
        };
      }
    });

    setAccountSettings((prev) =>
      areAccountSettingsEqual(prev, nextSettings) ? prev : nextSettings
    );
  }, [open, accounts, assignmentsByAccount]);

  const getAccountSetting = (accountId: string): AccountGoalSetting => {
    return (
      accountSettings[accountId] || {
        enabled: false,
        useEntireBalance: true,
        linkedGoalId: "",
        partialAmount: "",
      }
    );
  };

  const updateAccountSetting = (
    accountId: string,
    updates: Partial<AccountGoalSetting>
  ) => {
    setAccountSettings((prev) => ({
      ...prev,
      [accountId]: { ...getAccountSetting(accountId), ...updates },
    }));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    let hadError = false;

    for (const account of accounts ?? []) {
      const setting = getAccountSetting(account.id);
      const accountAssignments = assignmentsByAccount.get(account.id) ?? [];
      if (accountAssignments.length > 1) continue;

      const existingAssignment = accountAssignments[0];

      // Handle disabled: remove existing assignment if any
      if (!setting.enabled) {
        if (existingAssignment) {
          try {
            await removeAssignment.mutateAsync({
              goalId: existingAssignment.goalId,
              accountId: account.id,
            });
          } catch {
            hadError = true;
          }
        }
        continue;
      }

      // Validate the assignment setting
      const selectedGoal = goalsById.get(setting.linkedGoalId);
      const validation = validateAssignmentSetting(setting, account, selectedGoal);
      if (!validation.valid) {
        toast({
          title: validation.errorTitle,
          description: validation.errorDescription,
          variant: "destructive",
        });
        hadError = true;
        continue;
      }

      const payload = buildAssignmentPayload(setting, account.id, account.currency || "ZMW");

      try {
        if (!existingAssignment) {
          await assignAccount.mutateAsync({
            goalId: setting.linkedGoalId,
            data: payload,
          });
        } else if (existingAssignment.goalId !== setting.linkedGoalId) {
          await removeAssignment.mutateAsync({
            goalId: existingAssignment.goalId,
            accountId: account.id,
          });
          await assignAccount.mutateAsync({
            goalId: setting.linkedGoalId,
            data: payload,
          });
        } else if (needsAssignmentUpdate(existingAssignment, setting)) {
          await updateAssignment.mutateAsync({
            goalId: existingAssignment.goalId,
            accountId: account.id,
            data: payload,
          });
        }
      } catch {
        hadError = true;
      }
    }

    setIsSaving(false);
    if (!hadError) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit goal accounts</DialogTitle>
          <p className="text-sm text-muted-foreground pt-2">
            Turning on an account to use for goals will show the available to
            allocate amount on the goals page. If you make a goal contribution
            from an account, we will automatically turn the account on for you.
          </p>
        </DialogHeader>

        <GoalAccountsList
          groupedAccounts={groupedAccounts}
          getAccountSetting={getAccountSetting}
          assignmentsByAccount={assignmentsByAccount}
          goals={goals ?? []}
          goalsById={goalsById}
          formatCurrency={formatCurrency}
          isSaving={isSaving}
          hasAccounts={hasAccounts}
          updateAccountSetting={updateAccountSetting}
          toast={toast}
        />

        <DialogFooter className="pt-4">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-orange-500 hover:bg-orange-600"
          >
            {isSaving ? "Saving..." : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
