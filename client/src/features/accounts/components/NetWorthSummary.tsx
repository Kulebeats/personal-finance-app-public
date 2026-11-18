import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/api";
import { AccountTypeGroup, AccountsSummaryData } from "../types";

export type SummaryMode = "totals" | "percent";

interface NetWorthSummaryProps {
  data: AccountsSummaryData;
  groupedAccounts: Record<string, Account[]>;
  assetGroups: AccountTypeGroup[];
  liabilityGroups: AccountTypeGroup[];
  summaryMode: SummaryMode;
  onSummaryModeChange: (mode: SummaryMode) => void;
  onExport: () => void;
  isExporting: boolean;
  getGroupTotal: (accounts: Account[]) => number;
}

export function NetWorthSummary({
  data,
  groupedAccounts,
  assetGroups,
  liabilityGroups,
  summaryMode,
  onSummaryModeChange,
  onExport,
  isExporting,
  getGroupTotal,
}: NetWorthSummaryProps) {
  return (
    <Card className="p-6 shadow-sm border-border bg-card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-bold text-lg">Summary</h2>
        {/* HIGH-004: Added ARIA roles for accessibility (WCAG 4.1.2) */}
        <div
          role="radiogroup"
          aria-label="Summary display mode"
          className="flex bg-muted/50 p-1 rounded-md"
        >
          <button
            role="radio"
            aria-checked={summaryMode === "totals"}
            onClick={() => onSummaryModeChange("totals")}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
              summaryMode === "totals"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Totals
          </button>
          <button
            role="radio"
            aria-checked={summaryMode === "percent"}
            onClick={() => onSummaryModeChange("percent")}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
              summaryMode === "percent"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Percent
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {/* Assets Section */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline mb-2">
            <span className="font-semibold text-sm">Assets</span>
            <span className="font-bold text-foreground">
              {summaryMode === "percent"
                ? "100%"
                : `K${data.totalAssets.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
            </span>
          </div>

          {/* Breakdown by type */}
          <div className="space-y-2 pt-2">
            {assetGroups.map((groupName) => {
              const groupAccounts = groupedAccounts[groupName];
              if (!groupAccounts || groupAccounts.length === 0) return null;
              const total = getGroupTotal(groupAccounts);
              const percent =
                data.totalAssets > 0 ? (total / data.totalAssets) * 100 : 0;

              return (
                <div
                  key={groupName}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-muted-foreground">{groupName}</span>
                  </div>
                  <span className="font-medium text-foreground">
                    {summaryMode === "percent"
                      ? `${percent.toFixed(1)}%`
                      : `K${total.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Liabilities Section */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline mb-2">
            <span className="font-semibold text-sm">Liabilities</span>
            <span className="font-bold text-foreground">
              {summaryMode === "percent"
                ? "100%"
                : `K${data.totalLiabilities.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
            </span>
          </div>

          <div className="space-y-2 pt-2">
            {liabilityGroups.map((groupName) => {
              const groupAccounts = groupedAccounts[groupName];
              if (!groupAccounts || groupAccounts.length === 0) return null;
              const total = Math.abs(getGroupTotal(groupAccounts));
              const percent =
                data.totalLiabilities > 0
                  ? (total / data.totalLiabilities) * 100
                  : 0;

              return (
                <div
                  key={groupName}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-muted-foreground">{groupName}</span>
                  </div>
                  <span className="font-medium text-foreground">
                    {summaryMode === "percent"
                      ? `${percent.toFixed(1)}%`
                      : `K${total.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-8 pt-4 border-t border-border/50 text-center">
        <button
          onClick={onExport}
          disabled={isExporting}
          aria-label={isExporting ? "Downloading CSV export" : "Download CSV export"}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Downloading...
            </>
          ) : (
            "Download CSV"
          )}
        </button>
      </div>
    </Card>
  );
}
