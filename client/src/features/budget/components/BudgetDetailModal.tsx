/**
 * BudgetDetailModal Component
 *
 * Modal showing detailed budget category information with a real spend
 * history chart and a link to the transactions behind the category's
 * spend (audit v2 finding B4). Previously rendered a hardcoded 6-month
 * chart and a fabricated "Associated Account" card number.
 */

import { useLocation } from "wouter";
import {
  X,
  RotateCcw,
  CreditCard,
  Palette,
  Trash,
  Smile,
  Receipt,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, parseMoney } from "@/lib/utils";
import { useFormatters } from "@/contexts/SettingsContext";
import { buildTransactionsUrl } from "@/features/transactions";
import { useBudgetCategoryHistory } from "../hooks/useBudgetCategoryHistory";
import { useBudgetAmountCommit } from "../hooks/useBudgetAmountCommit";
import { BudgetHistoryChart } from "./BudgetHistoryChart";
import type { SelectedItem, BudgetCategory, BudgetGroup } from "../types";

interface BudgetDetailModalProps {
  /** Snapshot from the row click (saved values); the live item is read from `groups`. */
  selected: SelectedItem | null;
  groups?: BudgetGroup[];
  /** Year of the budget period currently being viewed on the Budget page. */
  year: number;
  /** 1-indexed month of the budget period currently being viewed. */
  month: number;
  onClose: () => void;
  onUpdate: (
    groupId: string,
    itemId: string,
    field: keyof BudgetCategory,
    value: BudgetCategory[keyof BudgetCategory],
  ) => void;
  onCommitBudget?: (item: BudgetCategory, group: BudgetGroup, value: number) => void;
}

/** First and last calendar day of the given 1-indexed month, as local dates. */
function getPeriodRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
}

export function BudgetDetailModal({
  selected: snapshot,
  groups,
  year,
  month,
  onClose,
  onUpdate,
  onCommitBudget,
}: BudgetDetailModalProps) {
  const { formatCurrency } = useFormatters();
  const [, navigate] = useLocation();
  const history = useBudgetCategoryHistory(snapshot?.itemId, year, month);
  // Same commit path as the inline row edit: only rows it can commit, only a real change.
  const commitBudget = useBudgetAmountCommit(snapshot, groups, onCommitBudget);

  if (!snapshot) return null;
  const group = groups?.find((g) => g.id === snapshot.groupId);
  const liveItem = group?.items.find((i) => i.id === snapshot.itemId);
  const selected = liveItem ? { ...snapshot, item: liveItem } : snapshot;

  const handleViewTransactions = () => {
    const { start, end } = getPeriodRange(year, month);
    navigate(
      buildTransactionsUrl({
        categoryId: selected.itemId,
        startDate: start,
        endDate: end,
      }),
    );
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
      <Card className="w-full max-w-2xl bg-card shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="relative group cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl group-hover:bg-muted/80 transition-colors">
                <selected.item.icon className="w-6 h-6" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-card dark:bg-card rounded-full shadow border border-border flex items-center justify-center">
                <Smile className="w-3 h-3 text-muted-foreground" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={selected.item.name}
                  onChange={(e) =>
                    onUpdate(
                      selected.groupId,
                      selected.itemId,
                      "name",
                      e.target.value,
                    )
                  }
                  className="text-xl font-bold text-foreground bg-transparent border-none p-0 focus:ring-0 w-full"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {selected.groupName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 hover:bg-muted rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Main Stats Row */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Budget
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <input
                  type="text"
                  value={selected.item.budget}
                  onChange={(e) => {
                    const val = parseMoney(e.target.value) || 0;
                    onUpdate(selected.groupId, selected.itemId, "budget", val);
                  }}
                  onBlur={(e) => commitBudget(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitBudget(e.currentTarget.value)}
                  className="w-full pl-7 py-2.5 px-3 rounded-lg border border-border bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none font-bold text-lg shadow-sm"
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Select defaultValue="monthly">
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder="Frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Actual
              </label>
              <div className="py-2.5 px-3 bg-muted/50 rounded-lg font-bold text-lg text-foreground border border-transparent">
                {formatCurrency(selected.item.actual)}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Remaining
              </label>
              <div
                className={cn(
                  "py-2.5 px-3 rounded-lg font-bold text-lg text-center border",
                  selected.item.remaining >= 0
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50"
                    : "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-900/50",
                )}
              >
                {formatCurrency(Math.abs(selected.item.remaining))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleViewTransactions}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 mb-8 rounded-lg border border-border bg-background hover:bg-muted/60 transition-colors text-sm font-medium text-foreground"
          >
            <Receipt className="w-4 h-4" />
            View transactions in{" "}
            {new Date(year, month - 1, 1).toLocaleString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </button>

          {/* Settings Section */}
          <div className="space-y-6 mb-8">
            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-medium text-sm">
                    Rollover unused budget
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Carry forward positive balances
                  </div>
                </div>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-medium text-sm">Associated Account</div>
                  <div className="text-xs text-muted-foreground">
                    Not linked to a single account - budgets track spend
                    across the whole household
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-50 dark:bg-orange-950/50 flex items-center justify-center text-orange-600 dark:text-orange-400">
                  <Palette className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-medium text-sm">Color Tag</div>
                  <div className="flex gap-1 mt-1">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <div className="w-3 h-3 rounded-full bg-rose-500 ring-2 ring-offset-1 ring-muted-foreground/20" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* History Section */}
          <div>
            <h3 className="text-sm font-bold text-foreground mb-3">
              History & Trends
            </h3>
            <BudgetHistoryChart
              points={history.points}
              isLoading={history.isLoading}
              hasData={history.hasData}
              average={history.average}
              formatCurrency={formatCurrency}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between bg-muted/5">
          <button className="flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 px-3 py-2 rounded-md transition-colors text-sm font-medium">
            <Trash className="w-4 h-4" /> Delete Category
          </button>
          <button
            onClick={onClose}
            className="bg-orange-500 text-white px-6 py-2 rounded-md hover:bg-orange-600 transition-colors text-sm font-bold shadow-sm"
          >
            Done
          </button>
        </div>
      </Card>
    </div>
  );
}
