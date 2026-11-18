import { useState, useEffect } from "react";
import { Filter, Calendar, Users, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DateRangePopover,
  type DateRange,
} from "@/components/transactions/DateRangePopover";
import { type CashFlowFiltersState } from "../types";
import { toISODate, fromISODate } from "../utils/dateHelpers";
import { FilterOptions } from "./FilterOptions";

interface CashFlowFiltersProps {
  filters: CashFlowFiltersState;
  onFiltersChange: (filters: CashFlowFiltersState) => void;
  defaultFilters: CashFlowFiltersState;
}

export function CashFlowFilters({
  filters,
  onFiltersChange,
  defaultFilters,
}: CashFlowFiltersProps) {
  const [open, setOpen] = useState(false);
  const [draftFilters, setDraftFilters] =
    useState<CashFlowFiltersState>(filters);

  // Sync draft with external filters when modal opens
  useEffect(() => {
    if (open) {
      setDraftFilters(filters);
    }
  }, [open, filters]);

  const handleApply = () => {
    onFiltersChange(draftFilters);
    setOpen(false);
  };

  const handleClear = () => {
    setDraftFilters(defaultFilters);
  };

  const handleDateRangeChange = (range: DateRange) => {
    if (range.startDate && range.endDate) {
      setDraftFilters((prev) => ({
        ...prev,
        from: toISODate(range.startDate!),
        to: toISODate(range.endDate!),
      }));
    }
  };

  // Count active filters (non-default)
  const activeFilterCount = [
    filters.from !== defaultFilters.from || filters.to !== defaultFilters.to,
    filters.interval !== defaultFilters.interval,
    filters.scope !== defaultFilters.scope,
    filters.includePending !== defaultFilters.includePending,
    filters.includeTransfers !== defaultFilters.includeTransfers,
    filters.includeForecast !== defaultFilters.includeForecast,
  ].filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="relative min-h-[44px]">
          <Filter className="w-4 h-4" />
          Filter
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-background text-primary text-xs font-bold rounded-full flex items-center justify-center border border-primary">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Filter Cash Flow</DialogTitle>
          <DialogDescription>
            Choose the date range, grouping, scope, and transaction types for
            this cash-flow view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Date Range */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Date Range
            </Label>
            <DateRangePopover
              value={{
                startDate: fromISODate(draftFilters.from),
                endDate: fromISODate(draftFilters.to),
              }}
              onChange={handleDateRangeChange}
              className="w-full justify-start"
            />
          </div>

          {/* Interval */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Group By
            </Label>
            <Select
              value={draftFilters.interval}
              onValueChange={(value: "day" | "week" | "month") =>
                setDraftFilters((prev) => ({
                  ...prev,
                  interval: value,
                  // Reset forecast when switching away from monthly
                  includeForecast: value === "month" ? prev.includeForecast : false,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Users className="w-4 h-4 text-muted-foreground" />
              Show Data For
            </Label>
            <Select
              value={draftFilters.scope}
              onValueChange={(value: "household" | "mine") =>
                setDraftFilters((prev) => ({ ...prev, scope: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="household">Entire Household</SelectItem>
                <SelectItem value="mine">Only My Transactions</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filter Options (Forecast, Pending, Transfers) */}
          <FilterOptions
            filters={draftFilters}
            onFiltersChange={setDraftFilters}
          />
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            className="text-muted-foreground"
          >
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
            >
              Apply Filters
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
