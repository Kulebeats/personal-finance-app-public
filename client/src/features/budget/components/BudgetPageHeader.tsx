/**
 * BudgetPageHeader Component
 *
 * Navigation bar for Budget page including:
 * - Page title with view mode toggle (Budget/Forecast)
 * - Month navigation arrows
 * - Today button, Timeframe toggle, Settings button
 */

import { cn } from "@/lib/utils";
import { Settings, ArrowLeft, ArrowRight } from "lucide-react";

interface BudgetPageHeaderProps {
  headerLabel: string;
  viewMode: "budget" | "forecast";
  setViewMode: (mode: "budget" | "forecast") => void;
  timeframe: "monthly" | "yearly";
  setTimeframe: (tf: "monthly" | "yearly") => void;
  onShiftMonth: (delta: -1 | 1) => void;
  onResetToToday: () => void;
  onOpenSettings: () => void;
  isMobile: boolean;
}

export function BudgetPageHeader({
  headerLabel,
  viewMode,
  setViewMode,
  timeframe,
  setTimeframe,
  onShiftMonth,
  onResetToToday,
  onOpenSettings,
  isMobile,
}: BudgetPageHeaderProps) {
  return (
    // Both rows wrap on a phone, and every control there is at least 44 px
    // (`max-md:min-h-11`), so the header never pushes the page sideways (UX-02).
    <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
      <div className="flex flex-wrap items-center gap-3 md:gap-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          {headerLabel}
        </h1>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
          <button
            onClick={() => setViewMode("budget")}
            className={cn(
              "px-4 py-1 max-md:min-h-11 rounded-md text-sm font-medium transition-all",
              viewMode === "budget"
                ? "bg-background dark:bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Budget
          </button>
          {!isMobile && (
            <button
              onClick={() => setViewMode("forecast")}
              className={cn(
                "px-4 py-1 max-md:min-h-11 rounded-md text-sm font-medium transition-all",
                viewMode === "forecast"
                  ? "bg-background dark:bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Forecast
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center bg-card dark:bg-card border border-border rounded-md shadow-sm">
          <button
            onClick={() => onShiftMonth(-1)}
            className="p-2 max-md:h-11 max-md:w-11 inline-flex items-center justify-center hover:bg-muted/50 border-r border-border"
            aria-label="Previous month"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => onShiftMonth(1)}
            className="p-2 max-md:h-11 max-md:w-11 inline-flex items-center justify-center hover:bg-muted/50"
            aria-label="Next month"
          >
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={onResetToToday}
          className="px-4 py-2 max-md:min-h-11 bg-card dark:bg-card border border-border rounded-md text-sm font-medium"
        >
          Today
        </button>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
          <button
            onClick={() => setTimeframe("monthly")}
            className={cn(
              "px-3 py-1 max-md:min-h-11 rounded-md text-xs font-semibold uppercase transition-all",
              timeframe === "monthly"
                ? "bg-background dark:bg-card shadow-sm"
                : "text-muted-foreground"
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setTimeframe("yearly")}
            className={cn(
              "px-3 py-1 max-md:min-h-11 rounded-md text-xs font-semibold uppercase transition-all",
              timeframe === "yearly"
                ? "bg-background dark:bg-card shadow-sm"
                : "text-muted-foreground"
            )}
          >
            Yearly
          </button>
        </div>
        <button
          onClick={onOpenSettings}
          data-budget-settings-opener
          className="px-4 py-2 max-md:min-h-11 bg-card dark:bg-card border border-border rounded-md text-sm font-medium flex items-center gap-2"
        >
          <Settings className="w-4 h-4" aria-hidden="true" /> Settings
        </button>
      </div>
    </div>
  );
}
