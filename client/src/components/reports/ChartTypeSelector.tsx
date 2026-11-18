/**
 * ChartTypeSelector
 *
 * Select component for choosing chart visualization type.
 * Extracted from CustomChartBuilderModal for LOC compliance.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  BarChart3,
  TrendingUp,
  PieChart,
  AreaChart,
  LayoutTemplate,
} from "lucide-react";

interface ChartTypeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function ChartTypeSelector({ value, onChange }: ChartTypeSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>Chart Type</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="bar">
            <span className="flex items-center">
              <BarChart3 className="w-4 h-4 mr-2" /> Vertical Bar
            </span>
          </SelectItem>
          <SelectItem value="horizontal_bar">
            <span className="flex items-center">
              <LayoutTemplate className="w-4 h-4 mr-2 rotate-90" /> Horizontal
              Bar
            </span>
          </SelectItem>
          <SelectItem value="line">
            <span className="flex items-center">
              <TrendingUp className="w-4 h-4 mr-2" /> Line Chart
            </span>
          </SelectItem>
          <SelectItem value="area">
            <span className="flex items-center">
              <AreaChart className="w-4 h-4 mr-2" /> Area Chart
            </span>
          </SelectItem>
          <SelectItem value="pie">
            <span className="flex items-center">
              <PieChart className="w-4 h-4 mr-2" /> Pie / Donut
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
