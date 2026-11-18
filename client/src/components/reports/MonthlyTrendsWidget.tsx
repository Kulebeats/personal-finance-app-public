import { useState, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { useReportsAnnual, useCurrentYearRange } from "@/hooks/use-reports";
import { WidgetCard } from "./shared/WidgetCard";
import { ChartTypeSwitcher, ChartType } from "./shared/ChartTypeSwitcher";
import { useFormatters } from "@/contexts/SettingsContext";
import { AggregationLevel } from "./AggregationFilter";
import { toMoneyNumber } from "@/lib/money";
import { MonthlyTrendsChart } from "./MonthlyTrendsChart";

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

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

  const rawData = useMemo(
    () =>
      data?.monthly.map((month) => {
        const date = parseLocalDate(month.periodStart);
        return {
          date,
          monthIdx: date.getMonth(), // 0-11
          monthLabel: date.toLocaleDateString("en-US", { month: "short" }),
          income: toMoneyNumber(month.income),
          expenses: toMoneyNumber(month.expenses),
          savings: toMoneyNumber(month.savingsContributions),
        };
      }) ?? [],
    [data]
  );

  // Client-side aggregation
  const chartData = useMemo(() => {
    if (rawData.length === 0) return [];

    if (aggregation === "monthly") {
      return rawData.map((d) => ({
        label: d.monthLabel,
        income: d.income,
        expenses: d.expenses,
        savings: d.savings,
      }));
    }

    if (aggregation === "quarterly") {
      const quarters = ["Q1", "Q2", "Q3", "Q4"];
      return quarters.map((q, i) => {
        const monthsInQuarter = rawData.filter(
          (d) => Math.floor(d.monthIdx / 3) === i
        );
        return {
          label: q,
          income: monthsInQuarter.reduce((sum, d) => sum + d.income, 0),
          expenses: monthsInQuarter.reduce((sum, d) => sum + d.expenses, 0),
          savings: monthsInQuarter.reduce((sum, d) => sum + d.savings, 0),
        };
      });
    }

    if (aggregation === "biannual") {
      const halves = ["H1", "H2"];
      return halves.map((h, i) => {
        const monthsInHalf = rawData.filter(
          (d) => Math.floor(d.monthIdx / 6) === i
        );
        return {
          label: h,
          income: monthsInHalf.reduce((sum, d) => sum + d.income, 0),
          expenses: monthsInHalf.reduce((sum, d) => sum + d.expenses, 0),
          savings: monthsInHalf.reduce((sum, d) => sum + d.savings, 0),
        };
      });
    }

    if (aggregation === "annual") {
      return [
        {
          label: `${year}`,
          income: rawData.reduce((sum, d) => sum + d.income, 0),
          expenses: rawData.reduce((sum, d) => sum + d.expenses, 0),
          savings: rawData.reduce((sum, d) => sum + d.savings, 0),
        },
      ];
    }

    return [];
  }, [rawData, aggregation, year]);

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
