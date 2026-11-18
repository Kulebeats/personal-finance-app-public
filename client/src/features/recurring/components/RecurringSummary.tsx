/**
 * RecurringSummary Component
 *
 * Summary cards showing recurring totals and upcoming bills.
 */

import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/money";
import type { RecurringTransaction } from "@/hooks/useRecurring";
import type { MoneyDto } from "@shared/money";

interface RecurringSummaryProps {
  totalRecurring: MoneyDto;
  billsTotal: MoneyDto;
  incomeTotal: MoneyDto;
  monthName: string;
  currency: string;
  upcomingBills: RecurringTransaction[];
  recurringCount: number;
  onViewAll: () => void;
}

export function RecurringSummary({
  totalRecurring,
  billsTotal,
  incomeTotal,
  monthName,
  currency,
  upcomingBills,
  recurringCount,
  onViewAll,
}: RecurringSummaryProps) {
  return (
    <div className="space-y-6">
      {/* Total Card */}
      <Card className="p-6 bg-primary/5 border-primary/20 shadow-sm">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Total Recurring
        </h3>
        <div className="text-3xl font-bold text-foreground mb-1">
          {formatCurrency(totalRecurring)}
        </div>
        <div className="text-sm text-muted-foreground">
          Estimated for {monthName}
        </div>
        <div className="mt-4 pt-4 border-t border-primary/10 flex justify-between text-sm">
          <span className="text-muted-foreground">Bills</span>
          <span className="font-medium">{formatCurrency(billsTotal)}</span>
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-muted-foreground">Income</span>
          <span className="font-medium text-chart-income">
            {formatCurrency(incomeTotal)}
          </span>
        </div>
      </Card>

      {/* Upcoming Bills */}
      <Card className="shadow-sm border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center">
          <h3 className="font-semibold text-foreground">Upcoming Bills</h3>
          <button
            onClick={onViewAll}
            className="text-xs text-primary font-medium hover:underline"
          >
            View All
          </button>
        </div>
        <div className="divide-y divide-border/50" data-testid="upcoming-bills-list">
          {upcomingBills.slice(0, 4).map((item) => {
            const dueDate = new Date(item.nextDueDate);
            return (
              <div
                key={item.id}
                data-testid="upcoming-bill-item"
                className="p-4 flex items-center justify-between hover:bg-muted/20 group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center w-10 h-10 bg-card dark:bg-slate-800 border border-border rounded text-xs font-bold shadow-sm group-hover:border-primary/40 transition-colors">
                    <span className="text-chart-expense uppercase text-[9px]">
                      {dueDate.toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-lg leading-none">
                      {dueDate.getDate()}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      {item.name}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {item.type}
                    </div>
                  </div>
                </div>
                <div className="font-semibold text-foreground">
                  {formatCurrency(item.amount)}
                </div>
              </div>
            );
          })}
          {upcomingBills.length === 0 && (
            <div className="p-4 text-center text-muted-foreground">
              No upcoming bills
            </div>
          )}
        </div>
      </Card>

      {/* Status Card */}
      {recurringCount > 0 && (
        <Card className="p-4 shadow-sm bg-chart-income/10 border-chart-income/20">
          <div className="flex gap-3">
            <div className="p-2 bg-chart-income/20 rounded-full h-fit text-chart-income">
              <Check className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">
                All Scheduled
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                You have {recurringCount} recurring transactions set up.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
