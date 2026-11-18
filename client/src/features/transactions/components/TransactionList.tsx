/**
 * Transaction List Component
 *
 * Virtualized list for efficient rendering of large transaction lists.
 * Uses @tanstack/react-virtual for virtualization.
 */

import { useRef, useEffect } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { TransactionRow } from "./TransactionRow";
import { TransactionCard } from "./TransactionCard";
import { TransactionRowSkeleton } from "./TransactionRowSkeleton";
import type { TransactionWithDetails, TransactionViewMode } from "../types";
import { Loader2, Receipt } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

interface TransactionListProps {
  transactions: TransactionWithDetails[];
  loading?: boolean;
  error?: Error | null;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onClick: (transaction: TransactionWithDetails) => void;
  viewMode?: TransactionViewMode;
  showCheckboxes?: boolean;
  emptyMessage?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  /** Optional callback to add a new transaction */
  onAddTransaction?: () => void;
}

export function TransactionList({
  transactions,
  loading = false,
  error = null,
  selectedIds,
  onSelect,
  onClick,
  viewMode = "list",
  showCheckboxes = false,
  emptyMessage = "No transactions found",
  onLoadMore,
  hasMore = false,
  onAddTransaction,
}: TransactionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtualizer for list view
  const rowVirtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (viewMode === "list" ? 64 : 120),
    overscan: 5,
  });

  // Handle scroll to bottom for infinite loading
  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];

  // FIX PERF-TRANSACTIONS-001: Move onLoadMore to useEffect to prevent infinite loop
  useEffect(() => {
    if (
      lastItem &&
      lastItem.index >= transactions.length - 5 &&
      hasMore &&
      onLoadMore &&
      !loading
    ) {
      onLoadMore();
    }
  }, [lastItem, hasMore, onLoadMore, loading, transactions.length]);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-destructive text-lg font-medium mb-2">
          Error loading transactions
        </div>
        <div className="text-sm text-muted-foreground">{error.message}</div>
      </div>
    );
  }

  // Empty state (only show if not loading)
  if (!loading && transactions.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title={emptyMessage}
        description="Try adjusting your filters or add a new transaction."
        primaryAction={
          onAddTransaction
            ? { label: "Add Transaction", onClick: onAddTransaction }
            : undefined
        }
        testId="transactions-empty-state"
      />
    );
  }

  // Initial loading state - show skeleton
  if (loading && transactions.length === 0) {
    return <TransactionRowSkeleton count={8} />;
  }

  // Grid view for cards
  if (viewMode === "card") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        {transactions.map((tx) => (
          <TransactionCard
            key={tx.id}
            transaction={tx}
            isSelected={selectedIds.has(tx.id)}
            onSelect={onSelect}
            onClick={onClick}
          />
        ))}
        {loading && (
          <div
            className="col-span-full flex justify-center py-4"
            aria-live="polite"
            role="status"
          >
            <span className="sr-only">Loading more transactions</span>
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    );
  }

  // Virtualized list view
  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem: VirtualItem) => {
          const tx = transactions[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TransactionRow
                transaction={tx}
                isSelected={selectedIds.has(tx.id)}
                onSelect={onSelect}
                onClick={onClick}
                showCheckbox={showCheckboxes}
              />
            </div>
          );
        })}
      </div>
      {loading && (
        <div
          className="flex justify-center py-4"
          aria-live="polite"
          role="status"
        >
          <span className="sr-only">Loading more transactions</span>
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
