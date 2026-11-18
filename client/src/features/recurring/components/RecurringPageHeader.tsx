/**
 * RecurringPageHeader Component
 *
 * Header with title, upcoming count, add button, and view mode toggle.
 */

import { Calendar as CalendarIcon, List, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import { AddTransactionModal } from "@/components/transactions/AddTransactionModal";
import { RecurringPatternsModal } from "./RecurringPatternsModal";
import type { MoneyDto } from "@shared/money";

interface RecurringPageHeaderProps {
  upcomingCount: number;
  upcomingTotal: MoneyDto;
  currency: string;
  viewMode: "calendar" | "list";
  setViewMode: (mode: "calendar" | "list") => void;
}

export function RecurringPageHeader({
  upcomingCount,
  upcomingTotal,
  currency,
  viewMode,
  setViewMode,
}: RecurringPageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recurring</h1>
        <p className="text-muted-foreground">
          You have{" "}
          <span className="font-bold text-foreground">{upcomingCount}</span>{" "}
          upcoming payments totaling{" "}
          <span className="font-bold text-foreground">
            {formatCurrency(upcomingTotal)}
          </span>
        </p>
      </div>
      <div className="flex gap-3">
        <RecurringPatternsModal>
          <button className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/80 shadow-sm border border-border">
            <Sparkles className="w-4 h-4" /> Scan
          </button>
        </RecurringPatternsModal>
        <AddTransactionModal initialValues={{ isRecurring: true }}>
          <button className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 shadow-sm">
            <Plus className="w-4 h-4" /> Add Recurring
          </button>
        </AddTransactionModal>
        <div className="flex items-center bg-card dark:bg-slate-800 border border-border rounded-md shadow-sm p-1">
          <button
            onClick={() => setViewMode("calendar")}
            aria-label="Calendar view"
            className={cn(
              "p-2 rounded transition-colors",
              viewMode === "calendar"
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:bg-muted/30",
            )}
          >
            <CalendarIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            aria-label="List view"
            className={cn(
              "p-2 rounded transition-colors",
              viewMode === "list"
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:bg-muted/30",
            )}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
