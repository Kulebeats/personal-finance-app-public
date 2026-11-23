/**
 * BudgetSection Component
 *
 * Major section for income/expense groups with collapsible groups.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBudgetMoneyDisplay } from "../budgetMoneyDisplay";
import { BudgetGroupHeader } from "./BudgetGroupHeader";
import { BudgetRow } from "./BudgetRow";
import type { BudgetGroup, BudgetCategory, SelectedItem } from "../types";
import { groupActual, groupBudgetLimit, isBudgetedCategory, remainingBudget, sumBudgetLimits } from "../budgetLimits";
import { sumMoneyValues } from "@/lib/money";
import { parseMoney } from "@/lib/utils";
import { isUnbudgetedUnavailable, type UnbudgetedSection } from "@/hooks/useUnbudgetedSpend";

interface BudgetSectionProps {
  title: string;
  groups: BudgetGroup[];
  onToggleGroup: (id: string) => void;
  onAddItemToGroup: (id: string) => void;
  onUpdateItem: (
    groupId: string,
    itemId: string,
    field: keyof BudgetCategory,
    value: BudgetCategory[keyof BudgetCategory]
  ) => void;
  onSelectItem?: (item: SelectedItem) => void;
  onMoveMoney?: (item: BudgetCategory) => void;
  onUpdateGroupBudget?: (groupId: string, val: number) => void;
  onCommitGroupBudget?: (groupId: string, val: number) => void;
  onCommitItemBudget?: (
    item: BudgetCategory,
    group: BudgetGroup,
    value: number
  ) => void;
  showUnbudgeted: boolean;
  onToggleShowUnbudgeted: () => void;
  /** This section's spending in categories no budget covers, from the server (N3); null = unavailable. */
  unbudgetedSpent?: UnbudgetedSection;
  currency?: string | null;
}

export function BudgetSection({
  title,
  groups,
  onToggleGroup,
  onAddItemToGroup,
  onUpdateItem,
  onSelectItem,
  onMoveMoney,
  onUpdateGroupBudget,
  onCommitGroupBudget,
  onCommitItemBudget,
  showUnbudgeted,
  onToggleShowUnbudgeted,
  unbudgetedSpent,
  currency,
}: BudgetSectionProps) {
  const { formatCurrency, formatLimit } = useBudgetMoneyDisplay(currency);
  const { formatCurrency: formatUnbudgeted } = useBudgetMoneyDisplay(unbudgetedSpent?.currency ?? currency);
  const [expanded, setExpanded] = useState(true);

  const totalBudget = sumBudgetLimits(groups.map(groupBudgetLimit));
  const hasWithheldLimit = groups.some(group => group.hasWithheldLimit);
  // The total counts every category's spending: budget rows, then the unbudgeted line.
  // When it is unavailable (missing exchange rate) the total is marked incomplete, never short by a silent 0.
  const unbudgetedIncomplete = isUnbudgetedUnavailable(unbudgetedSpent);
  const isIncomplete = currency === null || unbudgetedIncomplete || groups.some(group => group.actualIncomplete);
  const unbudgetedActual = parseMoney(unbudgetedSpent);
  const totalActual = sumMoneyValues([
    ...groups.map(groupActual), unbudgetedActual,
  ]).toNumber();
  const isRemainingIncomplete = isIncomplete || hasWithheldLimit;
  const totalRemaining = remainingBudget(totalBudget, isRemainingIncomplete ? null : totalActual);

  const isIncome = title.toLowerCase().includes("income");
  const incompleteReason = unbudgetedIncomplete
    ? `${title} total is incomplete: unbudgeted spending could not be converted because an exchange rate is missing`
    : `${title} total is incomplete: some budget progress is unavailable`;
  const actualLabel = isIncomplete && currency !== null ? `At least ${formatCurrency(totalActual)}` : formatCurrency(totalActual);
  const unbudgetedCount = groups.reduce((count, group) => {
    if (group.isFlexible) return count;
    return count + group.items.filter(item => !isBudgetedCategory(item)).length;
  }, 0);

  const visibleGroups = groups.map((group) => {
    if (showUnbudgeted || group.isFlexible) {
      return group;
    }
    return { ...group, actual: groupActual(group), items: group.items.filter(isBudgetedCategory) };
  });

  return (
    <div className="mb-2">
      {/* Section Header */}
      <div
        className="grid grid-cols-12 gap-4 py-4 px-4 bg-muted/30 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer select-none group items-center"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
          <span className="text-lg font-bold text-foreground">{title}</span>
          <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-0.5 rounded border border-border">
            {groups.length} Groups
          </span>
          {unbudgetedCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleShowUnbudgeted();
              }}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground max-md:min-h-11"
            >
              {showUnbudgeted ? "Hide" : "Show"} {unbudgetedCount} unbudgeted
            </button>
          )}
        </div>

        <div className="col-span-3 text-right pr-4 text-base font-bold text-foreground">
          {formatLimit(totalBudget, hasWithheldLimit)}
        </div>

        <div
          aria-label={isIncomplete ? `${actualLabel}. ${incompleteReason}` : undefined}
          className={cn(
            "col-span-2 text-right pr-8 text-base font-bold",
            isRemainingIncomplete
              ? "text-muted-foreground"
              : isIncome
              ? totalBudget !== null && totalActual >= totalBudget
                ? "text-emerald-600"
                : "text-foreground"
              : totalBudget !== null && totalActual > totalBudget
              ? "text-rose-600"
              : "text-foreground"
          )}
        >
          {actualLabel}
        </div>

        <div
          className={cn(
            "col-span-2 text-right text-base font-bold",
            totalRemaining === null ? "text-muted-foreground" : totalRemaining >= 0 ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {isRemainingIncomplete ? "Incomplete" : totalRemaining === null ? "Unbudgeted" : formatCurrency(totalRemaining)}
        </div>
      </div>

      {/* Groups List */}
      {expanded && (
        <div className="pl-4 border-l-4 border-muted/30 ml-2">
          {visibleGroups.map((group) => {
            const canEditGroupBudget = Boolean(
              (group.isFlexible || group.isGroupBudget) && onUpdateGroupBudget
            );
            const canCommitGroupBudget = Boolean(
              (group.isFlexible || group.isGroupBudget) && onCommitGroupBudget
            );

            return (
              <div key={group.id} className="contents">
                <BudgetGroupHeader
                  group={group}
                  onToggle={() => onToggleGroup(group.id)}
                  onAddItem={() => onAddItemToGroup(group.id)}
                  onUpdateBudget={
                    canEditGroupBudget
                      ? (val) => onUpdateGroupBudget?.(group.id, val)
                      : undefined
                  }
                  onCommitBudget={
                    canCommitGroupBudget
                      ? (val) => onCommitGroupBudget?.(group.id, val)
                      : undefined
                  }
                />

                {group.expanded && (
                  <>
                    {group.items.map((item) =>
                      group.isFlexible ? (
                        <FlexibleRow
                          key={item.id}
                          item={item}
                          group={group}
                          onSelectItem={onSelectItem}
                        />
                      ) : (
                        <BudgetRow
                          key={item.id}
                          item={item}
                          isIncome={group.type === "income"}
                          onUpdate={(id, field, val) =>
                            onUpdateItem(group.id, id, field, val)
                          }
                          onSelect={onSelectItem}
                          onMoveMoney={
                            group.isGroupBudget ? undefined : onMoveMoney
                          }
                          groupId={group.id}
                          groupName={group.name}
                          isBudgetEditable={!group.isGroupBudget}
                          onCommitBudget={
                            onCommitItemBudget && !group.isGroupBudget
                              ? (_id, val) =>
                                  onCommitItemBudget(item, group, val)
                              : undefined
                          }
                        />
                      )
                    )}
                    <div
                      className="py-2 px-12 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary cursor-pointer transition-colors border-b border-border/40 hover:bg-muted/10"
                      onClick={() => onAddItemToGroup(group.id)}
                    >
                      <Plus className="w-3 h-3" /> Add Category to {group.name}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {unbudgetedIncomplete && (
            <div
              className="grid grid-cols-12 gap-4 py-3 px-4 border-b border-border/30 items-center text-sm"
              aria-label={`Unbudgeted ${isIncome ? "income" : "spending"} unavailable: an exchange rate is missing, so the ${title} total is incomplete`}
            >
              <div className="col-span-5 pl-2 font-medium text-foreground">Unbudgeted</div>
              <div className="col-span-3 text-right pr-4 text-muted-foreground">-</div>
              <div className="col-span-2 text-right pr-8 font-medium text-muted-foreground">Unavailable</div>
              <div className="col-span-2 text-right"></div>
            </div>
          )}
          {!unbudgetedIncomplete && unbudgetedActual > 0 && (
            <div
              className="grid grid-cols-12 gap-4 py-3 px-4 border-b border-border/30 items-center text-sm"
              aria-label={`Unbudgeted, ${formatUnbudgeted(unbudgetedActual)} ${isIncome ? "earned" : "spent"} in categories without a limit`}
            >
              <div className="col-span-5 pl-2 font-medium text-foreground">Unbudgeted</div>
              <div className="col-span-3 text-right pr-4 text-muted-foreground">-</div>
              <div className="col-span-2 text-right pr-8 font-medium text-foreground">
                {formatUnbudgeted(unbudgetedActual)}
              </div>
              <div className="col-span-2 text-right"></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Flexible row for flex groups
function FlexibleRow({
  item,
  group,
  onSelectItem,
}: {
  item: BudgetCategory;
  group: BudgetGroup;
  onSelectItem?: (item: SelectedItem) => void;
}) {
  const { formatCurrency } = useBudgetMoneyDisplay(item.currency);
  return (
    <div
      className="grid grid-cols-12 gap-4 py-3 px-4 border-b border-border/30 hover:bg-muted/20 items-center group text-sm relative cursor-pointer"
      onClick={() =>
        onSelectItem?.({
          groupId: group.id,
          itemId: item.id,
          item,
          groupName: group.name,
        })
      }
    >
      <div className="col-span-5 flex items-center gap-3 pl-2">
        <div className="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground group-hover:bg-background dark:group-hover:bg-muted group-hover:shadow-sm transition-all">
          <item.icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 font-medium text-foreground">{item.name}</div>
      </div>
      <div className="col-span-3 text-right pr-4 text-muted-foreground">-</div>
      <div className="col-span-2 text-right pr-8 font-medium text-foreground">
        {item.actual === null ? item.coverage === "group" ? "Included in group" : "Unavailable" : formatCurrency(item.actual)}
      </div>
      <div className="col-span-2 text-right"></div>
    </div>
  );
}
