import { useState, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { useReportsAnnual, useCurrentYearRange } from "@/hooks/use-reports";
import { WidgetCard } from "./shared/WidgetCard";
import { ChartTypeSwitcher, ChartType } from "./shared/ChartTypeSwitcher";
import { useFormatters } from "@/contexts/SettingsContext";
import { AggregationLevel } from "./AggregationFilter";
import { toMoneyNumber } from "@/lib/money";
import { MonthlyTrendsChart } from "./MonthlyTrendsChart";
import { groupByPeriod, sumField } from "./annualPeriods";

interface MonthlyTrendsWidgetProps {
  aggregation?: AggregationLevel;
  onHide?: () => void;
}

export default function MonthlyTrendsWidget({
  aggregation = "monthly",
  onHide,
}: MonthlyTrendsWidgetProps) {
  const { year } = useCurrentYearRange();
  const { data, isLoading, error } = useReportsAnnual({ year });
  const [chartType, setChartType] = useState<ChartType>("bar");
  const { formatCurrency } = useFormatters();

  // R12.3: buckets come from each month's periodStart; sums are Decimal-exact.
  const chartData = useMemo(() => {
    if (aggregation !== "monthly" && aggregation !== "quarterly" && aggregation !== "biannual" && aggregation !== "annual") return [];
    return groupByPeriod(data?.monthly ?? [], aggregation).map((bucket) => ({
      label: bucket.label,
      income: toMoneyNumber(sumField(bucket, (m) => m.income)),
      expenses: toMoneyNumber(sumField(bucket, (m) => m.expenses)),
      savings: toMoneyNumber(sumField(bucket, (m) => m.savingsContributions)),
    }));
  }, [data, aggregation]);

  const lineData = useMemo(() => {
    if (!chartData.length) return [];
    return [
      {
        id: "income",
        data: chartData.map((d) => ({ x: d.label, y: d.income })),
        color: "#10b981",
      },
      {
        id: "expenses",
        data: chartData.map((d) => ({ x: d.label, y: d.expenses })),
        color: "#f43f5e",
      },
      {
        id: "savings",
        data: chartData.map((d) => ({ x: d.label, y: d.savings })),
        color: "#3b82f6",
      },
    ];
  }, [chartData]);

  const isEmpty = !isLoading && chartData.length === 0;

  return (
    <WidgetCard
      title={`${
        aggregation.charAt(0).toUpperCase() + aggregation.slice(1)
      } Trends`}
      description="Income vs Expenses vs Savings"
      icon={<TrendingUp className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      onHide={onHide}
      action={
        <ChartTypeSwitcher
          value={chartType}
          onChange={setChartType}
          allowedTypes={["bar", "line", "area"]}
        />
      }
    >
      <div className="h-[340px] w-full">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No data for this year. Add transactions or change the year.
          </div>
        ) : (
          <MonthlyTrendsChart
            chartType={chartType}
            chartData={chartData}
            lineData={lineData}
            formatCurrency={formatCurrency}
          />
        )}
      </div>
    </WidgetCard>
  );
}
