import { useState } from "react";
import { TrendingUp, TrendingDown, DollarSign, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isParsableMoneyString, parseMoneyString } from "@/lib/money";
import { SummaryStandardView, SummaryDetailView, SummaryChartView, type SummaryAmount } from "./TransactionSummaryViews";

interface TransactionSummaryPanelProps {
  income?: SummaryAmount;
  expenses?: SummaryAmount;
  netFlow?: SummaryAmount;
  transactionCount?: number;
  currency?: string;
  period?: string;
  isLoading?: boolean;
  error?: string | null;
  largestTransaction?: SummaryAmount | null;
  largestExpense?: SummaryAmount | null;
  averageTransaction?: SummaryAmount | null;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function TransactionSummaryPanel({
  income, expenses, netFlow, transactionCount, currency = "ZMW", period, isLoading = false, error,
  largestTransaction, largestExpense, averageTransaction, firstTransactionDate, lastTransactionDate,
  isCollapsed, className,
}: TransactionSummaryPanelProps) {
  const [currentView, setCurrentView] = useState(0);
  const available = [income, expenses, netFlow].every(value => value !== undefined && isParsableMoneyString(value))
    && typeof transactionCount === "number" && Number.isSafeInteger(transactionCount) && transactionCount >= 0;
  const unavailable = !!error || !available;
  const status = isLoading ? "Loading summary…" : unavailable ? "Summary unavailable" : undefined;
  const netDirection = netFlow !== undefined && available ? parseMoneyString(netFlow).comparedTo(0) : 0;
  const netFlowColor = netFlow !== undefined && !unavailable && !isLoading
    ? netDirection > 0 ? "text-green-600" : netDirection < 0 ? "text-red-600" : "text-muted-foreground"
    : "text-muted-foreground";
  const netFlowBg = netFlow !== undefined && !unavailable && !isLoading
    ? netDirection > 0 ? "bg-green-500/10" : netDirection < 0 ? "bg-red-500/10" : "bg-muted/50"
    : "bg-muted/50";

  if (isCollapsed) {
    return <div role="region" aria-label="Transaction summary" aria-busy={isLoading}
      title={status ?? "Summary collapsed"} className={cn("flex flex-col gap-2 w-12 sticky top-24", className)}>
      {status && <span className="sr-only" role={isLoading ? "status" : "alert"}>{status}{!isLoading && error ? `. ${error}` : ""}</span>}
      <div className="flex flex-col gap-2 items-center">
        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-green-600" /></div>
        <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center"><TrendingDown className="w-4 h-4 text-red-600" /></div>
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", netFlowBg)}><DollarSign className={cn("w-4 h-4", netFlowColor)} /></div>
      </div>
    </div>;
  }

  const renderView = () => {
    // All views share admission: cached numbers cannot leak through the detail
    // or chart carousel while a new summary is pending or has failed.
    if (isLoading || unavailable || income === undefined || expenses === undefined || netFlow === undefined || transactionCount === undefined) return null;
    switch (currentView) {
      case 0:
        return <SummaryStandardView income={income} expenses={expenses} netFlow={netFlow}
          transactionCount={transactionCount} currency={currency} netFlowColor={netFlowColor} />;
      case 1:
        return <SummaryDetailView income={income} expenses={expenses} transactionCount={transactionCount} currency={currency}
          largestTransaction={largestTransaction} largestExpense={largestExpense} averageTransaction={averageTransaction}
          firstTransactionDate={firstTransactionDate} lastTransactionDate={lastTransactionDate} />;
      case 2:
        return <SummaryChartView income={income} expenses={expenses} netFlow={netFlow} currency={currency} netFlowColor={netFlowColor} />;
      default:
        return null;
    }
  };

  return <Card role="region" aria-label="Transaction summary" aria-busy={isLoading}
    className={cn("w-72 p-4 sticky top-24 h-fit space-y-4", className)}>
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!!status}
        onClick={() => setCurrentView(previous => (previous - 1 + 3) % 3)} aria-label="Previous summary view">
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <h3 className="font-semibold text-sm">Summary</h3>
      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!!status}
        onClick={() => setCurrentView(previous => (previous + 1) % 3)} aria-label="Next summary view">
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
    {period && <p className="text-xs text-muted-foreground">{period}</p>}
    <div className="pt-2">
      {isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading summary…</p>
        : unavailable ? <div role="alert" className="space-y-2 text-sm">
          <p className="font-medium">Summary unavailable</p>
          {error && <p className="text-muted-foreground">{error}</p>}
        </div> : renderView()}
    </div>
    {!status && <div className="flex justify-center gap-1.5 pt-2">
      {[0, 1, 2].map(index => <div key={index} className={cn("w-1.5 h-1.5 rounded-full transition-colors",
        currentView === index ? "bg-primary" : "bg-muted")} />)}
    </div>}
  </Card>;
}