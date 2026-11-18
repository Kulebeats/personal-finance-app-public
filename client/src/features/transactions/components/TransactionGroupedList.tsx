/**
 * Transaction Grouped List Component
 *
 * Non-virtualized list with transactions grouped by date.
 * Use for smaller datasets or when grouping is more important than performance.
 */

import { useMemo } from "react";
import { parseISO, format } from "date-fns";
import { TransactionRow } from "./TransactionRow";
import { TransactionDateHeader } from "./TransactionDateHeader";
import { TransactionRowSkeleton } from "./TransactionRowSkeleton";
import type { TransactionWithDetails } from "../types";
import { Loader2 } from "lucide-react";

interface TransactionGroupedListProps {
  transactions: TransactionWithDetails[];
  loading?: boolean;
  error?: Error | null;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onClick: (transaction: TransactionWithDetails) => void;
  showCheckboxes?: boolean;
  emptyMessage?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

interface DateGroup {
  date: string;
  transactions: TransactionWithDetails[];
}

function groupByDate(transactions: TransactionWithDetails[]): DateGroup[] {
  const groups = new Map<string, TransactionWithDetails[]>();

  for (const tx of transactions) {
    // Extract just the date portion (YYYY-MM-DD) for grouping
    const date = format(parseISO(tx.date), "yyyy-MM-dd");
    const existing = groups.get(date) ?? [];
    existing.push(tx);
    groups.set(date, existing);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // Sort dates descending
    .map(([date, txs]) => ({ date, transactions: txs }));
}

export function TransactionGroupedList({
  transactions,
  loading = false,
  error = null,
  selectedIds,
  onSelect,
  onClick,
  showCheckboxes = false,
  emptyMessage = "No transactions found",
  onLoadMore,
  hasMore = false,
}: Readonly<TransactionGroupedListProps>) {
  const groups = useMemo(() => groupByDate(transactions), [transactions]);

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

  // Initial loading state
  if (loading && transactions.length === 0) {
    return <TransactionRowSkeleton count={8} />;
  }

  // Empty state
  if (!loading && transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-muted-foreground text-lg font-medium mb-2">
          {emptyMessage}
        </div>
        <div className="text-sm text-muted-foreground">
          Try adjusting your filters or add a new transaction.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {groups.map((group) => (
        <div key={group.date}>
          <TransactionDateHeader date={group.date} />
          {group.transactions.map((tx) => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              isSelected={selectedIds.has(tx.id)}
              onSelect={onSelect}
              onClick={onClick}
              showCheckbox={showCheckboxes}
            />
          ))}
        </div>
      ))}

      {/* Load more trigger */}
      {hasMore && (
        <div className="flex justify-center py-4">
          {loading ? (
            <div aria-live="polite" role="status">
              <span className="sr-only">Loading more transactions</span>
              <Loader2
                className="h-6 w-6 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          ) : (
            <button
              onClick={onLoadMore}
              className="text-sm text-primary hover:underline"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
