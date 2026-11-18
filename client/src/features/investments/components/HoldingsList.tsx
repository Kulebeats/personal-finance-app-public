import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { SortableTableHeader } from "@/components/ui/SortableTableHeader";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { differenceInDays } from "date-fns";
import { RecordInvestmentTransactionModal } from "./RecordInvestmentTransactionModal";
import type { Holding } from "@/hooks/useInvestments";

interface HoldingsListProps {
  holdings: Holding[];
  displayCurrency: string;
  formatCurrency: (amount: number, currency: string) => string;
}

type SortField = "name" | "value" | "quantity" | "change" | "price";
type SortDirection = "asc" | "desc";

export function HoldingsList({
  holdings,
  displayCurrency,
  formatCurrency,
}: HoldingsListProps) {
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc"); // Default to desc for new fields typically
    }
  };

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "name":
          const nameA = a.security?.symbol || "";
          const nameB = b.security?.symbol || "";
          comparison = nameA.localeCompare(nameB);
          break;
        case "value":
          comparison = (a.currentValue || 0) - (b.currentValue || 0);
          break;
        case "quantity":
          comparison = Number(a.quantity) - Number(b.quantity);
          break;
        case "price":
          comparison =
            Number(a.security?.currentPrice || "0") -
            Number(b.security?.currentPrice || "0");
          break;
        case "change":
          comparison = (a.gainLossPercent || 0) - (b.gainLossPercent || 0);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [holdings, sortField, sortDirection]);

  return (
    <Card className="lg:col-span-3 shadow-sm border-border overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-muted/30 text-muted-foreground font-medium border-b border-border">
          <tr>
            <SortableTableHeader
              sortKey="name"
              currentSort={sortField}
              sortDirection={sortDirection}
              onSort={(key) => handleSort(key as SortField)}
              className="text-left"
            >
              Name
            </SortableTableHeader>
            <th className="px-6 py-3">Sector</th>
            <SortableTableHeader
              sortKey="price"
              currentSort={sortField}
              sortDirection={sortDirection}
              onSort={(key) => handleSort(key as SortField)}
              className="text-right"
            >
              Price
            </SortableTableHeader>
            <SortableTableHeader
              sortKey="quantity"
              currentSort={sortField}
              sortDirection={sortDirection}
              onSort={(key) => handleSort(key as SortField)}
              className="text-right"
            >
              Quantity
            </SortableTableHeader>
            <SortableTableHeader
              sortKey="value"
              currentSort={sortField}
              sortDirection={sortDirection}
              onSort={(key) => handleSort(key as SortField)}
              className="text-right"
            >
              Value
            </SortableTableHeader>
            <SortableTableHeader
              sortKey="change"
              currentSort={sortField}
              sortDirection={sortDirection}
              onSort={(key) => handleSort(key as SortField)}
              className="text-right"
            >
              Today's Change
            </SortableTableHeader>
            <th className="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sortedHoldings.map((h) => (
            <tr
              key={h.id}
              className="hover:bg-muted/20 group cursor-pointer transition-colors"
            >
              <td className="px-6 py-4">
                <div className="font-bold text-foreground">
                  {h.security?.symbol ?? "N/A"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {h.security?.name ?? "Unknown Security"}
                </div>
              </td>
              <td className="px-6 py-4 text-muted-foreground">
                {h.security?.sector ?? h.security?.type ?? "-"}
              </td>
              <td className="px-6 py-4 text-right tabular-nums">
                <div className="flex items-center justify-end gap-2">
                  {h.security?.lastPriceUpdate &&
                    differenceInDays(
                      new Date(),
                      new Date(h.security.lastPriceUpdate),
                    ) > 7 && (
                      <div
                        title={`Price stale. Last updated: ${new Date(
                          h.security.lastPriceUpdate,
                        ).toLocaleDateString()}`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                      </div>
                    )}
                  {formatCurrency(
                    Number(h.security?.currentPrice ?? "0"),
                    h.security?.currency ?? displayCurrency,
                  )}
                </div>
              </td>
              <td className="px-6 py-4 text-right tabular-nums">
                {Number(h.quantity).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-right font-medium tabular-nums">
                {formatCurrency(h.currentValue ?? 0, displayCurrency)}
              </td>
              <td
                className={cn(
                  "px-6 py-4 text-right font-medium tabular-nums",
                  (h.gainLossPercent ?? 0) >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded-full text-xs",
                    (h.gainLossPercent ?? 0) >= 0
                      ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300",
                  )}
                >
                  {(h.gainLossPercent ?? 0) > 0 ? "+" : ""}
                  {(h.gainLossPercent ?? 0).toFixed(1)}%
                </span>
              </td>
              <td className="px-6 py-4 text-right">
                <RecordInvestmentTransactionModal holding={h}>
                  <button className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-muted rounded transition-opacity text-xs font-medium text-primary hover:text-primary/80">
                    Record
                  </button>
                </RecordInvestmentTransactionModal>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
