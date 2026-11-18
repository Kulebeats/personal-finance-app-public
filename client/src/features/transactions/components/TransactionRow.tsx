/**
 * Transaction Row Component
 *
 * Single transaction row for list view.
 * Displays amount, merchant, category, date with actions.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import { format, parseISO } from "date-fns";
import { CheckCircle2, AlertCircle, Tag } from "lucide-react";
import type { TransactionWithDetails } from "../types";
import { SplitDetails } from "./SplitDetails";

interface TransactionRowProps {
  transaction: TransactionWithDetails;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onClick: (transaction: TransactionWithDetails) => void;
  showCheckbox?: boolean;
}

export const TransactionRow = memo(function TransactionRow({
  transaction,
  isSelected,
  onSelect,
  onClick,
  showCheckbox = false,
}: TransactionRowProps) {
  // Use type field to determine income/expense, not sign inference (T-02 fix)
  const isIncome = transaction.type === "income";
  const displayName = transaction.merchantName || transaction.name || "Unknown";
  const displayCategory = transaction.categoryName || "Uncategorized";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View ${displayName}, ${formatCurrency(transaction.amount)}`}
      className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer border-b border-border/30 transition-colors",
        isSelected && "bg-primary/5",
      )}
      onClick={() => onClick(transaction)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(transaction);
        }
      }}
    >
      {/* Checkbox */}
      {showCheckbox && (
        <input
          type="checkbox"
          aria-label={`Select ${displayName}`}
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(transaction.id);
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-border"
        />
      )}

      {/* Icon */}
      <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center text-lg font-medium border">
        {displayName[0]?.toUpperCase() || "?"}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{displayName}</span>
          {transaction.isRecurring && (
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
              Recurring
            </span>
          )}
          {transaction.splits && transaction.splits.length > 0 && (
            <SplitDetails splits={transaction.splits} variant="badge" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{displayCategory}</span>
          {transaction.tags && transaction.tags.length > 0 && (
            <>
              <span aria-hidden="true">|</span>
              <div className="flex items-center gap-1">
                <Tag className="h-3 w-3" aria-hidden="true" />
                <span>{transaction.tags.length}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Date - use parseISO to avoid timezone off-by-one bugs */}
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {format(parseISO(transaction.date), "MMM d, yyyy")}
      </div>

      {/* Amount - formatCurrency handles MoneyDto directly */}
      <div
        className={cn(
          "text-sm font-semibold tabular-nums w-24 text-right",
          isIncome ? "text-green-600 dark:text-green-400" : "text-foreground",
        )}
      >
        {isIncome ? "+" : ""}
        {formatCurrency(transaction.amount)}
      </div>

      {/* Status */}
      <div className="w-8 flex justify-center">
        {transaction.reviewedAt ? (
          <CheckCircle2
            className="h-4 w-4 text-green-500 dark:text-green-400"
            aria-label="Reviewed"
          />
        ) : (
          <AlertCircle
            className="h-4 w-4 text-amber-500 dark:text-amber-400"
            aria-label="Needs review"
          />
        )}
      </div>
    </div>
  );
});
