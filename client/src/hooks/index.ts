/**
 * Hooks exports
 *
 * Central export for all custom hooks.
 */

// Account hooks
export {
  useAccounts,
  useAccount,
  useNetWorthSummary,
  useAccountBalanceHistory,
  useNetWorthHistory,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  useAdjustBalance,
  useArchiveAccount,
  useUpdateAccountSettings,
  useImportBalanceHistory,
  useImportTransactions,
  useExportTransactions,
  useExportBalanceHistory,
  useExportAccountsSummary,
  accountKeys,
} from "./useAccounts";

// Transaction hooks
export {
  useTransactions,
  useInfiniteTransactions,
  useTransaction,
  useTransactionSummary,
  useCreateTransaction,
  useCreateTransfer,
  useUpdateTransaction,
  useDeleteTransaction,
  useCurrentMonthSummary,
  transactionKeys,
} from "./useTransactions";

// Budget hooks
export {
  useBudgets,
  useBudgetProgress,
  useBudgetAlerts,
  useBudgetSettings,
  useUpdateBudgetSettings,
  useBudgetForecast,
  useUpdateBudgetForecast,
  useRecalculateBudgets,
  useClearBudgets,
  useMoveBudgetAmount,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  useCurrentMonthBudgets,
  budgetKeys,
} from "./useBudgets";

// Goal hooks
export {
  useGoals,
  useGoal,
  useGoalsSummary,
  useGoalProjection,
  useGoalContributions,
  useGoalAssignments,
  useGoalAssignmentsAll,
  useAvailableFunds,
  useGoalTransfers,
  useGoalTransfersForGoal,
  useGoalTransactions,
  useGoalActivity,
  useCreateGoal,
  useUpdateGoal,
  useAddContribution,
  useAssignAccount,
  useUpdateAssignment,
  useRemoveAssignment,
  useAssignAccountForGoal,
  useUpdateAssignmentForGoal,
  useRemoveAssignmentForGoal,
  useTransferBetweenGoals,
  useLinkTransaction,
  useUnlinkTransaction,
  useCompleteGoal,
  useArchiveGoal,
  useDeleteGoal,
  useCalculatePayoff,
  usePayoffScenarios,
  useDebtStrategy,
  goalKeys,
} from "./useGoals";

// Recurring hooks
export {
  useRecurring,
  useRecurringRule,
  useUpcomingBills,
  useCreateRecurring,
  useCreateRecurringTransaction,
  useCreateRecurringForTransaction,
  useUpdateRecurring,
  useSkipRecurring,
  usePauseRecurring,
  useProcessRecurring,
  useDeleteRecurring,
  recurringKeys,
} from "./useRecurring";

// Tag hooks
export {
  useTags,
  useTag,
  useTagTransactions,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useMergeTags,
  useArchiveTag,
  useTagAnalytics,
  useTransactionTags,
  useAddTagsToTransaction,
  useSetTransactionTags,
  useRemoveTagFromTransaction,
  tagKeys,
} from "./useTags";
