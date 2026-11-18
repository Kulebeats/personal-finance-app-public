import React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BarChart2,
  LineChart,
  PieChart,
  Activity,
  AlignLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ChartType =
  | "bar"
  | "horizontal_bar"
  | "line"
  | "area"
  | "pie"
  | "stacked_bar"
  | "combo"
  | "treemap";

interface ChartTypeSwitcherProps {
  value: ChartType;
  onChange: (value: ChartType) => void;
  allowedTypes?: ChartType[];
  className?: string;
  size?: "default" | "sm" | "lg";
}

const TYPE_CONFIG: Record<
  ChartType,
  { label: string; icon: React.ElementType }
> = {
  bar: { label: "Bar", icon: BarChart2 },
  horizontal_bar: { label: "Column", icon: AlignLeft },
  line: { label: "Line", icon: LineChart },
  area: { label: "Area", icon: Activity },
  pie: { label: "Pie", icon: PieChart },
  stacked_bar: { label: "Stacked", icon: BarChart2 },
  combo: { label: "Combo", icon: Activity },
  treemap: { label: "Treemap", icon: PieChart },
};

export function ChartTypeSwitcher({
  value,
  onChange,
  allowedTypes = ["bar", "line", "area", "horizontal_bar", "pie"],
  className,
  size = "sm",
}: ChartTypeSwitcherProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(val) => {
        if (val) onChange(val as ChartType);
      }}
      className={cn("justify-start", className)}
      size={size}
      aria-label="Select chart type"
    >
      {allowedTypes.map((type) => {
        const config = TYPE_CONFIG[type];
        if (!config) return null;
        const Icon = config.icon;

        return (
          <ToggleGroupItem
            key={type}
            value={type}
            aria-label={`Switch to ${config.label} chart`}
            aria-pressed={value === type}
            className="data-[state=on]:bg-muted data-[state=on]:text-foreground"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{config.label}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
