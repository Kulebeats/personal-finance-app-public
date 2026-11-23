/**
 * IncomeSection Component
 *
 * Displays income vs expenses as a grouped bar chart
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Link } from "wouter";
import { FileText, Loader2 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { INCOME_COLOR, EXPENSE_COLOR } from "../utils/chartTheme";
import { formatAxisValue } from "../utils/reportFormatters";

const chartConfig = {
  income: { label: "Income", color: INCOME_COLOR },
  expenses: { label: "Expenses", color: EXPENSE_COLOR },
} satisfies ChartConfig;

interface IncomeDataPoint {
  month: string;
  income: number;
  expenses: number;
}

interface IncomeSectionProps {
  data: IncomeDataPoint[];
  isLoading: boolean;
  /** Called with which series (income or expense) was clicked, for drill-down into filtered transactions. */
  onSegmentClick?: (type: "income" | "expense") => void;
}

export function IncomeSection({ data, isLoading, onSegmentClick }: IncomeSectionProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {/* Tax Season Banner */}
      <div className="bg-blue-50 border border-blue-100 p-4 rounded-md mb-4 flex items-center gap-3 text-blue-800">
        <FileText className="w-5 h-5 shrink-0" />
        <p className="text-sm">
          <strong>Tax Season?</strong> View your{" "}
          <Link to="/investments?tab=tax" className="underline hover:text-blue-600">
            Investment Tax Reports
          </Link>{" "}
          for detailed dividend and interest schedules.
        </p>
      </div>

      {!data.length ? (
        <div className="flex items-center justify-center h-80 text-sm text-muted-foreground">
          No income data for this period.
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="w-full" style={{ height: 400 }}>
          <BarChart
            data={data}
            margin={{ top: 50, right: 130, bottom: 50, left: 80 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatAxisValue(Number(value))}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="income"
              fill={INCOME_COLOR}
              radius={4}
              onClick={onSegmentClick ? () => onSegmentClick("income") : undefined}
              cursor={onSegmentClick ? "pointer" : undefined}
            />
            <Bar
              dataKey="expenses"
              fill={EXPENSE_COLOR}
              radius={4}
              onClick={onSegmentClick ? () => onSegmentClick("expense") : undefined}
              cursor={onSegmentClick ? "pointer" : undefined}
            />
          </BarChart>
        </ChartContainer>
      )}
    </>
  );
}
