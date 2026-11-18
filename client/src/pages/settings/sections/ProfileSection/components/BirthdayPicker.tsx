import React, { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { getDaysInMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface BirthdayPickerProps {
  date: Date | null;
  onChange: (date: Date) => void;
  error?: string;
  hideYear?: boolean;
  onHideYearChange?: (hide: boolean) => void;
  tooltip?: string | React.ReactNode;
}

export function BirthdayPicker({
  date,
  onChange,
  error,
  hideYear,
  onHideYearChange,
  tooltip,
}: BirthdayPickerProps) {
  const { toast } = useToast();
  const [day, setDay] = useState<string>(date ? date.getDate().toString() : "");
  const [month, setMonthState] = useState<string>(
    date ? (date.getMonth() + 1).toString() : "",
  );
  const [year, setYearState] = useState<string>(
    date ? date.getFullYear().toString() : "",
  );

  // Constants
  const currentYear = new Date().getFullYear();
  const minAge = 18;
  const maxYear = currentYear - minAge;
  // No minimum year - allow any reasonable year (100+ years back is plenty)
  const minYear = currentYear - 120;

  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) =>
    (maxYear - i).toString(),
  );

  const daysInMonth =
    month && year
      ? getDaysInMonth(new Date(parseInt(year), parseInt(month) - 1))
      : 31;

  const days = Array.from({ length: daysInMonth }, (_, i) =>
    (i + 1).toString(),
  );

  // Update internal state when prop changes
  useEffect(() => {
    if (date) {
      setDay(date.getDate().toString());
      setMonthState((date.getMonth() + 1).toString());
      setYearState(date.getFullYear().toString());
    }
  }, [date]);

  // Calculate age from a date
  const calculateAge = (birthDate: Date): number => {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  };

  // Handle changes
  const handleDateChange = (type: "day" | "month" | "year", value: string) => {
    let newDay = day;
    let newMonth = month;
    let newYear = year;

    if (type === "day") {
      setDay(value);
      newDay = value;
    } else if (type === "month") {
      setMonthState(value);
      newMonth = value;
      // Adjust day if it exceeds new month's days
      const maxDays = getDaysInMonth(
        new Date(parseInt(newYear || "2000"), parseInt(value) - 1),
      );
      if (parseInt(newDay) > maxDays) {
        setDay(maxDays.toString());
        newDay = maxDays.toString();
      }
    } else if (type === "year") {
      setYearState(value);
      newYear = value;
    }

    // Only fire onChange if we have a full date
    if (newDay && newMonth && newYear) {
      const newDate = new Date(
        parseInt(newYear),
        parseInt(newMonth) - 1,
        parseInt(newDay),
      );

      // Check if user is under 18 and show toast warning
      const age = calculateAge(newDate);
      if (age < 18) {
        toast({
          title: "Age Requirement",
          description:
            "You must be at least 18 years old to use this service. Please enter a valid date of birth.",
          variant: "destructive",
        });
        // Reset to max allowed year (18 years ago)
        const correctedYear = maxYear.toString();
        setYearState(correctedYear);
        const correctedDate = new Date(
          maxYear,
          parseInt(newMonth) - 1,
          parseInt(newDay),
        );
        onChange(correctedDate);
        return;
      }

      onChange(newDate);
    }
  };

  return (
    <div className="space-y-2 group">
      <div className="flex items-center gap-1.5 mb-1.5 relative w-fit">
        <Label className="text-xs font-semibold text-muted-foreground uppercase">
          Date of Birth
        </Label>
        {tooltip && (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <div
                  className="inline-flex items-center justify-center text-muted-foreground/50 hover:text-blue-500 transition-colors cursor-help opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                  role="button"
                  tabIndex={0}
                  aria-label="More information"
                >
                  <Info className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="max-w-[300px] bg-popover text-popover-foreground border-border"
              >
                <div className="text-sm">{tooltip}</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Month */}
        <Select
          value={month}
          onValueChange={(val) => handleDateChange("month", val)}
        >
          <SelectTrigger
            className={cn(
              "input-glass focus:ring-ring transition-all duration-200 focus:scale-[1.02]",
              !month && "text-muted-foreground",
            )}
          >
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Day */}
        <Select
          value={day}
          onValueChange={(val) => handleDateChange("day", val)}
        >
          <SelectTrigger
            className={cn(
              "input-glass focus:ring-ring transition-all duration-200 focus:scale-[1.02]",
              !day && "text-muted-foreground",
            )}
          >
            <SelectValue placeholder="Day" />
          </SelectTrigger>
          <SelectContent>
            {days.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Year */}
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={year}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, ""); // Only digits
              if (value.length <= 4) {
                setYearState(value);

                // Only validate and update if we have a complete 4-digit year
                if (value.length === 4) {
                  const yearNum = parseInt(value);

                  // Check if year is in valid range
                  if (yearNum < minYear || yearNum > maxYear) {
                    toast({
                      title: "Age Requirement",
                      description: `You must be at least 18 years old. Please enter a year between ${minYear} and ${maxYear}.`,
                      variant: "destructive",
                    });
                    // Reset to max allowed year (18 years ago)
                    setTimeout(() => {
                      setYearState(maxYear.toString());
                      if (day && month) {
                        const correctedDate = new Date(
                          maxYear,
                          parseInt(month) - 1,
                          parseInt(day),
                        );
                        onChange(correctedDate);
                      }
                    }, 100);
                    return;
                  }

                  // Valid year, update if we have full date
                  if (day && month) {
                    handleDateChange("year", value);
                  }
                }
              }
            }}
            onBlur={() => {
              // Validate on blur as well
              if (year && year.length === 4) {
                const yearNum = parseInt(year);
                if (yearNum > maxYear) {
                  toast({
                    title: "Age Requirement",
                    description: `You must be at least 18 years old. Year cannot exceed ${maxYear}.`,
                    variant: "destructive",
                  });
                  setYearState(maxYear.toString());
                  if (day && month) {
                    const correctedDate = new Date(
                      maxYear,
                      parseInt(month) - 1,
                      parseInt(day),
                    );
                    onChange(correctedDate);
                  }
                }
              }
            }}
            placeholder="YYYY"
            maxLength={4}
            className={cn(
              "flex h-10 w-full rounded-md border border-input input-glass px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 focus:scale-[1.02]",
              !year && "text-muted-foreground",
            )}
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {onHideYearChange && (
        <div className="flex items-center space-x-2 mt-2">
          <input
            type="checkbox"
            id="hideYear"
            checked={hideYear}
            onChange={(e) => onHideYearChange(e.target.checked)}
            className="accent-primary w-4 h-4 rounded border-input"
          />
          <label
            htmlFor="hideYear"
            className="text-xs text-muted-foreground cursor-pointer select-none"
          >
            Hide birth year from public profile
          </label>
        </div>
      )}
    </div>
  );
}
