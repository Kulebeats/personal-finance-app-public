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
  type TransactionFilters,
} from "@/features/transactions";
import { DateRangePopover } from "@/components/transactions/DateRangePopover";

interface TransactionsHeaderProps {
  filters: TransactionFilters;
  setFilters: (filters: Partial<TransactionFilters>) => void;
  resetFilters: () => void;
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
    <div className="flex items-center justify-between mb-6 gap-4">
      <h1 className="text-2xl font-bold shrink-0">Transactions</h1>

      <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
        <TransactionSearch
          value={filters.search}
          onChange={(search) => setFilters({ search })}
          className="max-w-[240px]"
        />
        <DateRangePopover value={dateRangeValue} onChange={setDateRangeValue} />
        <AdvancedFilterPopover
          filters={filters}
          onChange={setFilters}
          onReset={resetFilters}
          activeCount={activeFilterCount}
        />

        <div className="h-6 w-px bg-border mx-2" />

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

        <div className="h-6 w-px bg-border" />

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
