/**
 * SpendingSection Component
 *
 * Displays spending breakdown as a donut/pie chart
 */

import { PieChart, Pie, Cell } from "recharts";
import { Loader2 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CHART_COLORS } from "@/features/reports";
import { isSyntheticBreakdownId } from "../utils/chartDrilldown";

interface SpendingItem {
  id: string;
  label: string;
  value: number;
  color?: string;
}

interface SpendingSectionProps {
  data: SpendingItem[];
  isLoading: boolean;
  colors?: readonly string[];
}

interface SpendingPieDatum extends SpendingItem {
  color: string;
}

export function SpendingSection({
  data,
  isLoading,
  colors = CHART_COLORS,
  onClick,
}: SpendingSectionProps & { onClick?: (node: SpendingPieDatum) => void }) {
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
        No spending data for this period.
      </div>
    );
  }

  const pieData: SpendingPieDatum[] = data.map((item, i) => ({
    ...item,
    color: item.color || colors[i % colors.length],
  }));

  const chartConfig = pieData.reduce((acc, item) => {
    acc[item.id] = { label: item.label, color: item.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <div
      className="h-full w-full"
      aria-label="Spending breakdown chart"
      role="img"
    >
      <ChartContainer config={chartConfig} className="w-full h-full">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="id"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
            strokeWidth={2}
            onClick={
              onClick
                ? (entry: SpendingPieDatum) => onClick(entry)
                : undefined
            }
          >
            {pieData.map((d) => (
              <Cell
                key={d.id}
                fill={d.color}
                // Synthetic buckets (e.g. "Uncategorized") have no transactions filter.
                cursor={onClick && !isSyntheticBreakdownId(d.id) ? "pointer" : "default"}
              />
            ))}
          </Pie>
          <ChartTooltip content={<ChartTooltipContent nameKey="id" />} />
        </PieChart>
      </ChartContainer>
    </div>
  );
}
