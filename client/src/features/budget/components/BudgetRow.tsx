/**
 * BudgetRow Component
 *
 * Displays a single budget category row with progress indicator.
 */

import { cn, parseMoney } from "@/lib/utils";
import { useFormatters } from "@/contexts/SettingsContext";
import type { BudgetCategory, SelectedItem } from "../types";

interface BudgetRowProps {
  item: BudgetCategory;
  isIncome?: boolean;
  onUpdate: (
    id: string,
    field: keyof BudgetCategory,
    value: BudgetCategory[keyof BudgetCategory]
  ) => void;
  onSelect?: (item: SelectedItem) => void;
  onMoveMoney?: (item: BudgetCategory) => void;
  groupId?: string;
  groupName?: string;
  isBudgetEditable?: boolean;
  onCommitBudget?: (id: string, value: number) => void;
}

export function BudgetRow({
  item,
  isIncome = false,
  onUpdate,
  onSelect,
  onMoveMoney,
  groupId,
  groupName,
  isBudgetEditable = true,
  onCommitBudget,
}: BudgetRowProps) {
  const utilization = item.budget > 0 ? (item.actual / item.budget) * 100 : 0;
  const { formatCurrency } = useFormatters();

  // Progress bar width calculation - cap at 100%
  const progressWidth = Math.min(100, Math.max(0, utilization));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.name} budget category, ${formatCurrency(item.budget)} budgeted, ${formatCurrency(item.actual)} spent, ${formatCurrency(item.remaining)} remaining`}
      className="grid grid-cols-12 gap-4 py-3 px-4 border-b border-border/30 hover:bg-muted/20 items-center group text-sm relative cursor-pointer"
      onClick={() =>
        onSelect &&
        onSelect({
          groupId: groupId || "",
          itemId: item.id,
          item,
          groupName: groupName || "",
        })
      }
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onSelect) {
          e.preventDefault();
          onSelect({
            groupId: groupId || "",
            itemId: item.id,
            item,
            groupName: groupName || "",
          });
        }
      }}
    >
      {/* Progress Line Indicator */}
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-emerald-500 transition-all duration-500"
        style={{
          width: `${isIncome ? progressWidth : utilization}%`,
          opacity: utilization > 0 ? 1 : 0,
        }}
      />

      {/* Category Name Column */}
      <div className="col-span-5 flex items-center gap-3 pl-2">
        <div className="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground group-hover:bg-background dark:group-hover:bg-muted group-hover:shadow-sm transition-all">
          <item.icon className="w-3.5 h-3.5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <input
            type="text"
            value={item.name}
            onChange={(e) => {
              e.stopPropagation();
              onUpdate(item.id, "name", e.target.value);
            }}
            aria-label={`Category name: ${item.name}`}
            className="font-medium text-foreground bg-transparent border-none p-0 focus:ring-0 w-full hover:bg-muted/50 rounded px-1 transition-colors"
          />
        </div>
      </div>

      {/* Budget Column */}
      <div
        className="col-span-3 text-right pr-4"
        onClick={(e) => e.stopPropagation()}
      >
        {isBudgetEditable ? (
          <div className="relative inline-block group/input w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs pointer-events-none">
              {formatCurrency(0).replace(/[0-9.,-]/g, "")}
            </span>
            <input
              type="text"
              value={item.budget}
              onChange={(e) => {
                const val = parseMoney(e.target.value) || 0;
                onUpdate(item.id, "budget", val);
              }}
              onBlur={(event) => {
                if (!onCommitBudget) return;
                const val = parseMoney(event.currentTarget.value);
                if (Number.isFinite(val)) {
                  onCommitBudget(item.id, val);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !onCommitBudget) return;
                const val = parseMoney(
                  (event.currentTarget as HTMLInputElement).value
                );
                if (Number.isFinite(val)) {
                  onCommitBudget(item.id, val);
                }
              }}
              aria-label={`Budget amount for ${item.name}`}
              className="w-full text-right py-1 px-2 rounded-md border border-border/60 bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-medium transition-all shadow-sm hover:border-border"
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">-</div>
        )}
      </div>

      {/* Actual Column */}
      <div className="col-span-2 text-right pr-8 font-medium text-foreground">
        {formatCurrency(item.actual)}
      </div>

      {/* Remaining Column */}
      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (onMoveMoney) {
              onMoveMoney(item);
            }
          }}
          disabled={!onMoveMoney}
          aria-label={`Move money for ${item.name}, ${formatCurrency(item.remaining)} ${item.remaining > 0 ? 'remaining' : item.remaining < 0 ? 'over budget' : 'at budget'}`}
          className={cn(
            "inline-flex items-center justify-center py-1 px-3 rounded-full text-xs font-bold min-w-[60px]",
            item.remaining > 0
              ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
              : item.remaining < 0
              ? "bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300"
              : "bg-muted text-muted-foreground",
            onMoveMoney ? "hover:opacity-90" : "cursor-default"
          )}
        >
          {formatCurrency(item.remaining)}
        </button>
      </div>
    </div>
  );
}
