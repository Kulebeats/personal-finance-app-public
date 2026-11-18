/**
 * Transaction Filters Panel Component
 *
 * Filter controls for transactions list.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Filter, X } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import { useAccounts } from "@/hooks/useAccounts";
import type { Account } from "@/lib/api";
import { parseMoneyInputNumber } from "@/lib/money";
import type { TransactionFilters } from "../types";
import { FilterPresetSelector } from "./FilterPresetSelector";

interface TransactionFiltersPanelProps {
  filters: TransactionFilters;
  onChange: (updates: Partial<TransactionFilters>) => void;
  onReset: () => void;
  activeCount: number;
  /** Optional: Set all filters at once (used by presets) */
  onSetFilters?: (filters: TransactionFilters) => void;
}

export function TransactionFiltersPanel({
  filters,
  onChange,
  onReset,
  activeCount,
  onSetFilters,
}: TransactionFiltersPanelProps) {
  const { data: categoriesData } = useCategories();
  const { data: accountsData } = useAccounts();

  const categories = categoriesData?.categories || [];
  const accounts: Account[] = accountsData || [];

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
              {activeCount}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {onSetFilters && (
            <FilterPresetSelector
              context="transactions"
              currentFilters={filters}
              onSelectPreset={onSetFilters}
            />
          )}
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <X className="h-3 w-3 mr-1" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Account Filter */}
        <div className="space-y-1">
          <Label className="text-xs">Account</Label>
          <Select
            value={filters.accountId || "all"}
            onValueChange={(v) =>
              onChange({ accountId: v === "all" ? null : v })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Category Filter */}
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select
            value={filters.categoryId || "all"}
            onValueChange={(v) =>
              onChange({ categoryId: v === "all" ? null : v })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Type Filter */}
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select
            value={filters.type}
            onValueChange={(v) =>
              onChange({ type: v as TransactionFilters["type"] })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Review Status Filter */}
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select
            value={filters.reviewed}
            onValueChange={(v) =>
              onChange({ reviewed: v as TransactionFilters["reviewed"] })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="unreviewed">Needs review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Amount Range */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Min amount</Label>
          <Input
            type="number"
            placeholder="0.00"
            value={filters.amountMin ?? ""}
            onChange={(e) =>
              onChange({
                amountMin: parseMoneyInputNumber(e.target.value),
              })
            }
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max amount</Label>
          <Input
            type="number"
            placeholder="No limit"
            value={filters.amountMax ?? ""}
            onChange={(e) =>
              onChange({
                amountMax: parseMoneyInputNumber(e.target.value),
              })
            }
            className="h-9"
          />
        </div>
      </div>
    </div>
  );
}
