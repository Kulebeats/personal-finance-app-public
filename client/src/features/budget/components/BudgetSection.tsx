/**
 * BudgetSection Component
 *
 * Major section for income/expense groups with collapsible groups.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormatters } from "@/contexts/SettingsContext";
import { BudgetGroupHeader } from "./BudgetGroupHeader";
import { BudgetRow } from "./BudgetRow";
import type { BudgetGroup, BudgetCategory, SelectedItem } from "../types";

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
}: BudgetSectionProps) {
  const { formatCurrency } = useFormatters();
  const [expanded, setExpanded] = useState(true);

  // Calculate totals
  const totalBudget = groups.reduce(
    (sum, group) =>
      sum +
      ((group.isFlexible || group.isGroupBudget) && group.budget !== undefined
        ? group.budget
        : group.items.reduce((gSum, item) => gSum + item.budget, 0)),
    0
  );
  const totalActual = groups.reduce(
    (sum, group) =>
      sum + group.items.reduce((gSum, item) => gSum + item.actual, 0),
    0
  );
  const totalRemaining = groups.reduce(
    (sum, group) =>
      sum +
      ((group.isFlexible || group.isGroupBudget) && group.budget !== undefined
        ? group.budget -
          group.items.reduce((gSum, item) => gSum + item.actual, 0)
        : group.items.reduce((gSum, item) => gSum + item.remaining, 0)),
    0
  );

  const isIncome = title.toLowerCase().includes("income");
  const unbudgetedCount = groups.reduce((count, group) => {
    if (group.isFlexible || group.isGroupBudget) return count;
    return count + group.items.filter((item) => item.budget <= 0).length;
  }, 0);

  const visibleGroups = groups.map((group) => {
    if (showUnbudgeted || group.isFlexible || group.isGroupBudget) {
      return group;
    }
    const filteredItems = group.items.filter((item) => item.budget > 0);
    return { ...group, items: filteredItems };
  });

  return (
    <div className="mb-2">
      {/* Section Header */}
      <div
        className="grid grid-cols-12 gap-4 py-4 px-4 bg-muted/30 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer select-none group items-center"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-5 flex items-center gap-3">
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
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {showUnbudgeted ? "Hide" : "Show"} {unbudgetedCount} unbudgeted
            </button>
          )}
        </div>

        <div className="col-span-3 text-right pr-4 text-base font-bold text-foreground">
          {formatCurrency(totalBudget)}
        </div>

        <div
          className={cn(
            "col-span-2 text-right pr-8 text-base font-bold",
            isIncome
              ? totalActual >= totalBudget
                ? "text-emerald-600"
                : "text-foreground"
              : totalActual > totalBudget
              ? "text-rose-600"
              : "text-foreground"
          )}
        >
          {formatCurrency(totalActual)}
        </div>

        <div
          className={cn(
            "col-span-2 text-right text-base font-bold",
            totalRemaining >= 0 ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {formatCurrency(totalRemaining)}
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
                          formatCurrency={formatCurrency}
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
  formatCurrency,
}: {
  item: BudgetCategory;
  group: BudgetGroup;
  onSelectItem?: (item: SelectedItem) => void;
  formatCurrency: (val: number) => string;
}) {
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
        {formatCurrency(item.actual)}
      </div>
      <div className="col-span-2 text-right"></div>
    </div>
  );
}
