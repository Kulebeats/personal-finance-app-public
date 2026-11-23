/**
 * Transactions Feature Module Index
 *
 * Central exports for the transactions feature.
 *
 * @module features/transactions
 */

// Types
export * from "./types";

// Components
export { TransactionRow } from "./components/TransactionRow";
export { TransactionCard } from "./components/TransactionCard";
export { TransactionList } from "./components/TransactionList";
export { TransactionGroupedList } from "./components/TransactionGroupedList";
export { TransactionDateHeader } from "./components/TransactionDateHeader";
export { TransactionRowSkeleton } from "./components/TransactionRowSkeleton";
export { TransactionSearch } from "./components/TransactionSearch";
export { TransactionFiltersPanel } from "./components/TransactionFiltersPanel";
export { AdvancedFilterPopover } from "./components/AdvancedFilterPopover";
export { TransactionDetailModal } from "./components/TransactionDetailModal";
export { SplitTransactionModal } from "./components/SplitTransactionModal";
export { SplitDetails } from "./components/SplitDetails";
export { RuleCreationModal } from "./components/RuleCreationModal";
export { RecurringModal } from "./components/RecurringModal";
export { BulkActions } from "./components/BulkActions";
export { BulkCategoryPickerModal } from "./components/BulkCategoryPickerModal";
export { BulkTagPickerModal } from "./components/BulkTagPickerModal";
export { FilterPresetSelector } from "./components/FilterPresetSelector";

// Hooks
export { useTransactionsQuery } from "./hooks/useTransactionsQuery";
export { useTransactionMutations } from "./hooks/useTransactionMutations";
export { useTransactionFilters } from "./hooks/useTransactionFilters";
export { useTransactionFiltersWithPresets } from "./hooks/useTransactionFiltersWithPresets";
export { useTransactionSelection } from "./hooks/useTransactionSelection";
export {
  useKeyboardShortcuts,
  KEYBOARD_SHORTCUTS,
} from "./hooks/useKeyboardShortcuts";
export {
  useFilterPresets,
  useDefaultFilterPreset,
  useCreateFilterPreset,
  useUpdateFilterPreset,
  useDeleteFilterPreset,
  filterPresetKeys,
  type FilterPreset,
} from "./hooks/useFilterPresets";

// Utils
export * from "./utils/formatters";
export * from "./utils/filters";
export { exportTransactionsToCSV, duplicateTransaction } from "./utils/export";

// URL filter contract (R8) - use these to deep-link into a filtered
// Transactions view instead of hand-building query strings.
export {
  TRANSACTION_FILTER_PARAM_KEYS,
  TRANSACTIONS_PATH,
  buildTransactionsUrl,
  parseTransactionFilterParams,
  serializeTransactionFilterParams,
} from "./transactionFilterParams";
