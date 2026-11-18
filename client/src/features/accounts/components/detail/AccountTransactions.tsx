import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/format";
import { toMoneyNumber } from "@/lib/money";
import { type Transaction } from "@/lib/api";

// HIGH-005: Extended type to include categoryName from API response
interface AccountTransaction extends Transaction {
  categoryName?: string | null;
}

interface AccountTransactionsProps {
  groupedTransactions: Record<string, AccountTransaction[]>;
  isLoading: boolean;
  currency: string;
  onAddTransaction: () => void;
}

export function AccountTransactions({
  groupedTransactions,
  isLoading,
  currency,
  onAddTransaction,
}: AccountTransactionsProps) {
  const currencySymbol = getCurrencySymbol(currency || "ZMW");

  return (
    <div className="lg:col-span-2 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <div className="flex gap-2">
          {/* TODO-033: Edit multiple removed until implemented */}
          <Button
            size="sm"
            onClick={onAddTransaction}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add transaction
          </Button>
        </div>
      </div>

      <Card className="shadow-sm border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(groupedTransactions).length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground mb-4">No transactions yet</p>
            <Button
              size="sm"
              onClick={onAddTransaction}
            >
              Add transaction
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {Object.entries(groupedTransactions).map(([date, txns]) => (
              <div key={date}>
                <div className="px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground">
                  {date}
                </div>
                {txns.map((tx) => {
                  // Use type field to determine income/expense, not sign inference (T-02 fix)
                  const isIncome = tx.type === "income";
                  const amount = toMoneyNumber(tx.amount);
                  // HIGH-005: Removed cursor-pointer since rows are not interactive
                  return (
                    <div
                      key={tx.id}
                      className="p-4 hover:bg-muted/20 flex items-center justify-between group transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground group-hover:bg-background dark:group-hover:bg-slate-700 group-hover:shadow-sm transition-all">
                          {tx.name[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-sm text-foreground">
                            {tx.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {/* HIGH-005: Fixed type - removed the unsafe cast */}
                            {tx.categoryName || "Uncategorized"}
                          </div>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "font-medium text-sm",
                          isIncome ? "text-emerald-600" : "text-foreground",
                        )}
                      >
                        {isIncome ? "+" : ""}
                        {currencySymbol}
                        {Math.abs(amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
