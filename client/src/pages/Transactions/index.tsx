/**
 * Transactions Page
 *
 * Main transactions list with filtering, bulk actions, and detail views.
 * Split into sub-components to stay under 300 LOC limit.
 */

import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { toMoneyNumber } from "@/lib/money";
import { transactionsApi } from "@/lib/api";
import { toast } from "sonner";

import {
  TransactionList,
  TransactionGroupedList,
  BulkActions,
  useTransactionFilters,
  useTransactionSelection,
  useKeyboardShortcuts,
  exportTransactionsToCSV,
  type TransactionWithDetails,
} from "@/features/transactions";

import { useInfiniteTransactions, useUpdateTransaction } from "@/hooks/useTransactions";
import { useImportWizard } from "@/components/import/ImportWizardContext";
import { useProfile } from "@/hooks/use-settings";
import { TransactionSummaryPanel } from "@/components/transactions/TransactionSummaryPanel";

import { TransactionsHeader } from "./TransactionsHeader";
import { TransactionsModals } from "./TransactionsModals";
import { useTransactionBulkMutations } from "./useTransactionMutations";

export default function Transactions() {
  const { openWizard } = useImportWizard();
  const { data: profile } = useProfile();
  // R-08: filters are URL-backed (see features/transactions/transactionFilterParams.ts) -
  // this is the single source of truth for date range too, so DateRangePopover reads/writes
  // filters.startDate/endDate instead of separate local state (previously that local state
  // was never synced with filters, so a date range picked here never round-tripped).
  const { filters, setFilters, resetFilters, activeFilterCount } = useTransactionFilters();
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

  const { data: infiniteData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteTransactions({
      startDate: dateRangeValue.startDate?.toISOString().split("T")[0],
      endDate: dateRangeValue.endDate?.toISOString().split("T")[0],
      limit: 50,
      ownerUserId,
      accountId: filters.accountId || undefined,
      categoryId: filters.categoryId || undefined,
      type: filters.type !== "all" ? filters.type : undefined,
      search: filters.search || undefined,
      amountMin: filters.amountMin ?? undefined,
      amountMax: filters.amountMax ?? undefined,
      reviewed: filters.reviewed !== "all" ? filters.reviewed : undefined,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    });

  const transactions = useMemo(() => {
    if (!infiniteData?.pages) return [];
    return infiniteData.pages.flatMap((page) => page.transactions);
  }, [infiniteData]) as TransactionWithDetails[];

  const selection = useTransactionSelection(transactions);
  const bulkMutations = useTransactionBulkMutations(selection.clearSelection);
  const updateMutation = useUpdateTransaction();

  // Modal states
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithDetails | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleMerchant, setRuleMerchant] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringTransaction, setRecurringTransaction] = useState<TransactionWithDetails | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitTransaction, setSplitTransaction] = useState<TransactionWithDetails | null>(null);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);

  // Handlers
  const handleOpenRule = useCallback((merchant: string, category: string) => {
    setRuleMerchant(merchant); setRuleCategory(category); setShowRuleModal(true); setSelectedTransaction(null);
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

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    if (ids.length > 0 && confirm(`Delete ${ids.length} transactions?`)) bulkMutations.bulkDeleteMutation.mutate(ids);
  }, [selection.selectedIds, bulkMutations]);

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

  // R-09: Fetch summary from server API
  const { data: serverSummary } = useQuery({
    queryKey: ["transactionSummary", dateRangeValue.startDate?.toISOString().split("T")[0],
      dateRangeValue.endDate?.toISOString().split("T")[0], ownerUserId, filters.type, filters.accountId, filters.tagIds.join(",")],
    queryFn: () => transactionsApi.getSummary({
      startDate: dateRangeValue.startDate?.toISOString().split("T")[0] ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      endDate: dateRangeValue.endDate?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
      ownerUserId: ownerUserId,
      type: filters.type !== "all" ? filters.type : undefined,
      accountId: filters.accountId || undefined,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    }),
    staleTime: 30_000,
  });

  const detailStats = useMemo(() => {
    let largestTransaction = 0, largestExpense = 0, firstDate: Date | null = null, lastDate: Date | null = null;
    transactions.forEach((tx) => {
      const amount = toMoneyNumber(tx.amount);
      const [year, month, day] = tx.date.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      if (tx.type === "income" && amount > largestTransaction) largestTransaction = amount;
      else if (tx.type === "expense") { const absAmount = Math.abs(amount); if (absAmount > largestExpense) largestExpense = absAmount; }
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    });
    return { largestTransaction, largestExpense, firstTransactionDate: firstDate ? new Date(firstDate).toISOString() : null, lastTransactionDate: lastDate ? new Date(lastDate).toISOString() : null };
  }, [transactions]);

  const summary = useMemo(() => {
    const income = serverSummary?.totalIncome ? toMoneyNumber(serverSummary.totalIncome) : 0;
    const expenses = serverSummary?.totalExpenses ? toMoneyNumber(serverSummary.totalExpenses) : 0;
    const netFlow = serverSummary?.netFlow ? toMoneyNumber(serverSummary.netFlow) : 0;
    const transactionCount = serverSummary?.transactionCount ?? 0;
    return { income, expenses, netFlow, transactionCount, largestTransaction: detailStats.largestTransaction, largestExpense: detailStats.largestExpense,
      averageTransaction: transactionCount > 0 ? netFlow / transactionCount : 0, firstTransactionDate: detailStats.firstTransactionDate, lastTransactionDate: detailStats.lastTransactionDate };
  }, [serverSummary, detailStats]);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <TransactionsHeader filters={filters} setFilters={setFilters} resetFilters={resetFilters} activeFilterCount={activeFilterCount}
          dateRangeValue={dateRangeValue} setDateRangeValue={setDateRangeValue} groupByDate={groupByDate} setGroupByDate={setGroupByDate}
          summaryCollapsed={summaryCollapsed} setSummaryCollapsed={setSummaryCollapsed} onImport={() => openWizard()} onExport={handleExportCSV} onAddTransaction={() => setShowAddModal(true)} />

        <div className="flex flex-1 gap-6 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0">
            <Card className="flex-1 overflow-hidden">
              {groupByDate ? (
                <TransactionGroupedList transactions={transactions} loading={isLoading || isFetchingNextPage} error={isError ? (error as Error) : null}
                  selectedIds={selection.selectedIds} onSelect={selection.toggleSelection} onClick={setSelectedTransaction}
                  showCheckboxes={selection.hasSelection} onLoadMore={fetchNextPage} hasMore={hasNextPage} />
              ) : (
                <TransactionList transactions={transactions} loading={isLoading || isFetchingNextPage} error={isError ? (error as Error) : null}
                  selectedIds={selection.selectedIds} onSelect={selection.toggleSelection} onClick={setSelectedTransaction}
                  showCheckboxes={selection.hasSelection} onLoadMore={fetchNextPage} hasMore={hasNextPage} />
              )}
            </Card>
          </div>
          <TransactionSummaryPanel income={summary.income} expenses={summary.expenses} netFlow={summary.netFlow} transactionCount={summary.transactionCount}
            largestTransaction={summary.largestTransaction} largestExpense={summary.largestExpense} averageTransaction={summary.averageTransaction}
            firstTransactionDate={summary.firstTransactionDate} lastTransactionDate={summary.lastTransactionDate} isCollapsed={summaryCollapsed} onToggle={() => setSummaryCollapsed(!summaryCollapsed)} />
        </div>

        <BulkActions selectedCount={selection.selectedCount} onClear={selection.clearSelection} onCategorize={() => setShowBulkCategoryModal(true)}
          onTag={() => setShowBulkTagModal(true)} onReview={handleBulkReview} onDelete={handleBulkDelete} />

        <TransactionsModals showAddModal={showAddModal} setShowAddModal={setShowAddModal} selectedTransaction={selectedTransaction}
          setSelectedTransaction={setSelectedTransaction} onUpdateTransaction={handleUpdateTransaction} showRuleModal={showRuleModal}
          setShowRuleModal={setShowRuleModal} ruleMerchant={ruleMerchant} ruleCategory={ruleCategory} showRecurringModal={showRecurringModal}
          setShowRecurringModal={setShowRecurringModal} recurringTransaction={recurringTransaction} showSplitModal={showSplitModal}
          setShowSplitModal={setShowSplitModal} splitTransaction={splitTransaction} setSplitTransaction={setSplitTransaction}
          showBulkCategoryModal={showBulkCategoryModal} setShowBulkCategoryModal={setShowBulkCategoryModal} showBulkTagModal={showBulkTagModal}
          setShowBulkTagModal={setShowBulkTagModal} selectedCount={selection.selectedCount} selectedIds={selection.selectedIds}
          clearSelection={selection.clearSelection} onBulkCategorize={(categoryId) => bulkMutations.bulkCategorizeMutation.mutate({ ids: Array.from(selection.selectedIds), categoryId })}
          onBulkTag={(tagIds) => bulkMutations.bulkTagMutation.mutate({ ids: Array.from(selection.selectedIds), tagIds })}
          isBulkCategorizePending={bulkMutations.bulkCategorizeMutation.isPending} isBulkTagPending={bulkMutations.bulkTagMutation.isPending}
          onOpenRule={handleOpenRule} onOpenRecurring={handleOpenRecurring} onOpenSplit={(tx) => { setSplitTransaction(tx); setShowSplitModal(true); }} />
      </div>
    </Layout>
  );
}
