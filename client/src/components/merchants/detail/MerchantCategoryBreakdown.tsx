/**
 * Category Breakdown Section for Merchant Detail
 */

import { formatCurrency } from "@/lib/format";
import { toMoneyNumber } from "@/lib/money";
import { useSettings } from "@/hooks/use-settings";
import type { MoneyValue } from "@shared/money";

interface BreakdownItem {
  id: string;
  label: string;
  value: MoneyValue;
  percent: number;
}

interface MerchantCategoryBreakdownProps {
  items: BreakdownItem[];
}

export function MerchantCategoryBreakdown({
  items,
}: MerchantCategoryBreakdownProps) {
  const { currency } = useSettings();
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Category breakdown</h3>
      </div>
      <div className="mt-2 space-y-2">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">
                  {(item.percent ?? 0).toFixed(1)}%
                </p>
              </div>
              <div className="font-mono">
                {formatCurrency(toMoneyNumber(item.value), currency)}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No category breakdown for this range.
          </p>
        )}
      </div>
    </div>
  );
}
