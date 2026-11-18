/**
 * Comparison Widgets for Annual Dashboard
 *
 * Extracted from AnnualDashboard.tsx for maintainability.
 */

import React, { useMemo } from "react";
import {
  useReportsAnnual,
  useCurrentYearRange,
  useReportsNetWorth,
} from "@/hooks/use-reports";
import { useDrillDown } from "@/hooks/use-drilldown";
import { ComparisonWidget } from "./ComparisonWidget";
import { toMoneyNumber } from "@/lib/money";
import { AggregationLevel } from "./AggregationFilter";
import {
  INCOME_COLOR,
  EXPENSE_COLOR,
  NET_WORTH_COLOR,
} from "@/features/reports";

interface BaseWidgetProps {
  className?: string;
  onHide?: () => void;
  aggregation?: AggregationLevel;
}

export const IncomeVsExpensesComparisonWidget: React.FC<BaseWidgetProps> = (
  props,
) => {
  const { from } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });

  const handleBarClick = (datum: { label: string }) => {
    // Find month index from label (e.g., "Jan")
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthIdx = months.indexOf(datum.label) + 1;

    if (monthIdx > 0) {
      const year = new Date(from).getFullYear();
      const monthStart = `${year}-${String(monthIdx).padStart(2, "0")}-01`;
      const monthEnd = new Date(year, monthIdx, 0).toISOString().split("T")[0];
      drillDown({ from: monthStart, to: monthEnd });
    }
  };

  const compData = useMemo(() => {
    const raw = data?.monthly || [];
    if (props.aggregation === "quarterly") {
      const quarters = ["Q1", "Q2", "Q3", "Q4"];
      return quarters.map((q, i) => {
        const slice = raw.filter((m) => Math.floor(m.monthIndex / 3.01) === i);
        return {
          label: q,
          primary: slice.reduce((sum, m) => sum + toMoneyNumber(m.income), 0),
          secondary: slice.reduce(
            (sum, m) => sum + toMoneyNumber(m.expenses),
            0,
          ),
        };
      });
    }
    return raw.map((m) => ({
      label: m.month,
      primary: toMoneyNumber(m.income),
      secondary: toMoneyNumber(m.expenses),
    }));
  }, [data, props.aggregation]);

  return (
    <ComparisonWidget
      {...props}
      title={`Income vs Expenses ${
        props.aggregation === "quarterly" ? "(Quarterly)" : "(Monthly)"
      }`}
      description="Comparison trend over time"
      data={compData}
      primaryKey="Income"
      secondaryKey="Expenses"
      isLoading={isLoading}
      error={error}
      primaryColor={INCOME_COLOR}
      secondaryColor={EXPENSE_COLOR}
      onBarClick={handleBarClick}
    />
  );
};

export const IncomeVsSavedComparisonWidget: React.FC<BaseWidgetProps> = (
  props,
) => {
  const { from } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });

  const compData = useMemo(() => {
    return (data?.monthly || []).map((m) => ({
      label: m.month,
      primary: toMoneyNumber(m.income),
      secondary: toMoneyNumber(m.savingsContributions),
    }));
  }, [data]);

  return (
    <ComparisonWidget
      {...props}
      title="Income vs Savings"
      description="How much of your income goes to savings"
      data={compData}
      primaryKey="Income"
      secondaryKey="Saved"
      isLoading={isLoading}
      error={error}
      primaryColor={INCOME_COLOR}
      secondaryColor="#3b82f6"
    />
  );
};

export const DebtToIncomeComparisonWidget: React.FC<BaseWidgetProps> = (
  props,
) => {
  const { from } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsAnnual({
    year: new Date(from).getFullYear(),
  });

  const compData = useMemo(() => {
    return (data?.monthly || []).map((m) => ({
      label: m.month,
      primary:
        toMoneyNumber(m.income) > 0
          ? (toMoneyNumber(m.debtPaid) / toMoneyNumber(m.income)) * 100
          : 0,
      secondary: 36, // Healthy DTI threshold
    }));
  }, [data]);

  return (
    <ComparisonWidget
      {...props}
      title="DTI Trend"
      description="Debt-to-Income ratio over time"
      data={compData}
      primaryKey="DTI (%)"
      secondaryKey="Healthy Limit (36%)"
      isLoading={isLoading}
      error={error}
      primaryColor="#f97316"
      secondaryColor="#64748b"
      defaultChartType="line"
    />
  );
};

export const NetWorthTrendWidget: React.FC<BaseWidgetProps> = (props) => {
  const { from, to } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsNetWorth({
    from,
    to,
    interval: "month",
  });

  const compData = useMemo(() => {
    return (data?.series?.[0]?.data || []).map((point) => ({
      label: String(point.x),
      primary: toMoneyNumber(point.y),
      secondary: 0,
    }));
  }, [data]);

  return (
    <ComparisonWidget
      {...props}
      title="Net Worth Trend"
      description="Your total net worth over time"
      data={compData}
      primaryKey="Net Worth"
      secondaryKey=""
      isLoading={isLoading}
      error={error}
      primaryColor={NET_WORTH_COLOR}
      secondaryColor="transparent"
      defaultChartType="area"
    />
  );
};
