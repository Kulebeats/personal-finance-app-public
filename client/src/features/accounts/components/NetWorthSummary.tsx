import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/api";
import { AccountTypeGroup, AccountsSummaryData } from "../types";
import { formatDenominatedAmount } from "@shared/denomination";

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
  const formatAmount = (value: number) => formatDenominatedAmount(value, data.currency) ?? "Amount unavailable";
  if (data.available === false || ![data.totalAssets, data.totalLiabilities, data.netWorthValue].every(value => formatDenominatedAmount(value, data.currency) !== null)) return <Card className="p-6 space-y-3">
    <h2 className="font-bold text-lg">Summary</h2>
    <p>Visible account-linked wealth</p>
    {data.status === "checking" ? <p role="status">Checking current access…</p> :
      <p role="alert">{data.status === "error" ? "Unable to refresh account history. Refresh to try again." : "Valuation unavailable. Refresh to try again."}</p>}
    <p className="text-sm text-muted-foreground">Legacy instruments without proven account access are not included.</p>
  </Card>;
  return (
    <Card className="p-6 shadow-sm border-border bg-card">
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="font-bold text-lg">Summary</h2>
          <p className="text-sm text-muted-foreground">Visible account-linked wealth</p>
          <p className="text-xs text-muted-foreground">Legacy instruments without proven account access are not included.</p>
        </div>
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
              "px-3 py-1 rounded text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 max-md:min-h-11",
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
              "px-3 py-1 rounded text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 max-md:min-h-11",
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
                : formatAmount(data.totalAssets)}
            </span>
          </div>

          {/* Breakdown by type */}
          <div className="space-y-2 pt-2">
            {assetGroups.map((groupName) => {
              const groupAccounts = groupedAccounts[groupName];
              if (!groupAccounts || groupAccounts.length === 0) return null;
              if (data.currency && groupAccounts.some(account => account.currency !== data.currency)) return <div key={groupName} className="flex justify-between text-sm">
                <span>{groupName}</span><span>Base-currency breakdown unavailable</span>
              </div>;
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
                      : formatAmount(total)}
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
                : formatAmount(data.totalLiabilities)}
            </span>
          </div>

          <div className="space-y-2 pt-2">
            {liabilityGroups.map((groupName) => {
              const groupAccounts = groupedAccounts[groupName];
              if (!groupAccounts || groupAccounts.length === 0) return null;
              if (data.currency && groupAccounts.some(account => account.currency !== data.currency)) return <div key={groupName} className="flex justify-between text-sm">
                <span>{groupName}</span><span>Base-currency breakdown unavailable</span>
              </div>;
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
                      : formatAmount(total)}
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
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors flex items-center justify-center gap-2 mx-auto disabled:opacity-50 max-md:min-h-11"
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
