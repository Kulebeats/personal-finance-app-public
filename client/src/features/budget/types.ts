/**
 * Budget Feature Module Types
 *
 * Shared type definitions for the budget feature.
 */

import type { ElementType } from "react";

// Re-export types from hooks
export type {
  BudgetWithProgress,
  BudgetForecastData,
} from "@/hooks/useBudgets";

/**
 * Budget category representing a single budgeted category line item.
 */
export interface BudgetCategory {
  id: string;
  name: string;
  icon: ElementType;
  budget: number;
  actual: number;
  remaining: number;
  budgetId?: string;
}

/**
 * Budget group containing multiple categories.
 */
export interface BudgetGroup {
  id: string;
  name: string;
  type: "income" | "expense" | "savings" | "debt";
  items: BudgetCategory[];
  expanded?: boolean;
  budget?: number;
  isFlexible?: boolean;
  budgetId?: string;
  budgetMode?: "by_category" | "by_group";
  isGroupBudget?: boolean;
}

/**
 * Selected item for detail modal.
 */
export interface SelectedItem {
  groupId: string;
  itemId: string;
  item: BudgetCategory;
  groupName: string;
}

/**
 * Budget settings configuration.
 */
export interface BudgetSettings {
  budgetSystem: "flex" | "category";
  defaultApplyScope: "this_month" | "all_future";
}

/**
 * Apply scope for budget changes.
 */
export type ApplyScope = "this_month" | "all_future";

/**
 * Move money payload.
 */
export interface MoveMoneyPayload {
  fromBudgetId: string;
  toBudgetId: string;
  amount: string;
  applyScope: ApplyScope;
}

/**
 * Budget edit data for modals.
 */
export interface BudgetEditData {
  budgetId?: string;
  categoryId: string;
  categoryName: string;
  year: number;
  month: number;
  amount: string;
}

/**
 * Forecast edit data for modals.
 */
export interface ForecastEditData {
  budgetId: string;
  budgetName: string;
  year: number;
  month: number;
  amount: string;
}

/**
 * Default empty groups for initial state.
 */
export const initialGroups: BudgetGroup[] = [];
