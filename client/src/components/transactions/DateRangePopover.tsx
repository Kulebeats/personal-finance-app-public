import { useState, useEffect, useMemo } from "react";
import { CalendarIcon, X } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, differenceInDays } from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DateRange {
  startDate: Date | undefined;
  endDate: Date | undefined;
}

interface DateRangePopoverProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
}

type PresetKey = "last7" | "last14" | "last30" | "thisMonth" | "lastMonth" | "thisYear" | "lastYear";

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => DateRange;
}

const presets: Preset[] = [
  {
    key: "last7",
    label: "Last 7 days",
    getRange: () => ({
      startDate: subDays(new Date(), 7),
      endDate: new Date(),
    }),
  },
  {
    key: "last14",
    label: "Last 14 days",
    getRange: () => ({
      startDate: subDays(new Date(), 14),
      endDate: new Date(),
    }),
  },
  {
    key: "last30",
    label: "Last 30 days",
    getRange: () => ({
      startDate: subDays(new Date(), 30),
      endDate: new Date(),
    }),
  },
  {
    key: "thisMonth",
    label: "This month",
    getRange: () => ({
      startDate: startOfMonth(new Date()),
      endDate: endOfMonth(new Date()),
    }),
  },
  {
    key: "lastMonth",
    label: "Last month",
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return {
        startDate: startOfMonth(lastMonth),
        endDate: endOfMonth(lastMonth),
      };
    },
  },
  {
    key: "thisYear",
    label: "This year",
    getRange: () => ({
      startDate: startOfYear(new Date()),
      endDate: endOfYear(new Date()),
    }),
  },
  {
    key: "lastYear",
    label: "Last year",
    getRange: () => {
      const lastYear = subYears(new Date(), 1);
      return {
        startDate: startOfYear(lastYear),
        endDate: endOfYear(lastYear),
      };
    },
  },
];

export function DateRangePopover({ value, onChange, className }: DateRangePopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<DateRange>(value);
  const [activeField, setActiveField] = useState<"start" | "end" | null>(null);

  // Sync draft with external value when popover opens
  useEffect(() => {
    if (open) {
      setDraftValue(value);
      setActiveField(null);
    }
  }, [open, value]);

  // Validation
  const validation = useMemo(() => {
    const { startDate, endDate } = draftValue;
    if (!startDate || !endDate) return { valid: true, error: null };

    if (startDate > endDate) {
      return { valid: false, error: "Start date must be before end date" };
    }

    const daysDiff = differenceInDays(endDate, startDate);
    if (daysDiff > 730) {
      return { valid: false, error: "Date range cannot exceed 730 days (2 years)" };
    }

    return { valid: true, error: null };
  }, [draftValue]);

  const handleApply = () => {
    if (!validation.valid) return;
    onChange(draftValue);
    setOpen(false);
  };

  const handleCancel = () => {
    setDraftValue(value);
    setOpen(false);
  };

  const handleClear = () => {
    setDraftValue({ startDate: undefined, endDate: undefined });
  };

  const handlePresetClick = (preset: Preset) => {
    setDraftValue(preset.getRange());
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (activeField === "start") {
      setDraftValue((prev) => ({ ...prev, startDate: date }));
    } else if (activeField === "end") {
      setDraftValue((prev) => ({ ...prev, endDate: date }));
    }
    setActiveField(null);
  };

  const hasAppliedRange = value.startDate || value.endDate;

  const getDisplayLabel = () => {
    if (!value.startDate && !value.endDate) return "Date";
    if (value.startDate && value.endDate) {
      return `${format(value.startDate, "MMM d")} - ${format(value.endDate, "MMM d, yyyy")}`;
    }
    if (value.startDate) return `From ${format(value.startDate, "MMM d, yyyy")}`;
    if (value.endDate) return `Until ${format(value.endDate, "MMM d, yyyy")}`;
    return "Date";
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2",
            hasAppliedRange && "border-orange-500 text-orange-600",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          {getDisplayLabel()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Presets */}
          <div className="border-r p-3 space-y-1 min-w-[140px]">
            <h4 className="font-medium text-sm mb-2">Date Range</h4>
            {presets.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePresetClick(preset)}
                className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs and calendar */}
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {/* Start Date */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Start date</label>
                  {draftValue.startDate && (
                    <button
                      type="button"
                      onClick={() => setDraftValue((prev) => ({ ...prev, startDate: undefined }))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !draftValue.startDate && "text-muted-foreground",
                    activeField === "start" && "ring-2 ring-orange-500"
                  )}
                  onClick={() => setActiveField(activeField === "start" ? null : "start")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {draftValue.startDate ? format(draftValue.startDate, "MM/dd/yyyy") : "MM/DD/YYYY"}
                </Button>
              </div>

              {/* End Date */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">End date</label>
                  {draftValue.endDate && (
                    <button
                      type="button"
                      onClick={() => setDraftValue((prev) => ({ ...prev, endDate: undefined }))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !draftValue.endDate && "text-muted-foreground",
                    activeField === "end" && "ring-2 ring-orange-500"
                  )}
                  onClick={() => setActiveField(activeField === "end" ? null : "end")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {draftValue.endDate ? format(draftValue.endDate, "MM/dd/yyyy") : "MM/DD/YYYY"}
                </Button>
              </div>
            </div>

            {/* Calendar */}
            {activeField && (
              <Calendar
                mode="single"
                selected={activeField === "start" ? draftValue.startDate : draftValue.endDate}
                onSelect={handleDateSelect}
                disabled={(date) => date > new Date()}
                initialFocus
              />
            )}

            {/* Validation error */}
            {validation.error && (
              <p className="text-xs text-destructive">{validation.error}</p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={!draftValue.startDate && !draftValue.endDate}
              >
                Clear
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApply}
                  disabled={!validation.valid}
                  className="bg-orange-500 hover:bg-orange-600"
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
