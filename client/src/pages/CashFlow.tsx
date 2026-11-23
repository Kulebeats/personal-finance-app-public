import Layout from "@/components/Layout";
import { Download, Loader2 } from "lucide-react";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  getReportsExportDownloadUrl,
  requestReportExport,
  useCurrentYearRange,
  useReportsBudgetComparison,
} from "@/hooks/use-reports";
import { useFormatters } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { CashFlowFilters } from "@/features/cashflow/components/CashFlowFilters";
import { CashFlowFiltersState } from "@/features/cashflow/types";
import { useToast } from "@/hooks/use-toast";
import { useCashFlowData } from "@/features/cashflow/hooks/useCashFlowData";
import { CashFlowSummary } from "@/features/cashflow/components/CashFlowSummary";
import { CashFlowChart } from "@/features/cashflow/components/CashFlowChart";
import { CashFlowTable } from "@/features/cashflow/components/CashFlowTable";
import { IncomeBreakdown } from "@/features/cashflow/components/IncomeBreakdown";
import { ExpenseBreakdown } from "@/features/cashflow/components/ExpenseBreakdown";
import { BudgetComparison } from "@/features/cashflow/components/BudgetComparison";
import { CurrencyWarning } from "@/features/cashflow/components/CurrencyWarning";
import { ForecastTab } from "@/features/cashflow/components/ForecastTab";

export default function CashFlow() {
  const [view, setView] = useState<"bar" | "sankey" | "budget" | "forecast">("bar");
  const [isExporting, setIsExporting] = useState(false);
  const { from: defaultFrom, to: defaultTo } = useCurrentYearRange();
  const { formatCurrency } = useFormatters();
  const { toast } = useToast();

  // Default filters
  const defaultFilters: CashFlowFiltersState = {
    from: defaultFrom,
    to: defaultTo,
    interval: "month",
    scope: "household",
    includePending: false,
    includeTransfers: false,
    includeForecast: false,
    forecastMonths: 3,
  };

  const [filters, setFilters] = useState<CashFlowFiltersState>(defaultFilters);

  const {
    isLoading,
    error,
    tableIsLoading,
    tableError,
    refetch,
    barChartData,
    sankeyChartData,
    totals,
    averageSavings,
    periodLabel,
    cashflowData,
    interval,
    hasForecast,
    metadata,
  } = useCashFlowData(filters, view === "budget" || view === "forecast" ? "bar" : view);

  // Budget comparison data (only fetch when in budget view)
  const {
    data: budgetData,
    isLoading: budgetIsLoading,
    error: budgetError,
  } = useReportsBudgetComparison(
    {
      from: filters.from,
      to: filters.to,
      interval: filters.interval,
      scope: filters.scope,
      includePending: filters.includePending,
      includeTransfers: filters.includeTransfers,
    },
    { enabled: view === "budget" }
  );

  // Export handler. The exported report matches the active view: the Budget view
  // exports the budget-vs-actual comparison; every other view exports cashflow.
  // Forecast is chart-only and is intentionally NOT exported — a CSV of projected
  // numbers reads as real history, so the export always carries actuals only.
  const handleExport = useCallback(async () => {
    const operation = captureOperationLifetime();
    setIsExporting(true);
    try {
      const exportId = await requestReportExport({
        reportType: view === "budget" ? "budget" : "cashflow",
        format: "csv",
        startDate: filters.from,
        endDate: filters.to,
        interval: filters.interval,
        includePending: filters.includePending,
        includeTransfers: filters.includeTransfers,
        scope: filters.scope,
      });
      await downloadProtectedResource(getReportsExportDownloadUrl(exportId), undefined, operation);

      toast({
        title: "Export complete",
        description: "Your cash flow data has been downloaded.",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description:
          "There was an error exporting your data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [view, filters.from, filters.to, filters.interval, filters.scope, filters.includePending, filters.includeTransfers, toast]);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cash Flow</h1>
            <p className="text-muted-foreground">
              Analyze your income, expenses, and savings over time.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="flex bg-muted/50 p-1 rounded-md border border-border" role="group" aria-label="Chart view options">
              <button
                onClick={() => setView("bar")}
                aria-pressed={view === "bar"}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-sm transition-all min-h-[44px]",
                  view === "bar"
                    ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Trends
              </button>
              <button
                onClick={() => setView("sankey")}
                aria-pressed={view === "sankey"}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-sm transition-all min-h-[44px]",
                  view === "sankey"
                    ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Sankey
              </button>
              <button
                onClick={() => setView("budget")}
                aria-pressed={view === "budget"}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-sm transition-all min-h-[44px]",
                  view === "budget"
                    ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Budget
              </button>
              <button
                onClick={() => setView("forecast")}
                aria-pressed={view === "forecast"}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-sm transition-all min-h-[44px]",
                  view === "forecast"
                    ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Forecast
              </button>
            </div>
            <CashFlowFilters
              filters={filters}
              onFiltersChange={setFilters}
              defaultFilters={defaultFilters}
            />
            <Button
              onClick={handleExport}
              disabled={isExporting}
              variant="default"
              className="flex items-center gap-2 min-h-[44px]"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Export
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <CashFlowSummary
          totals={totals}
          averageSavings={averageSavings}
          periodLabel={periodLabel}
          formatCurrency={formatCurrency}
        />

        {/* Multi-Currency Warning */}
        {metadata && <CurrencyWarning metadata={metadata} />}

        {/* Breakdown Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <IncomeBreakdown filters={filters} />
          <ExpenseBreakdown filters={filters} />
        </div>

        {/* Main Chart Area */}
        {view === "forecast" ? (
          <ForecastTab filters={filters} />
        ) : view === "budget" ? (
          <BudgetComparison
            data={budgetData}
            isLoading={budgetIsLoading}
            error={budgetError}
          />
        ) : (
          <CashFlowChart
            view={view}
            isLoading={isLoading}
            error={error}
            refetch={refetch}
            barChartData={barChartData}
            sankeyChartData={sankeyChartData}
            hasForecast={hasForecast}
          />
        )}

        {/* Detailed Table */}
        <CashFlowTable
          isLoading={tableIsLoading}
          error={tableError}
          data={cashflowData}
          formatCurrency={formatCurrency}
          periodLabel={periodLabel}
          interval={interval}
        />
      </div>
    </Layout>
  );
}
import { downloadProtectedResource } from "@/lib/protected-media";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
