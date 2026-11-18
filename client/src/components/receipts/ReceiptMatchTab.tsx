import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Search } from "lucide-react";

import type { MoneyDto } from "@/lib/api";
import { parseMoneyInputNumber, toMoneyNumber } from "@/lib/money";
import { formatCurrency } from "@/lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

type TransactionMatchItem = {
  id: string;
  name: string;
  originalName?: string | null;
  type: string;
  amount: MoneyDto;
  date: string;
};

type ReceiptMatchTabProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  transactionDateRange: { startDate: string; endDate: string };
  transactionsLoading: boolean;
  filteredTransactions: TransactionMatchItem[];
  selectedTransactionId: string | null;
  onToggleTransaction: (transactionId: string) => void;
  onMatchTransaction: () => void;
  isMatching: boolean;
  receiptAmount?: string;
  receiptCurrency?: string;
};

const AMOUNT_MISMATCH_TOLERANCE = 1.00;

export function ReceiptMatchTab({
  searchQuery,
  onSearchQueryChange,
  transactionDateRange,
  transactionsLoading,
  filteredTransactions,
  selectedTransactionId,
  onToggleTransaction,
  onMatchTransaction,
  isMatching,
  receiptAmount,
  receiptCurrency = "USD",
}: ReceiptMatchTabProps) {
  const receiptAmountNum = parseMoneyInputNumber(receiptAmount);
  return (
    <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search transactions..."
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-9"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Showing transactions from{" "}
        {format(parseISO(transactionDateRange.startDate), "MMM d")} to{" "}
        {format(parseISO(transactionDateRange.endDate), "MMM d, yyyy")}
      </p>

      <ScrollArea className="flex-1 -mx-2 px-2">
        {transactionsLoading ? (
          <div
            className="flex items-center justify-center py-10"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading transactions...</span>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? "No transactions match your search."
                : "No transactions found in this date range."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTransactions.map((transaction) => {
              const isSelected = selectedTransactionId === transaction.id;
              const amountNum = Math.abs(toMoneyNumber(transaction.amount));
              const currency = transaction.amount.currency || "USD";
              const formattedAmount = formatCurrency(amountNum, currency);
              const signedAmount = transaction.type === "income" ? `+${formattedAmount}` : `-${formattedAmount}`;
              const dateStr = format(parseISO(transaction.date), "MMM d, yyyy");

              return (
                <button
                  key={transaction.id}
                  type="button"
                  onClick={() => onToggleTransaction(transaction.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors w-full text-left
                    focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`${transaction.name}, ${signedAmount}, ${dateStr}${isSelected ? ", currently selected" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {transaction.name}
                      </p>
                      {transaction.originalName &&
                        transaction.originalName !== transaction.name && (
                          <p className="text-xs text-muted-foreground truncate">
                            {transaction.originalName}
                          </p>
                        )}
                    </div>
                    <div className="text-right ml-3">
                      <p
                        className={`font-medium text-sm ${
                          transaction.type === "income"
                            ? "text-green-600"
                            : "text-foreground"
                        }`}
                      >
                        {signedAmount}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateStr}
                      </p>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="mt-2 pt-2 border-t flex items-center text-xs text-primary">
                      <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />
                      Selected for matching
                    </div>
                  )}
                  {receiptAmountNum !== null && (() => {
                    const txnAmountNum = Math.abs(toMoneyNumber(transaction.amount));
                    const diff = Math.abs(receiptAmountNum - txnAmountNum);
                    if (diff > AMOUNT_MISMATCH_TOLERANCE) {
                      return (
                        <div className="mt-2 pt-2 border-t flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>
                            Amount differs by {formatCurrency(diff, receiptCurrency)}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {selectedTransactionId && (
        <div className="pt-3 border-t">
          <Button
            className="w-full"
            onClick={onMatchTransaction}
            disabled={isMatching}
          >
            {isMatching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Matching...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Match to Selected Transaction
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
