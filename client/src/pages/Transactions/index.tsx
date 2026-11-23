import { formatDateParam } from "@/features/transactions/transactionFilterParams";
/**
 * Transactions Page
 *
 * Main transactions list with filtering, bulk actions, and detail views.
 * Split into sub-components to stay under 300 LOC limit.
 */

import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearch } from "wouter";
import { addDays } from "date-fns";
import Decimal from "decimal.js";
import { isParsableMoneyString } from "@/lib/money";
import type { ApiError, MoneyDto } from "@/lib/api";
import { toast } from "sonner";

import {
  TransactionList,
  TransactionGroupedList,
  BulkActions,
  useTransactionFiltersWithPresets,
  useTransactionSelection,
  useKeyboardShortcuts,
  exportTransactionsToCSV,
  type TransactionWithDetails,
} from "@/features/transactions";

import { useTransactionSummary, useInfiniteTransactions, useUpdateTransaction } from "@/hooks/useTransactions";
import { useImportWizard } from "@/components/import/ImportWizardContext";
import { useProfile } from "@/hooks/use-settings";
import { TransactionSummaryPanel } from "@/components/transactions/TransactionSummaryPanel";

import { TransactionsHeader } from "./TransactionsHeader";
import { TransactionsModals } from "./TransactionsModals";
import { TransferAccountNamesProvider } from "@/features/transactions/transferLeg";
import { useTransactionBulkMutations } from "./useTransactionMutations";
import { useBulkDeleteConfirm } from "./useBulkDeleteConfirm";

const SummaryDecimal = Decimal.clone({ precision: 40 });

export default function Transactions() {
  const { openWizard } = useImportWizard();
  const { data: profile, error: profileError } = useProfile();
  // R-08: filters are URL-backed (see features/transactions/transactionFilterParams.ts) -
  // this is the single source of truth for date range too, so DateRangePopover reads/writes
  // filters.startDate/endDate instead of separate local state (previously that local state
  // was never synced with filters, so a date range picked here never round-tripped).
  // R11: the saved default preset is applied on load and by reset.
  const { filters, setFilters, resetFilters, applyFilters, activeFilterCount } = useTransactionFiltersWithPresets();
  const urlSearch = useSearch();

  // UI state
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [groupByDate, setGroupByDate] = useState(false);

  const dateRangeValue = useMemo(
    () => ({
      startDate: filters.startDate ?? undefined,
      endDate: filters.endDate ?? undefined,
    }),
    [filters.startDate, filters.endDate],
  );
  const setDateRangeValue = useCallback(
    (range: { startDate: Date | undefined; endDate: Date | undefined }) => {
      setFilters({ startDate: range.startDate ?? null, endDate: range.endDate ?? null });
    },
    [setFilters],
  );

  // A cross-section deep-link (e.g. AccountDetail's "Add transaction" button)
  // can carry `?action=add` to open the Add Transaction modal pre-filtered to
  // that account. This is a one-time navigation intent, not a filter, so it
  // is consumed once on mount rather than living in the filter contract.
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    if (params.get("action") === "add") {
      setShowAddModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R-08: Derive ownerUserId from filters.owner
  const ownerUserId = useMemo(() => {
    if (filters.owner === "mine") return profile?.id ?? undefined;
    if (filters.owner === "shared") return null;
    return undefined;
  }, [filters.owner, profile?.id]);

  const ownerReady = filters.owner !== "mine" || !!profile?.id;
  const summaryFilters = {
    ownerUserId,
    accountId: filters.accountId || undefined,
    categoryId: filters.categoryId || undefined,
    type: filters.type !== "all" ? filters.type : undefined,
    search: filters.search || undefined,
    amountMin: filters.amountMin ?? undefined,
    amountMax: filters.amountMax ?? undefined,
    reviewed: filters.reviewed !== "all" ? filters.reviewed : undefined,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
  };

  const { data: infiniteData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteTransactions({
      startDate: formatDateParam(dateRangeValue.startDate),
      endDate: formatDateParam(dateRangeValue.endDate),
      limit: 50,
      ...summaryFilters,
    }, ownerReady);

  const transactions = useMemo(() => {
    if (!ownerReady || !infiniteData?.pages) return [];
    return infiniteData.pages.flatMap((page) => page.transactions);
  }, [infiniteData, ownerReady]) as TransactionWithDetails[];

  const selection = useTransactionSelection(transactions);
  const bulkMutations = useTransactionBulkMutations(selection.clearSelection);
  const updateMutation = useUpdateTransaction();

  // Modal states
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithDetails | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleMerchant, setRuleMerchant] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringTransaction, setRecurringTransaction] = useState<TransactionWithDetails | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitTransaction, setSplitTransaction] = useState<TransactionWithDetails | null>(null);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);

  // Handlers
  const handleOpenRule = useCallback((merchant: string, categoryId: string | null, categoryName: string) => {
    setRuleMerchant(merchant); setRuleCategoryId(categoryId); setRuleCategory(categoryName); setShowRuleModal(true); setSelectedTransaction(null);
  }, []);

  const handleOpenRecurring = useCallback((tx: TransactionWithDetails) => {
    setRecurringTransaction(tx); setShowRecurringModal(true); setSelectedTransaction(null);
  }, []);

  const handleUpdateTransaction = useCallback((id: string, updates: Record<string, unknown>) => {
    updateMutation.mutate({ id, data: updates });
    if (selectedTransaction?.id === id) setSelectedTransaction((prev) => prev ? { ...prev, ...updates } : null);
  }, [updateMutation, selectedTransaction?.id]);

  const handleBulkReview = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    if (ids.length > 0) bulkMutations.bulkReviewMutation.mutate(ids);
  }, [selection.selectedIds, bulkMutations]);

  const bulkDelete = useBulkDeleteConfirm(selection.selectedIds, (ids) => bulkMutations.bulkDeleteMutation.mutate(ids));
  const handleBulkDelete = bulkDelete.request;

  const handleExportCSV = useCallback(() => {
    if (transactions.length === 0) { toast.info("No transactions to export"); return; }
    exportTransactionsToCSV(transactions);
    toast.success(`Exported ${transactions.length} transactions`);
  }, [transactions]);

  const handleFocusSearch = useCallback(() => {
    const searchInput = document.querySelector("[data-search-input]") as HTMLInputElement | null;
    searchInput?.focus();
  }, []);

  useKeyboardShortcuts({
    onAddTransaction: () => setShowAddModal(true),
    onSearch: handleFocusSearch,
    onExport: handleExportCSV,
    onSelectAll: () => selection.selectAll(),
    onClearSelection: () => selection.clearSelection(),
    onDelete: handleBulkDelete,
    onEscape: () => {
      if (selectedTransaction) setSelectedTransaction(null);
      else if (selection.selectedCount > 0) selection.clearSelection();
    },
  });

  const { startDate, endDate } = dateRangeValue;
  const today = new Date();
  const summaryStart = formatDateParam(startDate ?? addDays(endDate ?? today, -30))!;
  const summaryEnd = formatDateParam(endDate ?? (startDate ? addDays(startDate, 30) : today))!;
  const { data: serverSummary, isPending: summaryPending, isFetching: summaryFetching,
    isError: summaryFailed, error: summaryFailure } = useTransactionSummary(summaryStart, summaryEnd, summaryFilters, ownerReady);
  const summaryLoading = ownerReady ? summaryPending || summaryFetching : !profileError;
  const summary = useMemo(() => {
    // A failed refetch retains data in TanStack Query. Withhold that old receipt
    // until the current request has established these totals again.
    if (!ownerReady || summaryLoading || summaryFailed || !serverSummary) return undefined;
    const currency = serverSummary.totalIncome?.currency;
    const totals = [serverSummary.totalIncome, serverSummary.totalExpenses, serverSummary.netFlow];
    if (!currency || !totals.every(value => value?.currency === currency && isParsableMoneyString(value.amount))
      || !Number.isSafeInteger(serverSummary.transactionCount) || serverSummary.transactionCount < 0) return undefined;
    const amount = (value: MoneyDto | null | undefined) => value === null ? null
      : value?.currency === currency && isParsableMoneyString(value.amount) ? value.amount : undefined;
    const transactionCount = serverSummary.transactionCount;
    return { currency, income: serverSummary.totalIncome.amount, expenses: serverSummary.totalExpenses.amount,
      netFlow: serverSummary.netFlow.amount, transactionCount,
      largestTransaction: amount(serverSummary.largestIncome), largestExpense: amount(serverSummary.largestExpense),
      averageTransaction: transactionCount > 0
        ? new SummaryDecimal(serverSummary.netFlow.amount).dividedBy(transactionCount).toFixed(2) : null,
      firstTransactionDate: serverSummary.firstTransactionDate, lastTransactionDate: serverSummary.lastTransactionDate };
  }, [serverSummary, summaryLoading, summaryFailed, ownerReady]);
  const listLoading = ownerReady ? isLoading || isFetchingNextPage : !profileError;
  const listError = !ownerReady ? profileError : isError ? error : null;
  const summaryError = !ownerReady && profileError ? "Unable to identify the owner of these transactions." : summaryFailed
    ? (summaryFailure as ApiError)?.code === "FINANCIAL_DATA_UNAVAILABLE" ? summaryFailure?.message : "Unable to load transaction totals. Try refreshing."
    : !summaryLoading && !summary ? "Transaction totals could not be verified." : undefined;

  return (
    <Layout>
      <TransferAccountNamesProvider isEnabled={transactions.some((transaction) => transaction.type === "transfer")}>
      <div className="flex flex-col h-full">
        <TransactionsHeader filters={filters} setFilters={setFilters} resetFilters={resetFilters} applyFilters={applyFilters} activeFilterCount={activeFilterCount}
          dateRangeValue={dateRangeValue} setDateRangeValue={setDateRangeValue} groupByDate={groupByDate} setGroupByDate={setGroupByDate}
          summaryCollapsed={summaryCollapsed} setSummaryCollapsed={setSummaryCollapsed} onImport={() => openWizard()} onExport={handleExportCSV} onAddTransaction={() => setShowAddModal(true)} />

        <div className="flex flex-1 flex-col gap-6 md:flex-row md:overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0">
            {/* Below md the column stacks and the page scrolls, so the virtualized list needs its own height. */}
            <Card className="flex-1 overflow-hidden max-md:h-[70dvh] max-md:flex-none">
              {groupByDate ? (
                <TransactionGroupedList transactions={transactions} loading={listLoading} error={listError}
                  selectedIds={selection.selectedIds} onSelect={selection.toggleSelection} onClick={setSelectedTransaction}
                  showCheckboxes={selection.hasSelection} onLoadMore={fetchNextPage} hasMore={hasNextPage} />
              ) : (
                <TransactionList transactions={transactions} loading={listLoading} error={listError}
                  selectedIds={selection.selectedIds} onSelect={selection.toggleSelection} onClick={setSelectedTransaction}
                  showCheckboxes={selection.hasSelection} onLoadMore={fetchNextPage} hasMore={hasNextPage} />
              )}
            </Card>
          </div>
          <TransactionSummaryPanel period={`${summaryStart} – ${summaryEnd}`} income={summary?.income} expenses={summary?.expenses} netFlow={summary?.netFlow} transactionCount={summary?.transactionCount}
            currency={summary?.currency} isLoading={summaryLoading} error={summaryError}
            largestTransaction={summary?.largestTransaction} largestExpense={summary?.largestExpense} averageTransaction={summary?.averageTransaction}
            firstTransactionDate={summary?.firstTransactionDate} lastTransactionDate={summary?.lastTransactionDate} isCollapsed={summaryCollapsed} onToggle={() => setSummaryCollapsed(!summaryCollapsed)} className="max-md:static max-md:w-full" />
        </div>

        <BulkActions selectedCount={selection.selectedCount} onClear={selection.clearSelection} onCategorize={() => setShowBulkCategoryModal(true)}
          onTag={() => setShowBulkTagModal(true)} onReview={handleBulkReview} onDelete={handleBulkDelete} />
        {bulkDelete.dialog}

        <TransactionsModals showAddModal={showAddModal} setShowAddModal={setShowAddModal} selectedTransaction={selectedTransaction}
          setSelectedTransaction={setSelectedTransaction} onUpdateTransaction={handleUpdateTransaction} showRuleModal={showRuleModal}
          setShowRuleModal={setShowRuleModal} ruleMerchant={ruleMerchant} ruleCategory={ruleCategory} ruleCategoryId={ruleCategoryId} showRecurringModal={showRecurringModal}
          setShowRecurringModal={setShowRecurringModal} recurringTransaction={recurringTransaction} showSplitModal={showSplitModal}
          setShowSplitModal={setShowSplitModal} splitTransaction={splitTransaction} setSplitTransaction={setSplitTransaction}
          showBulkCategoryModal={showBulkCategoryModal} setShowBulkCategoryModal={setShowBulkCategoryModal} showBulkTagModal={showBulkTagModal}
          setShowBulkTagModal={setShowBulkTagModal} selectedCount={selection.selectedCount} selectedIds={selection.selectedIds}
          clearSelection={selection.clearSelection} onBulkCategorize={(categoryId) => bulkMutations.bulkCategorizeMutation.mutate({ ids: Array.from(selection.selectedIds), categoryId })}
          onBulkTag={(tagIds) => bulkMutations.bulkTagMutation.mutate({ ids: Array.from(selection.selectedIds), tagIds })}
          isBulkCategorizePending={bulkMutations.bulkCategorizeMutation.isPending} isBulkTagPending={bulkMutations.bulkTagMutation.isPending}
          onOpenRule={handleOpenRule} onOpenRecurring={handleOpenRecurring} onOpenSplit={(tx) => { setSplitTransaction(tx); setShowSplitModal(true); }} />
      </div>
      </TransferAccountNamesProvider>
    </Layout>
  );
}
