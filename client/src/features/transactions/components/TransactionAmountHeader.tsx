import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import type { TransactionWithDetails } from "../types";
import { useTransferLegLabel } from "../transferLeg";

interface TransactionAmountHeaderProps {
  transaction: TransactionWithDetails;
  displayName: string;
  onViewTransactions: () => void;
}

export function TransactionAmountHeader({
  transaction, displayName, onViewTransactions,
}: TransactionAmountHeaderProps) {
  // Use the type field, not the amount sign, to distinguish income (T-02).
  const isIncome = transaction.type === "income";
  const transferLabel = useTransferLegLabel(transaction);

  return (
    <div className="flex items-start justify-between mb-8">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-muted/20 flex items-center justify-center text-2xl font-medium border">
          {displayName[0]?.toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-1">{displayName}</h2>
          {transferLabel && <p className="text-sm text-muted-foreground mb-1">{transferLabel}</p>}
          <button
            onClick={onViewTransactions}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            View transactions <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="text-right">
        <div className={cn(
          "text-2xl font-bold mb-1",
          isIncome ? "text-green-600" : "text-foreground",
        )}>
          {isIncome ? "+" : ""}
          {formatCurrency(transaction.amount)}
        </div>
        {/* The account badge links to the account whose name it shows. */}
        <Link
          href={`/accounts/${transaction.accountId}`}
          className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full hover:bg-muted hover:text-foreground transition-colors inline-block"
        >
          {transaction.accountName || "Account"}
        </Link>
      </div>
    </div>
  );
}
