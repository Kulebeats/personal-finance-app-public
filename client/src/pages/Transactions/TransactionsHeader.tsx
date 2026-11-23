/**
 * Transactions Page Header
 *
 * Contains search, filters, import/export, and view toggle controls.
 */

import { Plus, Download, PanelRightOpen, List, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  TransactionSearch,
  AdvancedFilterPopover,
  FilterPresetSelector,
  type TransactionFilters,
} from "@/features/transactions";
import { DateRangePopover } from "@/components/transactions/DateRangePopover";

interface TransactionsHeaderProps {
  filters: TransactionFilters;
  setFilters: (filters: Partial<TransactionFilters>) => void;
  resetFilters: () => void;
  /** Replace every filter with a saved preset's filters. */
  applyFilters: (filters: TransactionFilters) => void;
  activeFilterCount: number;
  dateRangeValue: { startDate: Date | undefined; endDate: Date | undefined };
  setDateRangeValue: (range: { startDate: Date | undefined; endDate: Date | undefined }) => void;
  groupByDate: boolean;
  setGroupByDate: (value: boolean) => void;
  summaryCollapsed: boolean;
  setSummaryCollapsed: (value: boolean) => void;
  onImport: () => void;
  onExport: () => void;
  onAddTransaction: () => void;
}

export function TransactionsHeader({
  filters,
  setFilters,
  resetFilters,
  applyFilters,
  activeFilterCount,
  dateRangeValue,
  setDateRangeValue,
  groupByDate,
  setGroupByDate,
  summaryCollapsed,
  setSummaryCollapsed,
  onImport,
  onExport,
  onAddTransaction,
}: TransactionsHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between mb-6 gap-3 md:gap-4">
      <h1 className="text-2xl font-bold shrink-0">Transactions</h1>

      <div className="flex w-full flex-wrap items-center gap-2 min-w-0 md:w-auto md:flex-1 md:justify-end">
        <TransactionSearch
          value={filters.search}
          onChange={(search) => setFilters({ search })}
          className="w-full sm:w-auto sm:max-w-[240px]"
        />
        <DateRangePopover value={dateRangeValue} onChange={setDateRangeValue} />
        <AdvancedFilterPopover
          filters={filters}
          onChange={setFilters}
          onReset={resetFilters}
          activeCount={activeFilterCount}
        />
        <FilterPresetSelector context="transactions" currentFilters={filters} onSelectPreset={applyFilters} />

        <div className="hidden h-6 w-px bg-border mx-2 md:block" aria-hidden="true" />

        <Button variant="outline" size="sm" onClick={onImport}>
          <Download className="h-4 w-4 mr-1" />
          Import
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} title="Export to CSV (Ctrl+E)">
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
        <Button size="sm" onClick={onAddTransaction}>
          <Plus className="h-4 w-4 mr-1" />
          Add Transaction
        </Button>

        <div className="hidden h-6 w-px bg-border md:block" aria-hidden="true" />

        <Button
          variant="outline"
          size="icon"
          onClick={() => setGroupByDate(!groupByDate)}
          className={cn("w-9 h-9", groupByDate && "bg-accent text-accent-foreground border-primary")}
          title={groupByDate ? "Flat list view" : "Group by date"}
          aria-label={groupByDate ? "Switch to flat list view" : "Group transactions by date"}
        >
          {groupByDate ? <List className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={() => setSummaryCollapsed(!summaryCollapsed)}
          className={cn("w-9 h-9", !summaryCollapsed && "bg-accent text-accent-foreground border-primary")}
          title={summaryCollapsed ? "Show Summary" : "Hide Summary"}
          aria-label={summaryCollapsed ? "Show summary panel" : "Hide summary panel"}
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
