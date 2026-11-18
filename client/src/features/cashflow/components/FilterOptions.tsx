import { Clock, ArrowLeftRight, TrendingUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CashFlowFiltersState } from "../types";

interface FilterOptionsProps {
  filters: CashFlowFiltersState;
  onFiltersChange: (filters: CashFlowFiltersState) => void;
}

export function FilterOptions({ filters, onFiltersChange }: FilterOptionsProps) {
  return (
    <>
      {/* Forecast Section - only show for monthly interval */}
      {filters.interval === "month" && (
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="include-forecast"
              className="flex items-center gap-2 text-sm font-medium cursor-pointer"
            >
              <TrendingUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              Include Forecast
            </Label>
            <Switch
              id="include-forecast"
              checked={filters.includeForecast}
              onCheckedChange={(checked) =>
                onFiltersChange({
                  ...filters,
                  includeForecast: checked,
                })
              }
            />
          </div>

          {filters.includeForecast && (
            <div className="space-y-2 pl-6">
              <Label className="text-sm font-medium">Forecast Horizon</Label>
              <Select
                value={String(filters.forecastMonths)}
                onValueChange={(v) =>
                  onFiltersChange({
                    ...filters,
                    forecastMonths: Number(v),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 month</SelectItem>
                  <SelectItem value="3">3 months</SelectItem>
                  <SelectItem value="6">6 months</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Forecast based on recurring transactions and budgets
              </p>
            </div>
          )}
        </div>
      )}

      {/* Toggle Options */}
      <div className="space-y-4 pt-2 border-t">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="include-pending"
            className="flex items-center gap-2 text-sm font-medium cursor-pointer"
          >
            <Clock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            Include Pending Transactions
          </Label>
          <Switch
            id="include-pending"
            checked={filters.includePending}
            onCheckedChange={(checked) =>
              onFiltersChange({
                ...filters,
                includePending: checked,
              })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <Label
            htmlFor="include-transfers"
            className="flex items-center gap-2 text-sm font-medium cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            Include Transfers
          </Label>
          <Switch
            id="include-transfers"
            checked={filters.includeTransfers}
            onCheckedChange={(checked) =>
              onFiltersChange({
                ...filters,
                includeTransfers: checked,
              })
            }
          />
        </div>
      </div>
    </>
  );
}
