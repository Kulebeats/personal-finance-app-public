/**
 * TimeRangeSelector Component
 *
 * Dropdown selector for chart time ranges.
 * Options: 1 month, 3 months, 6 months, Year to date, 1 year, All time
 */

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export type DateRange = "1m" | "3m" | "6m" | "ytd" | "1y" | "all";

interface TimeRangeSelectorProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
}

const timeRangeOptions: { value: DateRange; label: string }[] = [
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "ytd", label: "Year to date" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All time" },
];

export function TimeRangeSelector({
  value,
  onChange,
  className,
}: TimeRangeSelectorProps) {
  const selectedLabel =
    timeRangeOptions.find((opt) => opt.value === value)?.label || "1 month";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={className}
        >
          {selectedLabel}
          <ChevronDown className="ml-2 h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[150px]">
        {timeRangeOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className={value === option.value ? "bg-muted" : ""}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
