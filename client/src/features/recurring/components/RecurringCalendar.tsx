/**
 * RecurringCalendar Component
 *
 * Calendar view for recurring transactions.
 * WCAG 2.1 AA compliant with full keyboard navigation.
 */

import { useCallback, useRef, useState, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "../types";
import type { RecurringTransaction } from "@/hooks/useRecurring";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/money";

interface RecurringCalendarProps {
  calendarItems: CalendarItem[];
  daysInMonth: number;
  firstDayOfMonth: number;
  today: number;
  isCurrentMonth: boolean;
  onItemClick: (item: RecurringTransaction) => void;
}

const DAYS_IN_WEEK = 7;
const statusLabels: Record<CalendarItem["status"], string> = {
  upcoming: "Upcoming",
  due: "Due today",
  overdue: "Overdue",
  pending: "Pending",
  paid: "Paid",
  received: "Received",
  skipped: "Skipped",
};
const statusColors: Record<CalendarItem["status"], string> = {
  upcoming: "bg-chart-1",
  due: "bg-chart-1",
  overdue: "bg-destructive",
  pending: "bg-chart-1",
  paid: "bg-chart-income",
  received: "bg-chart-income",
  skipped: "bg-muted-foreground",
};

export function RecurringCalendar({
  calendarItems,
  daysInMonth,
  firstDayOfMonth,
  today,
  isCurrentMonth,
  onItemClick,
}: RecurringCalendarProps) {
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const cellRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, day: number) => {
      let nextDay: number | null = null;

      switch (e.key) {
        case "ArrowLeft":
          nextDay = day > 1 ? day - 1 : null;
          break;
        case "ArrowRight":
          nextDay = day < daysInMonth ? day + 1 : null;
          break;
        case "ArrowUp":
          nextDay = day > DAYS_IN_WEEK ? day - DAYS_IN_WEEK : null;
          break;
        case "ArrowDown":
          nextDay = day + DAYS_IN_WEEK <= daysInMonth ? day + DAYS_IN_WEEK : null;
          break;
        case "Home":
          nextDay = 1;
          break;
        case "End":
          nextDay = daysInMonth;
          break;
        default:
          return;
      }

      if (nextDay !== null) {
        e.preventDefault();
        setFocusedDay(nextDay);
        cellRefs.current.get(nextDay)?.focus();
      }
    },
    [daysInMonth],
  );

  const setCellRef = useCallback((day: number, el: HTMLDivElement | null) => {
    if (el) {
      cellRefs.current.set(day, el);
    } else {
      cellRefs.current.delete(day);
    }
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[700px]">
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-4 mb-4 text-center text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          {/* Calendar Grid */}
          <div
            role="grid"
            aria-label="Recurring transactions calendar"
            className="grid grid-cols-7 gap-4 text-sm"
          >
            {/* Empty cells for days before the first day of the month */}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[100px]"></div>
            ))}

            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const items = calendarItems.filter((item) => item.day === day);
              const isToday = isCurrentMonth && day === today;
              const itemCount = items.length;

              return (
                <div
                  key={day}
                  ref={(el) => setCellRef(day, el)}
                  role="gridcell"
                  tabIndex={focusedDay === day || (focusedDay === null && day === 1) ? 0 : -1}
                  aria-label={`Day ${day}${itemCount > 0 ? `, ${itemCount} recurring item${itemCount > 1 ? "s" : ""}` : ""}${isToday ? ", today" : ""}`}
                  onKeyDown={(e) => handleKeyDown(e, day)}
                  className={cn(
                    "min-h-[100px] border rounded-xl p-2 transition-all relative flex flex-col gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                    isToday
                      ? "bg-primary/5 border-primary ring-1 ring-primary/20 shadow-sm"
                      : "border-border/40 hover:bg-muted/30 hover:border-border/60 hover:shadow-sm",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium mb-1 px-1",
                      isToday
                        ? "text-primary font-bold"
                        : "text-muted-foreground",
                    )}
                  >
                    {day}
                  </span>

                  {items.map((item) => {
                    const status = statusLabels[item.status];
                    const amount = item.amount ? formatCurrency(item.amount) : null;
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onItemClick(item.raw);
                            }}
                            type="button"
                            aria-label={[item.name, amount, status].filter(Boolean).join(", ")}
                            className={cn(
                              "w-full text-left flex items-center gap-2 bg-card dark:bg-slate-800 border border-border/50 rounded-lg px-2 py-1.5 shadow-sm text-[11px] truncate cursor-pointer transition-all hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/50",
                              item.isPaused && "opacity-60 grayscale",
                            )}
                          >
                            <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusColors[item.status])} />
                            <span className="truncate font-medium text-foreground">{item.name}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          <div className="font-bold">{item.name}</div>
                          {amount && <div className="text-muted-foreground">{amount}</div>}
                          <div className="text-[10px] uppercase tracking-wider mt-1 text-muted-foreground/80">
                            {status}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
