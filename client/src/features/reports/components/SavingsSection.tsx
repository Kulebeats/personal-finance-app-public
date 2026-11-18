/**
 * SavingsSection Component
 *
 * Displays savings rate as a bar chart
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { INCOME_COLOR } from "../utils/chartTheme";

interface SavingsDataPoint {
  month: string;
  rate: number;
}

interface SavingsSectionProps {
  data: SavingsDataPoint[];
  isLoading: boolean;
}

const chartConfig: ChartConfig = {
  rate: { label: "Savings Rate (%)", color: INCOME_COLOR },
};

const formatPercent = (value: number) => `${value}%`;

export function SavingsSection({ data, isLoading }: SavingsSectionProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No savings rate data for this period.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="w-full h-full">
      <BarChart
        data={data}
        margin={{ top: 50, right: 130, bottom: 50, left: 60 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatPercent(Number(value))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatPercent(Number(value))}
            />
          }
        />
        <Bar dataKey="rate" fill={INCOME_COLOR} radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
