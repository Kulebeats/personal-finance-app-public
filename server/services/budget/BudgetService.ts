import { BudgetRecalculationService } from "./BudgetRecalculationService";

export class BudgetService extends BudgetRecalculationService {}

export const budgetService = new BudgetService();
