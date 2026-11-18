/**
 * TreemapChart - Treemap visualization component for hierarchical data
 *
 * Used for spending breakdowns by category showing proportional distribution
 */

import React from "react";
import { Treemap } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormatters } from "@/contexts/SettingsContext";

const DEFAULT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export interface TreemapDataNode {
  id: string;
  label: string;
  value: number;
  color?: string;
  children?: TreemapDataNode[];
}

interface TreemapChartProps {
  data: TreemapDataNode;
  height?: number;
  onClick?: (node: TreemapDataNode) => void;
}

/**
 * Leaf node shape recharts passes to the Treemap content renderer.
 * Recharts spreads each datum's own fields onto the node, so the original
 * TreemapDataNode properties (id, label, value, color) are present alongside
 * the computed layout box (x, y, width, height).
 */
interface TreemapContentNode extends TreemapDataNode {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

export function TreemapChart({
  data,
  height = 300,
  onClick,
}: TreemapChartProps) {
  const { formatCurrency } = useFormatters();

  const children = data.children ?? [];

  const chartConfig = children.reduce((acc, child, index) => {
    acc[child.id] = {
      label: child.label,
      color: child.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    };
    return acc;
  }, {} as ChartConfig);

  const renderCell = (props: unknown) => {
    const node = props as TreemapContentNode;
    const { x, y, width, height: cellHeight, index, id, label, value } = node;
    const fill =
      node.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    const showLabel = width > 40 && cellHeight > 24;

    return (
      <g
        onClick={() => onClick?.(node)}
        style={{ cursor: onClick ? "pointer" : "default" }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={cellHeight}
          fill={fill}
          stroke="hsl(var(--background))"
          strokeWidth={1}
        />
        {showLabel && (
          <text
            x={x + 6}
            y={y + 18}
            fill="hsl(var(--popover-foreground))"
            fontSize={12}
            fontWeight={600}
          >
            {label ?? id}
          </text>
        )}
        {showLabel && (
          <text x={x + 6} y={y + 34} fill="hsl(var(--popover-foreground))" fontSize={11} opacity={0.8}>
            {formatCurrency(value)}
          </text>
        )}
      </g>
    );
  };

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <Treemap
        data={children}
        dataKey="value"
        nameKey="label"
        stroke="hsl(var(--background))"
        isAnimationActive={false}
        content={renderCell as never}
      >
        <ChartTooltip
          content={
            <ChartTooltipContent
              nameKey="label"
              formatter={(value) => formatCurrency(Number(value))}
            />
          }
        />
      </Treemap>
    </ChartContainer>
  );
}

export default TreemapChart;
