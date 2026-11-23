import type { BudgetRecalculationSuggestion } from "./budget-recalculation-preview";

/** Submit only the exact rows explicitly selected from the displayed preview. */
export interface BudgetRecalculationApplyInput {
  operationId: string;
  months: 3;
  targetPeriod: string;
  suggestions: BudgetRecalculationSuggestion[];
}

export interface BudgetRecalculationApplyResult {
  operationId: string;
  targetPeriod: string;
  appliedCount: number;
}
