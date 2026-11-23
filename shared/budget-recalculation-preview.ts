import type { MoneyDto } from "./money";

export type BudgetRecalculationSuggestion = (
  | { categoryId: string; categoryGroupId: null }
  | { categoryId: null; categoryGroupId: string }
) & {
  historicalTotal: MoneyDto;
  amount: MoneyDto;
  currentBudget: {
    id: string;
    amount: MoneyDto;
    periodId: string | null;
    periodVersion: number | null;
  } | null;
};

export interface BudgetRecalculationPreview {
  mode: "preview";
  scope: "visible_posted_activity";
  targetPeriod: string;
  /** Completed calendar months included in the average, including months with no activity. */
  periods: string[];
  suggestions: BudgetRecalculationSuggestion[];
}
