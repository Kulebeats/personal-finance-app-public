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
  monthIndex?: number;
  [key: string]: string | number | undefined;
}

export const IncomePerMonthWidget: React.FC<BaseWidgetProps> = (props) => {
  const { from } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.income),
    monthIndex: m.monthIndex,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    const monthIdx = datum.monthIndex ?? 1;
    const monthStart = `${new Date(from).getFullYear()}-${String(
      monthIdx,
    ).padStart(2, "0")}-01`;
    const monthEnd = new Date(new Date(from).getFullYear(), monthIdx, 0)
      .toISOString()
      .split("T")[0];
    drillDown({ from: monthStart, to: monthEnd, type: "income" });
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
  const { from } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.expenses),
    monthIndex: m.monthIndex,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    const monthIdx = datum.monthIndex ?? 1;
    const monthStart = `${new Date(from).getFullYear()}-${String(
      monthIdx,
    ).padStart(2, "0")}-01`;
    const monthEnd = new Date(new Date(from).getFullYear(), monthIdx, 0)
      .toISOString()
      .split("T")[0];
    drillDown({ from: monthStart, to: monthEnd, type: "expense" });
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
  const { from } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });
  const trendingData = (data?.monthly || []).map((m) => ({
    label: m.month,
    value: toMoneyNumber(m.savingsContributions),
    monthIndex: m.monthIndex,
  }));

  const handleBarClick = (datum: BarClickDatum) => {
    const monthIdx = datum.monthIndex ?? 1;
    const monthStart = `${new Date(from).getFullYear()}-${String(
      monthIdx,
    ).padStart(2, "0")}-01`;
    const monthEnd = new Date(new Date(from).getFullYear(), monthIdx, 0)
      .toISOString()
      .split("T")[0];
    drillDown({ from: monthStart, to: monthEnd });
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
    label: m.period,
    value: toMoneyNumber(m.change),
  }));
  return (
    <TrendingWidget
      {...props}
      title="Net Worth Change"
      description="Monthly delta in net worth"
      data={trendingData}
      isLoading={isLoading}
      error={error}
      color={(d: { value: number }) =>
        d.value >= 0 ? NET_WORTH_COLOR : EXPENSE_COLOR
      }
      avgColor="#64748b"
    />
  );
};
