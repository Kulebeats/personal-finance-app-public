/**
 * RecurringList Component
 *
 * List view for recurring transactions.
 */

import { cn, parseMoney } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { RecurringItemActions } from "./RecurringItemActions";
import { FREQUENCY_LABELS } from "../types";
import type { RecurringTransaction } from "@/hooks/useRecurring";
import { CalendarCheck2, Plus } from "lucide-react";
import { AddTransactionModal } from "@/components/transactions/AddTransactionModal";

interface RecurringListProps {
  items: RecurringTransaction[];
  currency: string;
  onPauseToggle: (item: RecurringTransaction) => void;
  onEdit: (item: RecurringTransaction) => void;
  onDelete: (item: RecurringTransaction) => void;
  onSkip: (item: RecurringTransaction) => void;
}

export function RecurringList({
  items,
  currency,
  onPauseToggle,
  onEdit,
  onDelete,
  onSkip,
}: RecurringListProps) {
  const sortedItems = [...items].sort((a, b) => {
    const dateA = new Date(a.nextDueDate).getDate();
    const dateB = new Date(b.nextDueDate).getDate();
    return dateA - dateB;
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-border/50 rounded-lg bg-muted/5">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <CalendarCheck2 className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          No recurring rules
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Set up your bills, subscriptions, and salary to track them
          automatically on your calendar.
        </p>
        <AddTransactionModal initialValues={{ isRecurring: true }}>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 shadow-sm transition-colors">
            <Plus className="w-4 h-4" /> Add your first rule
          </button>
        </AddTransactionModal>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-12 text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 pb-2 border-b border-border/50">
        <div className="col-span-1">Day</div>
        <div className="col-span-4">Merchant</div>
        <div className="col-span-3">Frequency</div>
        <div className="col-span-3 text-right">Amount</div>
        <div className="col-span-1"></div>
      </div>

      {/* Items */}
      <div className="divide-y divide-border/40">
        {sortedItems.map((item) => {
          const dueDate = new Date(item.nextDueDate);
          const displayCurrency = item.amount.currency || currency;

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dueDateObj = new Date(item.nextDueDate);
          dueDateObj.setHours(0, 0, 0, 0);

          const isOverdue = dueDateObj < today;
          const isDueToday = dueDateObj.getTime() === today.getTime();

          return (
            <div
              key={item.id}
              data-testid="recurring-rule-row"
              className={cn(
                "grid grid-cols-12 px-4 py-3 items-center hover:bg-muted/20 transition-colors group",
                item.isPaused && "opacity-50",
              )}
            >
              {/* Day */}
              <div
                className={cn(
                  "col-span-1 font-medium text-muted-foreground",
                  isDueToday && "text-primary font-bold",
                )}
              >
                {dueDate.getDate()}
              </div>

              {/* Merchant */}
              <div className="col-span-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground border border-border/50">
                  {item.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium text-foreground flex items-center gap-2">
                    {item.name}
                    {item.isPaused && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                        Paused
                      </span>
                    )}
                    {!item.isPaused && isOverdue && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-destructive/10 text-destructive rounded font-medium border border-destructive/20">
                        Overdue
                      </span>
                    )}
                    {!item.isPaused && isDueToday && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium border border-primary/20">
                        Due Today
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {item.type}
                  </div>
                </div>
              </div>

              {/* Frequency */}
              <div className="col-span-3">
                <span className="px-2 py-0.5 rounded-full border border-border bg-background text-xs text-muted-foreground">
                  {FREQUENCY_LABELS[item.frequency] || item.frequency}
                </span>
              </div>

              {/* Amount */}
              <div
                data-testid="recurring-rule-amount"
                className={cn(
                  "col-span-3 text-right font-medium",
                  item.type === "income" ? "text-chart-income" : "",
                )}
              >
                {item.type === "income" ? "+" : "-"}
                {formatCurrency(parseMoney(item.amount), displayCurrency)}
              </div>

              {/* Actions */}
              <div className="col-span-1 flex justify-end">
                <RecurringItemActions
                  item={item}
                  onPauseToggle={onPauseToggle}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onSkip={onSkip}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
