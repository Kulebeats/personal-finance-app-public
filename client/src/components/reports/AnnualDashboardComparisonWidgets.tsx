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
import { ComparisonWidget, type ComparisonDataPoint } from "./ComparisonWidget";
import { groupByPeriod, sumField } from "./annualPeriods";
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
  const { year } = useCurrentYearRange();
  const { drillDown } = useDrillDown();
  const { data, isLoading, error } = useReportsAnnual({ year });

  // R12.3: drill into the clicked period by its own dates, never its label.
  const handleBarClick = (datum: ComparisonDataPoint) => {
    if (typeof datum.periodStart === "string" && typeof datum.periodEnd === "string") {
      drillDown({ from: datum.periodStart, to: datum.periodEnd });
    }
  };

  const compData = useMemo((): ComparisonDataPoint[] => {
    const grouping = props.aggregation === "quarterly" ? "quarterly" : "monthly";
    return groupByPeriod(data?.monthly ?? [], grouping).map((bucket) => ({
      label: grouping === "monthly" ? bucket.rows[0].month : bucket.label,
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      primary: toMoneyNumber(sumField(bucket, (m) => m.income)),
      secondary: toMoneyNumber(sumField(bucket, (m) => m.expenses)),
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
  const { year } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsAnnual({ year });

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
  const { year } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsAnnual({ year });

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
