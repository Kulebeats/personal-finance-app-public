import { useMemo } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import {
  useGoal,
  useGoals,
  useGoalContributions,
  useGoalAssignments,
  useGoalTransfersForGoal,
  useGoalActivity,
  useGoalTransactions,
  useAssignAccount,
  usePayoffScenarios,
  useCalculatePayoff,
  useUnlinkTransaction,
  useDebtStrategy,
  type PayoffScenario,
} from "@/hooks/useGoals";
import { parseMoney } from "@/lib/utils";
import type { ScenarioKey } from "../GoalDetailTypes";

function parseAmount(value?: string | number | null) {
  return parseMoney(value);
}

export interface UseGoalDetailDataProps {
  goalId: string;
  open: boolean;
}

export function useGoalDetailData({ goalId, open }: UseGoalDetailDataProps) {
  // Core goal data
  const { data: goal, isLoading } = useGoal(open ? goalId : "");
  const { data: assignments = [] } = useGoalAssignments(open ? goalId : "");
  const { data: transfers = [] } = useGoalTransfersForGoal(open ? goalId : "");
  const { data: activity = [] } = useGoalActivity(open ? goalId : "", {
    limit: 20,
  });
  const { data: contributions = [] } = useGoalContributions(open ? goalId : "");
  const { data: goalTransactions = [] } = useGoalTransactions(
    open ? goalId : ""
  );

  // Pay Down Data
  const { data: payDownGoals = [] } = useGoals({
    type: "pay_down",
    includeArchived: false,
    includeCompleted: true,
  });

  const { data: accounts = [] } = useAccounts({
    includeArchived: false,
    includeHidden: false,
  });

  // Payment transactions for debt goals
  const debtAccountId =
    goal?.type === "pay_down" ? goal.debtAccountId ?? "" : "";
  const { data: paymentTransactionsData, isLoading: paymentsLoading } =
    useTransactions(
      debtAccountId
        ? {
            accountId: debtAccountId,
            limit: 50,
            type: "transfer",
          }
        : undefined,
      { enabled: !!debtAccountId && open }
    );

  // Mutations
  const assignAccount = useAssignAccount(goalId);
  const unlinkTransaction = useUnlinkTransaction(goalId);

  // Scenarios
  const isPayDownGoal = goal?.type === "pay_down";
  const payoffScenarios = usePayoffScenarios(
    open && isPayDownGoal ? goalId : ""
  );
  const calculatePayoff = useCalculatePayoff(goalId);
  const debtStrategy = useDebtStrategy();

  // Derived values
  const goalCurrency = goal?.currency ?? "ZMW";
  const usesHoldings =
    goal?.type === "investment" && goal.progressSource === "holdings";
  const usesContributionSource =
    goal?.type === "investment" && goal.progressSource === "contributions";

  const filteredAccounts = useMemo(
    () => accounts.filter((account) => account.currency === goalCurrency),
    [accounts, goalCurrency]
  );

  const payDownGoalMap = useMemo(() => {
    const map = new Map<string, (typeof payDownGoals)[number]>();
    payDownGoals.forEach((item) => map.set(item.id, item));
    return map;
  }, [payDownGoals]);

  // Amount calculations
  const targetAmount = goal ? parseAmount(goal.targetAmount) : 0;
  const currentAmount = goal ? parseAmount(goal.currentAmount) : 0;
  const progressAmount = goal
    ? goal.type === "pay_down"
      ? Math.max(0, targetAmount - currentAmount)
      : Math.min(targetAmount, currentAmount)
    : 0;

  const remainingAmount = goal
    ? goal.type === "pay_down"
      ? Math.max(0, currentAmount)
      : Math.max(0, targetAmount - currentAmount)
    : 0;

  const percentComplete =
    targetAmount > 0 ? Math.round((progressAmount / targetAmount) * 100) : 0;

  const hasAutoSyncAssignments = assignments.some(
    (assignment) =>
      assignment.assignmentType === "full_balance" && assignment.autoUpdate
  );

  // Debt strategy inputs
  const debtInputs = useMemo(
    () =>
      payDownGoals
        .filter((item) => item.interestRate && item.minimumPayment)
        .map((item) => ({
          id: item.id,
          balance: Math.abs(parseAmount(item.currentAmount)),
          rate: parseAmount(item.interestRate),
          minPayment: parseAmount(item.minimumPayment),
        }))
        .filter((item) => item.balance > 0 && item.minPayment >= 0),
    [payDownGoals]
  );

  const canRunStrategies = debtInputs.length >= 2;

  // Scenario keys
  const availableScenarioKeys = useMemo<ScenarioKey[]>(() => {
    const keys: ScenarioKey[] = [
      "minimum",
      "current",
      "accelerated",
      "aggressive",
    ];
    if (payoffScenarios.data?.custom || calculatePayoff.data) {
      keys.push("custom");
    }
    return keys;
  }, [payoffScenarios.data, calculatePayoff.data]);

  const scenarioLabels: Record<ScenarioKey, string> = {
    minimum: "Minimum",
    current: "Current",
    accelerated: "Accelerated",
    aggressive: "Aggressive",
    custom: "Custom",
  };

  const scenarioDescriptions: Record<ScenarioKey, string> = {
    minimum: "Minimum payment only",
    current: "Your current monthly payment",
    accelerated: "1.5x minimum payment",
    aggressive: "2x minimum payment",
    custom: "Custom payment scenario",
  };

  // Permission flags
  const contributionEnabled =
    goal?.type === "save_up" || usesContributionSource;
  const canContribute = contributionEnabled && !hasAutoSyncAssignments;
  const canLinkTransactions = contributionEnabled && !hasAutoSyncAssignments;

  const disableFullBalanceAssignment =
    goal?.type === "save_up" && !!goal.spendingReducesProgress;

  const linkDisabledReason =
    goal?.type === "investment" && !usesContributionSource
      ? "Linking is only available for investment goals tracked by contributions."
      : goal?.type !== "save_up" && !usesContributionSource
      ? "Linking is only available for Save Up goals."
      : hasAutoSyncAssignments
      ? "Linking is disabled for goals with auto-synced accounts."
      : null;

  const transferDisabled = !!(
    goal?.isCompleted || goal?.status === "completed" || goal?.isArchived
  );
  const transferDisabledReason = transferDisabled
    ? "Transfers are disabled for completed or archived goals."
    : null;

  // Transaction lists
  const linkedTransactionIds = useMemo(
    () => new Set(goalTransactions.map((item) => item.transactionId)),
    [goalTransactions]
  );

  const paymentTransactions = useMemo(() => {
    const list = paymentTransactionsData?.transactions ?? [];
    return list
      .filter((transaction) => transaction.isTransferIn)
      .map((transaction) => ({
        id: transaction.id,
        name: transaction.name,
        date: transaction.date,
        amount: transaction.amount,
      }));
  }, [paymentTransactionsData]);

  return {
    // Loading state
    isLoading,
    paymentsLoading,

    // Core data
    goal,
    assignments,
    transfers,
    activity,
    contributions,
    goalTransactions,

    // Accounts
    accounts,
    filteredAccounts,

    // Pay down specific
    payDownGoals,
    payDownGoalMap,
    debtAccountId,
    paymentTransactions,
    debtInputs,
    canRunStrategies,
    isPayDownGoal,

    // Amount calculations
    targetAmount,
    currentAmount,
    progressAmount,
    remainingAmount,
    percentComplete,
    goalCurrency,

    // Goal type flags
    usesHoldings,
    usesContributionSource,
    hasAutoSyncAssignments,

    // Permission flags
    contributionEnabled,
    canContribute,
    canLinkTransactions,
    disableFullBalanceAssignment,
    linkDisabledReason,
    transferDisabled,
    transferDisabledReason,

    // Transaction linking
    linkedTransactionIds,

    // Scenarios
    payoffScenarios,
    calculatePayoff,
    availableScenarioKeys,
    scenarioLabels,
    scenarioDescriptions,

    // Mutations
    assignAccount,
    unlinkTransaction,
    debtStrategy,
  };
}

export type GoalDetailData = ReturnType<typeof useGoalDetailData>;

export function getScenarioData(
  scenarioKey: ScenarioKey,
  payoffScenarios: ReturnType<typeof usePayoffScenarios>,
  calculatePayoff: ReturnType<typeof useCalculatePayoff>
): PayoffScenario | null {
  if (scenarioKey === "custom") {
    return calculatePayoff.data ?? payoffScenarios.data?.custom ?? null;
  }
  return payoffScenarios.data
    ? payoffScenarios.data[scenarioKey] ?? null
    : null;
}
