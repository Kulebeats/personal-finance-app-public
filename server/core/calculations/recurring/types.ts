import { Money } from "../types";

export type Frequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semi_annually"
  | "annually"
  | "yearly"
  | "custom";

export type IntervalUnit = "days" | "weeks" | "months" | "years";

export interface RecurringRuleInfo {
  id?: string;
  amount: Money;
  frequency: Frequency;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  startDate: string;
  endDate?: string | null;
  nextDueDate?: string | null;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
}

export interface RecurrenceOptions {
  dayOfMonth?: number;
  dayOfWeek?: number;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
}
