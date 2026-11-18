import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AggregationLevel =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "biannual"
  | "annual"
  | "custom";

interface AggregationFilterProps {
  value: AggregationLevel;
  onChange: (value: AggregationLevel) => void;
  className?: string;
  showWeekly?: boolean;
  showCustom?: boolean;
}

export function AggregationFilter({
  value,
  onChange,
  className,
  showWeekly = false,
  showCustom = false,
}: AggregationFilterProps) {
  return (
    <div className={className}>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as AggregationLevel)}
      >
        <SelectTrigger className="w-[140px]" aria-label="Aggregation Period">
          <SelectValue placeholder="Aggregation" />
        </SelectTrigger>
        <SelectContent>
          {showWeekly && <SelectItem value="weekly">Weekly</SelectItem>}
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="quarterly">Quarterly</SelectItem>
          <SelectItem value="biannual">Bi-Annual</SelectItem>
          <SelectItem value="annual">Annual</SelectItem>
          {showCustom && <SelectItem value="custom">Custom Range</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  );
}
