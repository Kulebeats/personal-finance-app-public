/**
 * Monthly Chart Widgets for Annual Dashboard
 *
 * Extracted from AnnualDashboard.tsx for maintainability.
 */

import React from "react";
import {
  useReportsAnnual,
  useCurrentYearRange,
  useReportsDebt,
  useReportsNetWorthChanges,
} from "@/hooks/use-reports";
import { useDrillDown } from "@/hooks/use-drilldown";
import { TrendingWidget } from "./TrendingWidget";
import { toMoneyNumber } from "@/lib/money";
import { AggregationLevel } from "./AggregationFilter";
import { monthRangeOf } from "./annualPeriods";
import { formatNetWorthChange, netWorthChangeLabel } from "./netWorthChangePresentation";
import {
  INCOME_COLOR,
  EXPENSE_COLOR,
  NET_WORTH_COLOR,
  PRIMARY_CHART_COLOR,
} from "@/features/reports";

interface BaseWidgetProps {
  className?: string;
  onHide?: () => void;
  aggregation?: AggregationLevel;
}

interface BarClickDatum {
  label: string;
  value: number;
  periodStart?: string;
  [key: string]: string | number | undefined;
}

export const IncomePerMonthWidget: React.FC<BaseWidgetProps> = (props) => {
  const { year } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({ year });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.income),
    periodStart: m.periodStart,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    // R12.3: the clicked month's own dates, never its label or array index.
    if (typeof datum.periodStart !== "string") return;
    drillDown({ ...monthRangeOf(datum.periodStart), type: "income" });
  };

  return (
    <TrendingWidget
      {...props}
      title="Income per Month"
      description="Monthly income tracking"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={INCOME_COLOR}
      avgColor={INCOME_COLOR}
      onBarClick={handleBarClick}
    />
  );
};

export const ExpensesPerMonthWidget: React.FC<BaseWidgetProps> = (props) => {
  const { year } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({ year });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.expenses),
    periodStart: m.periodStart,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    // R12.3: the clicked month's own dates, never its label or array index.
    if (typeof datum.periodStart !== "string") return;
    drillDown({ ...monthRangeOf(datum.periodStart), type: "expense" });
  };

  return (
    <TrendingWidget
      {...props}
      title="Expenses per Month"
      description="Monthly spending tracking"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={EXPENSE_COLOR}
      avgColor={EXPENSE_COLOR}
      onBarClick={handleBarClick}
    />
  );
};

export const SavingsPerMonthWidget: React.FC<BaseWidgetProps> = (props) => {
  const { year } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({ year });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.savingsContributions),
    periodStart: m.periodStart,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    // R12.3: the clicked month's own dates, never its label or array index.
    if (typeof datum.periodStart !== "string") return;
    drillDown({ ...monthRangeOf(datum.periodStart) });
  };

  return (
    <TrendingWidget
      {...props}
      title="Savings per Month"
      description="Monthly savings contributions"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={NET_WORTH_COLOR}
      avgColor={NET_WORTH_COLOR}
      onBarClick={handleBarClick}
    />
  );
};

export const DebtPerMonthWidget: React.FC<BaseWidgetProps> = (props) => {
  const { from, to } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsDebt({ from, to });
  const trendingData = (data?.paymentTrend || []).map((m) => ({
    label: m.period,
    value: toMoneyNumber(m.amount),
  }));
  return (
    <TrendingWidget
      {...props}
      title="Debt paid per Month"
      description="Monthly debt repayment"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={PRIMARY_CHART_COLOR}
      avgColor="#9a3412"
    />
  );
};

export const NetWorthChangeWidget: React.FC<BaseWidgetProps> = (props) => {
  const { from, to } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsNetWorthChanges({ from, to });
  const trendingData = (data?.periods || []).map((m) => ({
    label: netWorthChangeLabel(m),
    value: toMoneyNumber(m.change),
  }));
  return (
    <TrendingWidget
      {...props}
      title="Net Worth Change"
      description="Changes between recorded months"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={(d: { value: number }) =>
        d.value >= 0 ? NET_WORTH_COLOR : EXPENSE_COLOR
      }
      avgColor="#64748b"
      average={data?.avgMonthlyChange
        ? { value: toMoneyNumber(data.avgMonthlyChange), label: "Avg/Month" } : null}
      formatValue={(amount) => formatNetWorthChange(amount, data?.range?.currency)}
    />
  );
};
