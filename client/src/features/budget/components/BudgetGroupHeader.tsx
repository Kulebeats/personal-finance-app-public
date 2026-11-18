/**
 * BudgetGroupHeader Component
 *
 * Collapsible header for a budget group with totals.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { useFormatters } from "@/contexts/SettingsContext";
import type { BudgetGroup } from "../types";

interface BudgetGroupHeaderProps {
  group: BudgetGroup;
  onToggle: () => void;
  onAddItem: () => void;
  onUpdateBudget?: (val: number) => void;
  onCommitBudget?: (val: number) => void;
}

export function BudgetGroupHeader({
  group,
  onToggle,
  onAddItem,
  onUpdateBudget,
  onCommitBudget,
}: BudgetGroupHeaderProps) {
  const { formatCurrency } = useFormatters();

  const totalBudget =
    (group.isFlexible || group.isGroupBudget) && group.budget !== undefined
      ? group.budget
      : group.items.reduce((acc, item) => acc + item.budget, 0);

  const totalActual = group.items.reduce((acc, item) => acc + item.actual, 0);

  const totalRemaining =
    group.isFlexible || group.isGroupBudget
      ? totalBudget - totalActual
      : group.items.reduce((acc, item) => acc + item.remaining, 0);

  return (
    <div className="contents">
      <div className="grid grid-cols-12 gap-4 py-3 px-4 bg-muted/10 border-b border-border/40 group items-center mt-4 rounded-t-md">
        {/* Group Name */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={group.expanded}
          aria-label={`${group.name} budget group, ${group.expanded ? 'expanded' : 'collapsed'}`}
          className="col-span-5 flex items-center gap-2 font-bold text-foreground cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {group.expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
          {group.name}
          {group.isFlexible && (
            <span className="ml-2 text-[10px] uppercase bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              Flex
            </span>
          )}
          {group.isGroupBudget && (
            <span className="ml-2 text-[10px] uppercase bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
              Group
            </span>
          )}
        </div>

        {/* Budget Total */}
        <div className="col-span-3 text-right pr-4 font-bold text-sm text-foreground">
          {(group.isFlexible || group.isGroupBudget) && onUpdateBudget ? (
            <div
              className="relative inline-block w-28"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs pointer-events-none">
                K
              </span>
              <input
                type="text"
                value={group.budget || 0}
                onChange={(e) => {
                  const val = parseMoney(e.target.value) || 0;
                  onUpdateBudget(val);
                }}
                onBlur={(event) => {
                  if (!onCommitBudget) return;
                  const val = parseMoney(event.currentTarget.value);
                  if (Number.isFinite(val)) {
                    onCommitBudget(val);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !onCommitBudget) return;
                  const val = parseMoney(event.currentTarget.value);
                  if (Number.isFinite(val)) {
                    onCommitBudget(val);
                  }
                }}
                aria-label={`Budget amount for ${group.name} group`}
                className="w-full text-right py-1 px-2 rounded-md border border-border/60 bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-bold transition-all shadow-sm hover:border-border"
              />
            </div>
          ) : (
            formatCurrency(totalBudget)
          )}
        </div>

        {/* Actual Total */}
        <div className="col-span-2 text-right pr-8 font-bold text-sm text-foreground">
          {formatCurrency(totalActual)}
        </div>

        {/* Remaining Total */}
        <div className="col-span-2 text-right font-bold text-sm">
          <span
            className={cn(
              totalRemaining >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            )}
          >
            {formatCurrency(totalRemaining)}
          </span>
        </div>
      </div>
    </div>
  );
}
