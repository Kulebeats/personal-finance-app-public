/**
 * Report Repository Types
 *
 * Shared types used across report repositories.
 *
 * @module repositories/reports/types
 */

/**
 * Extends query types with userId for visibility filtering
 */
export type QueryWithUser<T> = T & { userId?: string };

/**
 * Report context with household and user info
 */
export interface ReportContext {
  householdId: string;
  baseCurrency: string;
  userId?: string;
}

/**
 * Date range filter for reports
 */
export interface DateRangeFilter {
  from: string;
  to: string;
}
