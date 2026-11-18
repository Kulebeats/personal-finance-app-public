import { Card } from "@/components/ui/card";
import { RefreshCw, Filter, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddHoldingModal } from "./AddHoldingModal";
import type { UseMutationResult } from "@tanstack/react-query";

interface PortfolioSummaryProps {
  totalValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  displayCurrency: "ZMW" | "USD";
  onCurrencyChange: (currency: "ZMW" | "USD") => void;
  formatCurrency: (amount: number, currency: string) => string;
  refreshMarketData: UseMutationResult<any, Error, void, unknown>;
}

export function PortfolioSummary({
  totalValue,
  totalGainLoss,
  totalGainLossPercent,
  displayCurrency,
  onCurrencyChange,
  formatCurrency,
  refreshMarketData,
}: PortfolioSummaryProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          Investments
        </h1>
        <p className="text-muted-foreground">
          Total Value:{" "}
          <span className="font-bold text-foreground">
            {formatCurrency(totalValue, displayCurrency)}
          </span>{" "}
          <span
            className={cn(
              "font-medium text-sm ml-2",
              totalGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}
          >
            {totalGainLoss >= 0 ? "+" : ""}
            {formatCurrency(totalGainLoss, displayCurrency)} (
            {totalGainLossPercent.toFixed(1)}%)
          </span>
        </p>
      </div>
      <div className="flex gap-3 items-center">
        {/* Currency Toggle */}
        <div className="flex bg-muted/50 rounded-md p-1 border border-border/50">
          <button
            onClick={() => onCurrencyChange("ZMW")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              displayCurrency === "ZMW"
                ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            ZMW
          </button>
          <button
            onClick={() => onCurrencyChange("USD")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              displayCurrency === "USD"
                ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            USD
          </button>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-md text-sm font-medium hover:bg-orange-600 shadow-sm transition-colors">
          <Filter className="w-4 h-4" /> Filter
        </button>
        <button
          onClick={() => refreshMarketData.mutate()}
          disabled={refreshMarketData.isPending}
          className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 shadow-sm transition-colors border border-slate-200 dark:border-slate-700 disabled:opacity-50"
        >
          <RefreshCw
            className={cn(
              "w-4 h-4",
              refreshMarketData.isPending && "animate-spin"
            )}
          />
          Refresh Prices
        </button>
        <AddHoldingModal>
          <button className="flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-md text-sm font-medium hover:bg-orange-600 shadow-sm transition-colors">
            <Plus className="w-4 h-4" /> Add Holding
          </button>
        </AddHoldingModal>
      </div>
    </div>
  );
}
