/**
 * Recurring Feature Module Types
 *
 * Shared type definitions for the recurring feature.
 */

import type { MoneyDto } from "@shared/money";
import type { RecurringCalendarOccurrence } from "@/hooks/useRecurring";

export type { RecurringTransaction } from "@/hooks/useRecurring";

/**
 * Calendar item for display.
 */
export interface CalendarItem {
  id: string;
  day: number;
  name: string;
  amount: MoneyDto | null;
  status: RecurringCalendarOccurrence["status"];
  isPaused: boolean;
  raw: import("@/hooks/useRecurring").RecurringTransaction;
}

/**
 * Edit form state.
 */
export interface RecurringEditForm {
  confirmDenomination?: boolean;
  expectedDefinition?: string;
  name: string;
  amount: string;
  frequency:
    | import("@/hooks/useRecurring").RecurringTransaction["frequency"]
    | "";
  nextDueDate?: string;
  endDate?: string;
  notes?: string;
  reminderDays?: number;
  reminderEmail?: boolean;
}

/**
 * Frequency display labels.
 */
export const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annually: "Semi-annually",
  annually: "Annually",
  yearly: "Yearly",
  custom: "Custom",
};

/**
 * View mode for the recurring page.
 */
export type RecurringViewMode = "calendar" | "list";
