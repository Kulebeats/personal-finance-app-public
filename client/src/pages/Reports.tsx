import { downloadProtectedResource } from "@/lib/protected-media";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
import { useState, useMemo, useEffect, Suspense, lazy } from "react";
import { useCalendarYearMonth } from "@/lib/calendarZone";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { WidgetErrorState } from "@/components/dashboard/WidgetErrorState";
import AnnualDashboard from "@/components/reports/AnnualDashboard";
import { WidgetGalleryModal } from "@/components/reports/WidgetGalleryModal";
import { WidgetOnboardingModal } from "@/components/reports/WidgetOnboardingModal";
import { AggregationLevel } from "@/components/reports/AggregationFilter";
import { useWidgetOnboarding } from "@/hooks/use-report-widget-preferences";
import { useDrillDown } from "@/hooks/use-drilldown";
import {
  getReportsExportDownloadUrl,
  requestReportExport,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

// Feature module imports
import {
  ReportHeader,
  SummaryCards,
  ExportHistory,
  SpendingSection,
  CashFlowDrilldownPanel,
  IncomeSection,
  NetWorthSection,
  SavingsSection,
  MerchantsSection,
  ReportTab,
  useReportsData,
  useMerchantFilters,
  spendingItemToDrillDownFilters,
  type SankeyDrilldownNode,
} from "@/features/reports";

// CashFlowSection renders the heavy nivo Sankey diagram and is only shown on
// the cash-flow tab, so it is lazy-loaded to keep nivo out of the Reports
// page's initial chunk.
const CashFlowSection = lazy(() =>
  import("@/features/reports/components/CashFlowSection").then((m) => ({
    default: m.CashFlowSection,
  })),
);

export default function Reports() {
  // Core state
  const [activeTab, setActiveTab] = useState<ReportTab>("annual");
  const [aggregation, setAggregation] = useState<AggregationLevel>("monthly");
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [selectedNode, setSelectedNode] = useState<
    (SankeyDrilldownNode & { label?: string }) | null
  >(null);
  const [spendingGroupBy, setSpendingGroupBy] = useState<
    "categoryGroup" | "category" | "merchant"
  >("categoryGroup");
  const [location, setLocation] = useLocation();
  const { drillDown } = useDrillDown();

  // Widget onboarding
  const {
    hasCompletedSetup,
    completeOnboarding,
    isLoading: onboardingLoading,
    error: onboardingError,
    refetch: refetchOnboarding,
  } = useWidgetOnboarding();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Date range
  const { from, to, year } = useCurrentYearRange();
  const dateRange = useMemo(() => ({ from, to }), [from, to]);
  // Years around the household calendar's year, never the browser's (NEW-15).
  const { year: calendarYear } = useCalendarYearMonth();
  const availableYears = useMemo(
    () => Array.from({ length: 5 }, (_, i) => calendarYear - 3 + i),
    [calendarYear],
  );

  // Data hooks
  const reportsData = useReportsData({
    activeTab,
    dateRange,
    spendingGroupBy,
    showExportHistory,
  });

  const merchantData = useMerchantFilters({
    yearRange: dateRange,
    enabled: activeTab === "merchants",
  });

  // Effects
  useEffect(() => {
    if (!onboardingLoading && !onboardingError && hasCompletedSetup === false) setShowOnboarding(true);
    else setShowOnboarding(false);
  }, [hasCompletedSetup, onboardingLoading, onboardingError]);

  // Derive last updated timestamp
  const lastUpdated = useMemo(() => {
    switch (activeTab) {
      case "cash-flow":
        return reportsData.sankeyData?.generatedAt;
      case "spending":
        return reportsData.spendingData?.generatedAt;
      case "net-worth":
        return reportsData.netWorthData?.generatedAt;
      case "savings":
        return reportsData.savingsData?.generatedAt;
      case "income":
        return reportsData.cashflowData?.generatedAt;
      default:
        // Fallback for types that share cashflow data
        return reportsData.cashflowData?.generatedAt;
    }
  }, [activeTab, reportsData]);

  // FIX P7b-1: report queries failing used to render a blank chart with no
  // visible error and no retry - the user couldn't tell "broken" from
  // "no data yet". Derive the active tab's query error/refetch (mirrors the
  // lastUpdated switch above) so the Card below can show a real error state.
  const activeTabError = useMemo(() => {
    switch (activeTab) {
      case "cash-flow":
        return reportsData.error.sankey;
      case "spending":
        return reportsData.error.spending;
      case "net-worth":
        return reportsData.error.netWorth;
      case "savings":
        return reportsData.error.savings;
      case "income":
        return reportsData.error.cashflow;
      default:
        return null;
    }
  }, [activeTab, reportsData]);

  const activeTabRefetch = useMemo(() => {
    switch (activeTab) {
      case "cash-flow":
        return reportsData.refetch.sankey;
      case "spending":
        return reportsData.refetch.spending;
      case "net-worth":
        return reportsData.refetch.netWorth;
      case "savings":
        return reportsData.refetch.savings;
      case "income":
        return reportsData.refetch.cashflow;
      default:
        return undefined;
    }
  }, [activeTab, reportsData]);

  // Handlers
  const handleYearChange = (newYear: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("year", newYear);
    setLocation(`${location}?${params.toString()}`);
  };

  const handleExport = async () => {
    const operation = captureOperationLifetime();
    let reportType: "spending" | "cashflow" | "networth" | "transactions" =
      "cashflow";
    let payload: Record<string, string> = {};
    if (activeTab === "annual") {
      reportType = "cashflow";
      payload = { startDate: from, endDate: to, interval: "month" };
    } else if (activeTab === "cash-flow") {
      reportType = "cashflow";
      payload = { startDate: from, endDate: to, interval: "month" };
    } else if (activeTab === "spending") {
      reportType = "spending";
      payload = {
        startDate: from,
        endDate: to,
        groupBy: spendingGroupBy,
        limit: "10",
      };
    } else if (activeTab === "merchants") {
      reportType = "spending";
      payload = {
        startDate: merchantData.dateRange.from,
        endDate: merchantData.dateRange.to,
        groupBy: "merchant",
        limit: String(merchantData.filters.limit),
      };
    } else if (activeTab === "income") {
      reportType = "cashflow";
      payload = { startDate: from, endDate: to, interval: "month" };
    } else if (activeTab === "net-worth") {
      reportType = "networth";
      payload = { startDate: from, endDate: to, interval: "month" };
    } else if (activeTab === "savings") {
      reportType = "cashflow";
      payload = { startDate: from, endDate: to, interval: "month" };
    }
    try {
      const exportId = await requestReportExport({
        reportType,
        format: "csv",
        ...payload,
      });
      await downloadProtectedResource(getReportsExportDownloadUrl(exportId), undefined, operation);
    } catch (error) {
      // FIX UX-REPORTS-EXPORT-001: Add toast notification for export failures
      console.error(error);
      toast({
        title: "Export Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to export report. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Layout>
      <WidgetOnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onComplete={completeOnboarding}
      />
      <div className="space-y-6">
        {(onboardingError || (!onboardingLoading && hasCompletedSetup === undefined)) && <div>
          <p role="alert">Dashboard preferences could not be loaded. {onboardingError?.message ?? "Setup status is unavailable. Please retry."}</p>
          <Button variant="outline" onClick={() => { void refetchOnboarding(); }}>Retry Loading Preferences</Button>
        </div>}
        <ReportHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          year={year}
          onYearChange={handleYearChange}
          availableYears={availableYears}
          aggregation={aggregation}
          onAggregationChange={setAggregation}
          onExport={handleExport}
          showExportHistory={showExportHistory}
          onToggleExportHistory={() => setShowExportHistory((p) => !p)}
          onOpenCustomize={
            activeTab === "annual"
              ? () => setShowCustomizeModal(true)
              : undefined
          }
          lastUpdated={lastUpdated}
        />

        <WidgetGalleryModal
          open={showCustomizeModal}
          onOpenChange={setShowCustomizeModal}
        />

        {showExportHistory && (
          <ExportHistory
            exports={reportsData.exportHistory?.exports ?? []}
            isLoading={reportsData.isLoading.exportHistory}
            onClose={() => setShowExportHistory(false)}
          />
        )}

        {activeTab !== "annual" && activeTab !== "merchants" && (
          <SummaryCards totals={reportsData.totals} />
        )}

        {activeTab === "annual" ? (
          <AnnualDashboard aggregation={aggregation} />
        ) : activeTab === "merchants" ? (
          <Card className="p-6 shadow-sm min-h-[600px] flex flex-col">
            <MerchantsSection
              items={merchantData.items}
              categoryItems={merchantData.categoryItems}
              trendData={merchantData.trendData}
              total={merchantData.total}
              categoryTotal={merchantData.categoryTotal}
              selectedMerchantId={merchantData.selectedMerchantId}
              selectedMerchantLabel={merchantData.selectedMerchantLabel}
              onMerchantSelect={merchantData.onMerchantSelect}
              isLoading={merchantData.isLoading}
              isCategoryLoading={merchantData.isCategoryLoading}
              isTrendLoading={merchantData.isTrendLoading}
              currency={reportsData.currency}
              filters={merchantData.filters}
            />
          </Card>
        ) : (
          <Card className="p-6 shadow-sm min-h-[600px] flex flex-col">
            {activeTabError ? (
              // FIX P7b-1: a failed report query used to leave this Card
              // blank with no indication anything went wrong. Reuse the same
              // WidgetErrorState pattern already shared across every
              // dashboard widget, with a real retry that refetches the
              // failed query for the active tab.
              <div className="flex-1 flex items-center justify-center">
                <WidgetErrorState
                  title="Failed to load report"
                  message={
                    activeTabError instanceof Error
                      ? activeTabError.message
                      : "Something went wrong loading this report."
                  }
                  onRetry={() => {
                    void activeTabRefetch?.();
                  }}
                  className="w-full max-w-md border-none shadow-none"
                />
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "w-full min-h-0 transition-all",
                    selectedNode ? "h-[300px]" : "flex-1",
                  )}
                >
                  {activeTab === "cash-flow" && (
                    <Suspense
                      fallback={
                        <output
                          className="flex items-center justify-center h-full"
                          aria-live="polite"
                          aria-label="Loading cash flow diagram"
                        >
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </output>
                      }
                    >
                      <CashFlowSection
                        data={reportsData.sankeyData ?? null}
                        isLoading={reportsData.isLoading.sankey}
                        onNodeClick={(n) => {
                          // Type guard: only nodes (not links) have an 'id' property
                          if ("id" in n) {
                            setSelectedNode({
                              label: n.label ?? n.id,
                              entityType: n.entityType,
                              entityId: n.entityId,
                            });
                          }
                        }}
                      />
                    </Suspense>
                  )}
                  {activeTab === "spending" && (
                    <SpendingSection
                      data={reportsData.pieData}
                      isLoading={reportsData.isLoading.spending}
                      onClick={(entry) => {
                        const filters = spendingItemToDrillDownFilters(
                          spendingGroupBy,
                          entry.id,
                        );
                        if (filters) drillDown({ ...filters, ...dateRange });
                      }}
                    />
                  )}
                  {activeTab === "income" && (
                    <IncomeSection
                      data={reportsData.barData}
                      isLoading={reportsData.isLoading.cashflow}
                      onSegmentClick={(type) =>
                        drillDown({ type, ...dateRange })
                      }
                    />
                  )}
                  {activeTab === "net-worth" && (
                    <NetWorthSection
                      data={reportsData.netWorthLineData}
                      isLoading={reportsData.isLoading.netWorth}
                      currency={reportsData.currency}
                    />
                  )}
                  {activeTab === "savings" && (
                    <SavingsSection
                      data={reportsData.savingsRateData}
                      isLoading={reportsData.isLoading.savings}
                    />
                  )}
                </div>

                {activeTab === "cash-flow" && (
                  <CashFlowDrilldownPanel
                    node={selectedNode}
                    dateRange={dateRange}
                    onClear={() => setSelectedNode(null)}
                  />
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </Layout>
  );
}
