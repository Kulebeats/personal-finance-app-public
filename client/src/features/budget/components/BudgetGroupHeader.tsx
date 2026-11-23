/**
 * BudgetGroupHeader Component
 *
 * Collapsible header for a budget group with totals.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { useBudgetMoneyDisplay } from "../budgetMoneyDisplay";
import type { BudgetGroup } from "../types";
import { groupActual, groupBudgetLimit, remainingBudget } from "../budgetLimits";

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
  const { formatCurrency, formatLimit } = useBudgetMoneyDisplay(group.currency);
  const editCurrency = group.budgetEditCurrency === undefined ? group.currency : group.budgetEditCurrency;
  const { prefix } = useBudgetMoneyDisplay(editCurrency);

  const totalBudget = groupBudgetLimit(group);
  const totalActual = groupActual(group);
  const incomplete = group.actualIncomplete || group.currency === null || group.hasWithheldLimit;
  const totalRemaining = remainingBudget(totalBudget, incomplete ? null : totalActual);
  const editBudget = editCurrency !== null && (group.isFlexible || (group.isGroupBudget && !group.hasWithheldLimit))
    ? onUpdateBudget : undefined;

  return (
    <div className="contents">
      <div className="grid grid-cols-12 gap-4 py-3 px-4 bg-muted/10 border-b border-border/40 group items-center mt-4 rounded-t-md">
        {/* Group Name */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={group.expanded}
          aria-label={`${group.name} budget group, ${group.expanded ? 'expanded' : 'collapsed'}`}
          className="col-span-5 flex items-center gap-2 font-bold text-foreground cursor-pointer select-none max-md:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
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
          {editBudget ? (
            <div
              className="relative inline-block w-28"
              onClick={(e) => e.stopPropagation()}
            >
              {group.hasWithheldLimit && <span className="block text-xs">{formatLimit(totalBudget, true)}</span>}
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs pointer-events-none">
                  {prefix}
                </span>
                <input
                  type="text"
                  disabled={group.budgetEditPending}
                  value={group.budgetDraft ?? (group.hasWithheldLimit ? "" : group.budget ?? "")}
                  placeholder={group.hasWithheldLimit ? "Set limit" : "Unbudgeted"}
                  onChange={(e) => {
                    const val = parseMoney(e.target.value) || 0;
                    editBudget(val);
                  }}
                  onBlur={(event) => {
                    if (!onCommitBudget || event.currentTarget.value.trim() === "") return;
                    const val = parseMoney(event.currentTarget.value);
                    if (Number.isFinite(val)) {
                      onCommitBudget(val);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !onCommitBudget || event.currentTarget.value.trim() === "") return;
                    const val = parseMoney(event.currentTarget.value);
                    if (Number.isFinite(val)) {
                      onCommitBudget(val);
                    }
                  }}
                  aria-label={`Budget amount for ${group.name} group`}
                  className="w-full text-right py-1 px-2 max-md:min-h-11 rounded-md border border-border/60 bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-bold transition-all shadow-sm hover:border-border disabled:opacity-60"
                />
              </div>
              {group.budgetEditPending && <span role="status" className="block text-xs text-muted-foreground">Saving flexible budget…</span>}
            </div>
          ) : (
            formatLimit(totalBudget, group.hasWithheldLimit)
          )}
        </div>

        {/* Actual Total */}
        <div className="col-span-2 text-right pr-8 font-bold text-sm text-foreground">
          {group.actualIncomplete && group.currency !== null ? `At least ${formatCurrency(totalActual)}` : formatCurrency(totalActual)}
        </div>

        {/* Remaining Total */}
        <div className="col-span-2 text-right font-bold text-sm">
          <span
            className={cn(
              totalRemaining === null ? "text-muted-foreground" : totalRemaining >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            )}
          >
            {incomplete ? "Incomplete" : totalRemaining === null ? "Unbudgeted" : formatCurrency(totalRemaining)}
          </span>
        </div>
      </div>
    </div>
  );
}
