/**
 * Recent Transactions List for Merchant Detail
 */

import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { formatCurrency } from "@/lib/format";
import { toMoneyNumber } from "@/lib/money";

interface Transaction {
  id: string;
  name: string;
  date: string;
  amount: string | number | null;
}

interface MerchantTransactionsListProps {
  transactions: Transaction[];
  page: number;
  onPageChange: (page: number) => void;
  onExport: () => void;
  onViewAll: () => void;
}

export function MerchantTransactionsList({
  transactions,
  page,
  onPageChange,
  onExport,
  onViewAll,
}: MerchantTransactionsListProps) {
  const { currency } = useSettings();

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Recent transactions</h3>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onExport}>
            Export CSV
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onViewAll}>
            View all
          </Button>
        </div>
      </div>
      <div className="divide-y rounded border">
        {transactions.length ? (
          transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-3 text-sm"
            >
              <div>
                <p className="font-medium">{tx.name}</p>
                <p className="text-xs text-muted-foreground">{tx.date}</p>
              </div>
              <div className="font-mono">
                {formatCurrency(toMoneyNumber(tx.amount || 0), currency)}
              </div>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            No transactions found.
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={transactions.length < 10}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
