/**
 * Transaction Card Component
 *
 * Card layout for mobile/grid view.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import { format, parseISO } from "date-fns";
import { CheckCircle2, AlertCircle, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TransactionWithDetails } from "../types";

interface TransactionCardProps {
  transaction: TransactionWithDetails;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onClick: (transaction: TransactionWithDetails) => void;
}

export const TransactionCard = memo(function TransactionCard({
  transaction,
  isSelected,
  onSelect,
  onClick,
}: TransactionCardProps) {
  // Use type field to determine income/expense, not sign inference (T-02 fix)
  const isIncome = transaction.type === "income";
  const displayName = transaction.merchantName || transaction.name || "Unknown";
  const displayCategory = transaction.categoryName || "Uncategorized";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${displayName}, ${formatCurrency(transaction.amount)}, ${format(parseISO(transaction.date), "MMMM d, yyyy")}`}
      className={cn(
        "p-4 cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={() => onClick(transaction)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(transaction);
        }
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center text-lg font-medium border">
            {displayName[0]?.toUpperCase() || "?"}
          </div>
          <div>
            <div className="font-medium text-sm">{displayName}</div>
            <div className="text-xs text-muted-foreground">
              {displayCategory}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "text-lg font-bold tabular-nums",
              isIncome ? "text-green-600" : "text-foreground"
            )}
          >
            {isIncome ? "+" : ""}
            {formatCurrency(transaction.amount)}
          </div>
          <div className="text-xs text-muted-foreground">
            {format(parseISO(transaction.date), "MMM d")}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {transaction.tags && transaction.tags.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tag className="h-3 w-3" aria-hidden="true" />
              {transaction.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-muted rounded text-[10px]"
                >
                  {tag}
                </span>
              ))}
              {transaction.tags.length > 2 && (
                <span className="text-[10px]">
                  +{transaction.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
        <div>
          {transaction.reviewedAt ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-label="Reviewed" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" aria-label="Needs review" />
          )}
        </div>
      </div>
    </Card>
  );
});
