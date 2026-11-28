import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortfolioSummaryProps {
  totalValue: number;
  totalGainLoss: number | null;
  totalGainLossPercent: number | null;
  displayCurrency: "ZMW" | "USD";
  summaryCurrency?: string;
  summaryState?: "loading" | "unavailable" | "ready";
  onCurrencyChange: (currency: "ZMW" | "USD") => void;
  formatCurrency: (amount: number, currency: string) => string;
  onAddHolding: () => void;
}

export function PortfolioSummary({
  totalValue,
  totalGainLoss,
  totalGainLossPercent,
  displayCurrency,
  summaryCurrency = displayCurrency,
  summaryState = "ready",
  onCurrencyChange,
  formatCurrency,
  onAddHolding,
}: PortfolioSummaryProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          Investments
        </h1>
        {summaryState === "ready" ? <p className="text-muted-foreground">
          Total Value:{" "}
          <span className="font-bold text-foreground">
            {formatCurrency(totalValue, summaryCurrency)}
          </span>{" "}
          {totalGainLoss === null || totalGainLossPercent === null ? (
            <span className="text-sm ml-2">Gain/loss unavailable</span>
          ) : <span
            className={cn(
              "font-medium text-sm ml-2",
              totalGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}
          >
            {totalGainLoss >= 0 ? "+" : ""}
            {formatCurrency(totalGainLoss, summaryCurrency)} (
            {totalGainLossPercent.toFixed(1)}%)
          </span>}
        </p> : <p className="text-muted-foreground" role={summaryState === "loading" ? "status" : "alert"}>
          {summaryState === "loading" ? "Loading portfolio valuation…" : "Portfolio valuation unavailable."}
        </p>}
      </div>
      <div className="flex gap-3 items-center">
        {/* Currency Toggle */}
        <div className="flex bg-muted/50 rounded-md p-1 border border-border/50">
          <button
            onClick={() => onCurrencyChange("ZMW")}
            aria-pressed={displayCurrency === "ZMW"}
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
            aria-pressed={displayCurrency === "USD"}
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
        {/* NEW-37: a "Filter" button stood here with no handler; removed until holdings filtering exists. */}
          <button onClick={onAddHolding} data-holding-opening-trigger className="flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-md text-sm font-medium hover:bg-orange-600 shadow-sm transition-colors">
            <Plus className="w-4 h-4" /> Add Holding
          </button>
      </div>
    </div>
  );
}
