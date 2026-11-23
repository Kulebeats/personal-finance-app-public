import { BudgetRecalculationService } from "./BudgetRecalculationService";

import { previewBudgetRecalculation } from "./BudgetHistoricalPreviewService";

export class BudgetService extends BudgetRecalculationService {
  previewRecalculation(householdId: string, userId: string, months = 3) {
    return previewBudgetRecalculation(householdId, userId, months);
  }
}

export const budgetService = new BudgetService();
