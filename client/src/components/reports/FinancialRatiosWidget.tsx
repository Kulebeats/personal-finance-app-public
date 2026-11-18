/**
 * FinancialRatiosWidget - Core widget showing key financial health metrics
 *
 * Displays DTI, Emergency Fund, Liquidity Ratio, and Burn Rate with status indicators
 */

import React from "react";
import { WidgetCard, WidgetEmptyState } from "./shared/WidgetCard";
import {
  useReportsFinancialRatios,
  useCurrentYearRange,
} from "@/hooks/use-reports";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Wallet,
  PiggyBank,
  Clock,
} from "lucide-react";

// ============================================================================
// STATUS HELPERS
// ============================================================================

function getStatusColor(status: "good" | "warning" | "bad"): string {
  switch (status) {
    case "good":
      return "text-emerald-500";
    case "warning":
      return "text-amber-500";
    case "bad":
      return "text-red-500";
  }
}

function getStatusIcon(status: "good" | "warning" | "bad") {
  switch (status) {
    case "good":
      return CheckCircle2;
    case "warning":
      return AlertTriangle;
    case "bad":
      return TrendingDown;
  }
}

// ============================================================================
// RATIO CARD COMPONENT
// ============================================================================

function RatioCard({
  title,
  value,
  unit,
  description,
  status,
  icon: Icon,
}: {
  title: string;
  value: number;
  unit: string;
  description?: string;
  status?: "good" | "warning" | "bad";
  icon: React.ElementType;
}) {
  const StatusIcon = status ? getStatusIcon(status) : null;
  const statusColor = status ? getStatusColor(status) : "";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{title}</span>
          {StatusIcon && <StatusIcon className={cn("h-4 w-4", statusColor)} />}
        </div>
        <p className={cn("text-lg font-semibold", statusColor)}>
          {value.toFixed(1)}
          {unit}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground truncate">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WIDGET
// ============================================================================

export function FinancialRatiosWidget({
  className,
  onHide,
}: {
  className?: string;
  onHide?: () => void;
}) {
  const yearRange = useCurrentYearRange();
  const { data, isLoading, error } = useReportsFinancialRatios(yearRange);

  return (
    <WidgetCard
      title="Financial Health"
      description="Key financial ratios"
      icon={<TrendingUp className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      className={className}
      onHide={onHide}
    >
      {data ? (
        <div className="grid grid-cols-2 gap-3">
          <RatioCard
            title="Debt-to-Income"
            value={data.ratios.dti.value}
            unit="%"
            status={data.ratios.dti.status}
            icon={DollarSign}
            description="Monthly debt vs income"
          />
          <RatioCard
            title="Emergency Fund"
            value={data.ratios.emergencyFund.months}
            unit=" mo"
            status={data.ratios.emergencyFund.status}
            icon={PiggyBank}
            description="Months of expenses covered"
          />
          <RatioCard
            title="Liquidity Ratio"
            value={data.ratios.liquidityRatio.value}
            unit="x"
            status={data.ratios.liquidityRatio.status}
            icon={Wallet}
            description="Liquid assets vs liabilities"
          />
          <RatioCard
            title="Burn Rate"
            value={data.ratios.burnRate.months}
            unit=" mo"
            status={data.ratios.burnRate.status}
            icon={Clock}
            description="Runway at current spending"
          />
        </div>
      ) : (
        <WidgetEmptyState
          title="No ratios yet"
          description="Add transactions or update account balances to compute ratios"
        />
      )}
    </WidgetCard>
  );
}
