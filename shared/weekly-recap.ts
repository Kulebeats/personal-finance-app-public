/**
 * Weekly Recap Module - Shared Types
 *
 * Shared type definitions for client-server contract alignment.
 * These types ensure consistent data structure between server responses
 * and client expectations.
 *
 * @module shared/weekly-recap
 */

import type { MoneyDto } from "./money";

// ============================================================================
// Step Enum (aligned between client and server)
// ============================================================================

/**
 * Weekly recap wizard steps.
 * Note: "wrap-up" is the final step, but server validation accepts both
 * "wrap-up" and "overall" for backward compatibility.
 */
export type WeeklyRecapStep =
  | "welcome"
  | "net-worth"
  | "spending"
  | "recurring"
  | "goals"
  | "wrap-up";

/**
 * Server-side feedback step enum (includes legacy "overall" value)
 */
export type WeeklyRecapFeedbackStep =
  | "net-worth"
  | "spending"
  | "recurring"
  | "goals"
  | "wrap-up"
  | "overall";

// ============================================================================
// Spending Data Types
// ============================================================================

/**
 * Category spending item in weekly recap.
 * Uses "name" (not "categoryName") for consistency with client expectations.
 */
export interface CategorySpending {
  /** Category identifier */
  categoryId: string;
  /** Category display name (aligned: use "name" not "categoryName") */
  name: string;
  /** Spending amount in the category */
  amount: number;
  /** Percentage of total spending */
  percent: number;
}

/**
 * Spending data section of weekly recap.
 * Uses "topCategories" (not "categories") for consistency.
 */
export interface SpendingData {
  /** Total spending for the week */
  total: number;
  /** Top spending categories (aligned: use "topCategories" not "categories") */
  topCategories: CategorySpending[];
  /** Whether there is any spending data available */
  hasData: boolean;
  /** Percentage change from previous week */
  changePercent?: number;
  /** Daily spending trend data */
  trend?: Array<{ date: string; amount: number }>;
}

// ============================================================================
// Net Worth Data Types
// ============================================================================

/**
 * Trend direction for net worth changes.
 */
export type TrendDirection = "up" | "down" | "steady";

/**
 * Net worth data section of weekly recap.
 */
export interface NetWorthData {
  /** Current net worth value */
  current: number;
  /** Previous week's net worth value */
  previous: number;
  /** Net worth change from previous week */
  change: number;
  /** Percentage change from previous week */
  changePercent: number;
  /** Daily net worth series data */
  series: Array<{ date: string; value: number }>;
  /** Trend direction indicator */
  trend: TrendDirection;
}

// ============================================================================
// Recurring Data Types
// ============================================================================

/**
 * Upcoming recurring transaction item.
 * Uses "dueDate" (not "date") for consistency with client expectations.
 */
export interface UpcomingRecurring {
  /** Recurring transaction identifier */
  id: string;
  /** Recurring transaction name */
  name: string;
  /** Transaction amount (number, not string) */
  amount: number;
  /** Due date in YYYY-MM-DD format (aligned: use "dueDate" not "date") */
  dueDate: string;
  /** Frequency of the recurring transaction */
  frequency: string;
}

/**
 * Recurring transactions data section of weekly recap.
 */
export interface RecurringData {
  /** List of upcoming recurring transactions */
  upcoming: UpcomingRecurring[];
  /** Count of upcoming transactions */
  count: number;
  /** Total amount of upcoming transactions */
  totalAmount: number;
}

// ============================================================================
// Weekly Recap Response Types
// ============================================================================

/**
 * Complete weekly recap data structure.
 * This is the main response type returned by GET /api/weekly-recap.
 */
export interface WeeklyRecapData {
  /** Start date of the week (YYYY-MM-DD) */
  weekStart: string;
  /** End date of the week (YYYY-MM-DD) */
  weekEnd: string;
  /** Net worth data for the week */
  netWorth: NetWorthData;
  /** Spending data for the week */
  spending: SpendingData;
  /** Recurring transactions data for the week */
  recurring: RecurringData;
}

/**
 * API response wrapper for weekly recap endpoint.
 */
export interface WeeklyRecapResponse {
  success: boolean;
  data: WeeklyRecapData;
}

// ============================================================================
// Feedback Types
// ============================================================================

/**
 * Feedback submission for a weekly recap step.
 */
export interface WeeklyRecapFeedback {
  /** The step being rated (aligned enum) */
  step: WeeklyRecapFeedbackStep;
  /** User's feedback sentiment */
  feedback: "positive" | "negative";
  /** Start date of the week */
  weekStart: string;
  /** End date of the week */
  weekEnd: string;
}

// ============================================================================
// Settings Types
// ============================================================================

/**
 * Weekly recap user settings.
 */
export interface WeeklyRecapSettings {
  /** Whether weekly recap is enabled */
  enabled: boolean;
  /** Whether email notifications are enabled */
  emailEnabled?: boolean;
  /** Day of week to show recap (0 = Sunday, 6 = Saturday) */
  dayOfWeek: number;
  /** Whether to include goals progress */
  includeGoals: boolean;
  /** Whether to include recurring transactions */
  includeRecurring: boolean;
}
