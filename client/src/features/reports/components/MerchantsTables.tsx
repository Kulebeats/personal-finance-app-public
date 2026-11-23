import { cn } from "@/lib/utils";
import { toMoneyNumber } from "@/lib/money";
import { formatCurrency } from "../utils/reportFormatters";
import type { MerchantItem } from "./merchants.types";

type MerchantsTablesProps = {
  items: MerchantItem[];
  categoryItems: MerchantItem[];
  selectedMerchantId: string | null;
  onMerchantSelect: (id: string) => void;
  totalValue: number;
  categoryTotalValue: number;
  currency: string | null;
};

export function MerchantsTables({
  items,
  categoryItems,
  selectedMerchantId,
  onMerchantSelect,
  totalValue,
  categoryTotalValue,
  currency,
}: MerchantsTablesProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="py-2 text-left font-medium">Merchant</th>
              <th className="py-2 text-right font-medium">Spend</th>
              <th className="py-2 text-right font-medium">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => onMerchantSelect(item.entityId || item.id)}
                className={cn(
                  "border-b border-border last:border-b-0 cursor-pointer transition-colors",
                  (item.entityId || item.id) === selectedMerchantId
                    ? "bg-muted/60"
                    : "hover:bg-muted/40"
                )}
              >
                <td className="py-2 font-medium">{item.label}</td>
                <td className="py-2 text-right">
                  {formatCurrency(item.value, currency)}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {(
                    (toMoneyNumber(item.value) / (totalValue || 1)) *
                    100
                  ).toFixed(1)}
                  %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="py-2 text-left font-medium">
                Merchant Category
              </th>
              <th className="py-2 text-right font-medium">Spend</th>
              <th className="py-2 text-right font-medium">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {categoryItems.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-b-0">
                <td className="py-2 font-medium">{item.label}</td>
                <td className="py-2 text-right">
                  {formatCurrency(item.value, currency)}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {(
                    (toMoneyNumber(item.value) / (categoryTotalValue || 1)) *
                    100
                  ).toFixed(1)}
                  %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
