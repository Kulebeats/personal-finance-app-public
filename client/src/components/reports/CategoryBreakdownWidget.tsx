import { PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  useReportsSpendingBreakdown,
  useCurrentYearRange,
  useReportsAnnual,
} from "@/hooks/use-reports";
import { formatCurrency, toMoneyNumber } from "@/lib/money";
import { ChartA11yToggle } from "./shared/ChartA11yToggle";
import { ChartDataTable } from "./shared/ChartDataTable";
import { CHART_COLORS } from "@/features/reports";

// Nivo pie data item type
interface PieDataItem {
  id: string;
  label: string;
  value: number;
  color: string;
}

const ModernPie = ({
  data,
  title,
  isLoading,
  formatter,
  emptyMessage,
  widgetId,
}: {
  data: PieDataItem[];
  title: string;
  isLoading?: boolean;
  formatter?: (value: number) => string;
  emptyMessage?: string;
  widgetId: string;
}) => {
  const [showTable, setShowTable] = useState(false);
  const tableId = `${widgetId}-table`;

  const chartConfig = data.reduce((acc, item) => {
    acc[item.id] = { label: item.label, color: item.color };
    return acc;
  }, {} as ChartConfig);

  const tableColumns = [
    { key: "label", label: "Category", align: "left" as const },
    {
      key: "value",
      label: "Value",
      align: "right" as const,
      format: (val: unknown) =>
        formatter ? formatter(val as number) : String(val),
    },
  ];

  return (
    <Card
      className="shadow-sm border-border/50 bg-card h-[300px] outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
      tabIndex={0}
      role="region"
      aria-label={title}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        {data.length > 0 && !isLoading && (
          <ChartA11yToggle
            showTable={showTable}
            onToggle={setShowTable}
            tableId={tableId}
          />
        )}
      </CardHeader>
      <CardContent className="h-[240px] overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {emptyMessage ?? "No data for the selected period"}
          </div>
        ) : showTable ? (
          <ChartDataTable
            id={tableId}
            caption={title}
            columns={tableColumns}
            data={data as unknown as Record<string, unknown>[]}
          />
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              className="mx-auto w-full"
              style={{ height: 180 }}
            >
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="id"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  strokeWidth={2}
                >
                  {data.map((d) => (
                    <Cell key={d.id} fill={d.color} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      nameKey="id"
                      formatter={(value) =>
                        formatter ? formatter(Number(value)) : String(value)
                      }
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
            <div className="flex justify-center gap-4 text-xs">
              {data.slice(0, 3).map((d) => (
                <div key={d.id} className="flex items-center gap-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="truncate max-w-[80px]">{d.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

// Color palette for categories
// Using imported CHART_COLORS from constants

export default function CategoryBreakdownWidget() {
  const { from, to, year } = useCurrentYearRange();

  const { data: expensesData, isLoading: expensesLoading } =
    useReportsSpendingBreakdown({
      from,
      to,
      groupBy: "categoryGroup",
      limit: 8,
    });

  // Transform API data to Nivo pie format
  const { data: incomeData, isLoading: incomeLoading } =
    useReportsSpendingBreakdown({
      from,
      to,
      type: "income",
      groupBy: "categoryGroup",
      limit: 8,
    });

  const { data: annualData, isLoading: annualLoading } = useReportsAnnual({
    year,
  });

  const expensePieData =
    expensesData?.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      value: item.percent,
      color: item.color || CHART_COLORS[index % CHART_COLORS.length],
    })) ?? [];

  const incomePieData =
    incomeData?.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      value: item.percent,
      color: item.color || CHART_COLORS[index % CHART_COLORS.length],
    })) ?? [];

  const annualTotals = annualData?.totals;
  const expensesValue = Math.max(toMoneyNumber(annualTotals?.expenses ?? 0), 0);
  const savingsValue = Math.max(
    toMoneyNumber(annualTotals?.savingsContributions ?? 0),
    0,
  );
  const savingsContributionsValue = toMoneyNumber(
    annualTotals?.savingsContributions ?? 0,
  );
  const shortfallValue =
    savingsContributionsValue < 0 ? Math.abs(savingsContributionsValue) : 0;

  const savingsPieData =
    expensesValue === 0 && savingsValue === 0 && shortfallValue === 0
      ? []
      : [
          {
            id: "expenses",
            label: "Expenses",
            value: expensesValue,
            color: "hsl(350, 70%, 60%)",
          },
          shortfallValue > 0
            ? {
                id: "shortfall",
                label: "Shortfall",
                value: shortfallValue,
                color: "hsl(25, 80%, 55%)",
              }
            : {
                id: "savings",
                label: "Savings",
                value: savingsValue,
                color: "hsl(160, 70%, 40%)",
              },
        ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ModernPie
        data={expensePieData}
        title="Expenses Breakdown"
        isLoading={expensesLoading}
        formatter={(v) => `${v.toFixed(1)}%`}
        emptyMessage="No expense data for this period"
        widgetId="expenses-breakdown"
      />
      <ModernPie
        data={incomePieData}
        title="Income Breakdown"
        isLoading={incomeLoading}
        formatter={(v) => `${v.toFixed(1)}%`}
        emptyMessage="No income data for this period"
        widgetId="income-breakdown"
      />
      <ModernPie
        data={savingsPieData}
        title="Savings Breakdown"
        isLoading={annualLoading}
        formatter={(v) => formatCurrency(v, annualData?.baseCurrency ?? "")}
        emptyMessage="No savings data for this period"
        widgetId="savings-breakdown"
      />
    </div>
  );
}
