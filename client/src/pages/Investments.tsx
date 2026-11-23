import { useSearch } from "wouter";
import Layout from "@/components/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Plus } from "lucide-react";
import { useHoldings } from "@/hooks/useInvestments";
import { WidgetErrorState } from "@/components/dashboard/WidgetErrorState";
import {
  useInvestmentsData,
  PortfolioSummary,
  InvestmentPerformance,
  InvestmentAllocation,
  HoldingsList,
  TopMovers,
  GRZSecurities,
  FXImpactPanel,
  TaxReport,
  PensionDashboard,
  RecurringInvestmentSetup,
} from "@/features/investments";
import { HoldingOpeningProvider, useOpenHolding } from "@/features/investments/components/HoldingOpeningProvider";
import { DeleteHoldingProvider, HoldingDeleteRecovery } from "@/features/investments/components/DeleteHoldingDialog";
import { HouseholdPriceRecovery, HouseholdPriceTrigger, HouseholdSecurityPriceProvider } from "@/features/investments/components/HouseholdSecurityPriceDialog";

const INVESTMENT_TABS = ["holdings", "performance", "allocation", "grz", "fx-impact", "tax", "pension", "recurring"] as const;
type InvestmentTab = (typeof INVESTMENT_TABS)[number];

/** `?tab=tax` (etc.) opens that tab; anything else falls back to Holdings. */
function initialTab(search: string): InvestmentTab {
  const requested = new URLSearchParams(search).get("tab");
  return INVESTMENT_TABS.find(tab => tab === requested) ?? "holdings";
}

export default function Investments() {
  return <HoldingOpeningProvider>
    <DeleteHoldingProvider>
      <HouseholdSecurityPriceProvider><InvestmentsContent /></HouseholdSecurityPriceProvider>
    </DeleteHoldingProvider>
  </HoldingOpeningProvider>;
}

function InvestmentsContent() {
  const openHolding = useOpenHolding();
  const tab = initialTab(useSearch());
  const {
    displayCurrency,
    setDisplayCurrency,
    timeframe,
    setTimeframe,
    isLoading,
    holdingsLoading = isLoading,
    holdingsCurrency = displayCurrency,
    summaryCurrency = displayCurrency,
    summaryState = "ready",
    holdings,
    portfolioSummary,
    performanceHistory,
    allocationData,
    totalValue,
    totalGainLoss,
    totalGainLossPercent,
    formatCurrency,
  } = useInvestmentsData();

  // useInvestmentsData does not surface the holdings query error/refetch, so we
  // subscribe to the same query here (deduped by query key, no extra request)
  // to distinguish a failed load from a genuinely empty portfolio.
  const { isError: holdingsError, refetch: refetchHoldings } = useHoldings({
    baseCurrency: displayCurrency,
  });

  const showHoldingsError = !holdingsLoading && holdingsError;
  const noHoldings = !holdingsLoading && holdings.length === 0;

  return (
    <Layout>
      <div className="space-y-6">
        <HoldingDeleteRecovery />
        <HouseholdPriceRecovery />
        <div className="flex justify-end"><HouseholdPriceTrigger /></div>
        {/* Header Summary */}
        {showHoldingsError ? <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Investments</h1>
          <p className="text-muted-foreground">Track your portfolio and holdings</p>
        </div> : <PortfolioSummary
          totalValue={totalValue}
          totalGainLoss={totalGainLoss}
          totalGainLossPercent={totalGainLossPercent}
          displayCurrency={displayCurrency}
          summaryCurrency={summaryCurrency}
          summaryState={summaryState}
          onCurrencyChange={setDisplayCurrency}
          formatCurrency={formatCurrency}
          onAddHolding={openHolding}
        />}

        {/* Tabs */}
        <Tabs key={tab} defaultValue={tab} className="w-full">
          <TabsList className="bg-muted/50 border border-border/50 p-1">
            <TabsTrigger
              value="holdings"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Holdings
            </TabsTrigger>
            <TabsTrigger
              value="performance"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Performance
            </TabsTrigger>
            <TabsTrigger
              value="allocation"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Allocation
            </TabsTrigger>
            <TabsTrigger
              value="grz"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Government (GRZ)
            </TabsTrigger>
            <TabsTrigger
              value="fx-impact"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              FX Impact
            </TabsTrigger>
            <TabsTrigger
              value="tax"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Tax Report
            </TabsTrigger>
            <TabsTrigger
              value="pension"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Pension
            </TabsTrigger>
            <TabsTrigger
              value="recurring"
              className="data-[state=active]:bg-background dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm"
            >
              Recurring
            </TabsTrigger>
          </TabsList>

          {/* Holdings Tab */}
          <TabsContent value="holdings" className="mt-6">
            {showHoldingsError ? <WidgetErrorState
              title="Couldn't load your investments"
              message="We hit a problem loading your portfolio. Please try again."
              onRetry={() => { void refetchHoldings(); }}
            /> : noHoldings ? <Card className="p-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">No Holdings Yet</h2>
              <p className="text-muted-foreground mb-6">Start tracking your investments by adding your first holding.</p>
              <Button type="button" onClick={openHolding} data-holding-opening-trigger><Plus className="w-4 h-4" /> Add Your First Holding</Button>
            </Card> : <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <HoldingsList
                holdings={holdings}
                displayCurrency={holdingsCurrency}
                formatCurrency={formatCurrency}
              />
              <div className="space-y-6">
                <TopMovers
                  holdings={holdings}
                  displayCurrency={holdingsCurrency}
                  formatCurrency={formatCurrency}
                />
              </div>
            </div>}
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="mt-6">
            <InvestmentPerformance
              data={performanceHistory}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              displayCurrency={displayCurrency}
              formatCurrency={formatCurrency}
              totalGainLossPercent={totalGainLossPercent}
            />
          </TabsContent>

          {/* Allocation Tab */}
          <TabsContent value="allocation" className="mt-6">
            {summaryState === "ready" && !holdingsLoading && !holdingsError && summaryCurrency === holdingsCurrency ? <InvestmentAllocation
              data={allocationData}
              totalValue={totalValue}
              displayCurrency={holdingsCurrency}
              formatCurrency={formatCurrency}
            /> : <p role={summaryState === "loading" || holdingsLoading ? "status" : "alert"} className="text-muted-foreground">
              {summaryState === "loading" || holdingsLoading ? "Loading portfolio valuation…" : "Portfolio valuation unavailable."}
            </p>}
          </TabsContent>

          {/* GRZ Tab */}
          <TabsContent value="grz" className="mt-6">
            <GRZSecurities />
          </TabsContent>
          <TabsContent value="fx-impact" className="mt-6">
            <FXImpactPanel />
          </TabsContent>
          <TabsContent value="tax" className="mt-6">
            <TaxReport />
          </TabsContent>
          <TabsContent value="pension" className="mt-6">
            <PensionDashboard />
          </TabsContent>
          <TabsContent value="recurring" className="mt-6">
            <RecurringInvestmentSetup />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
