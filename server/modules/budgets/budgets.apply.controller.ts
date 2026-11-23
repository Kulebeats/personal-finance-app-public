import type { Request, Response, NextFunction } from "express";
import type { BudgetRecalculationApplyInput } from "@shared/budget-recalculation-apply";
import { ValidationError } from "../../core/errors";
import { success } from "../../core/http";
import { applyBudgetRecalculation } from "../../services/budget/BudgetConfirmedApplyService";
import { budgetApplySchema } from "./budgets.apply.validation";

export async function applyConfirmedBudgetSuggestions(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = budgetApplySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid confirmed budget selection", parsed.error.errors);
    const { householdId, userId } = req.householdContext!;
    const result = await applyBudgetRecalculation(householdId, userId, parsed.data as BudgetRecalculationApplyInput);
    res.set("Cache-Control", "no-store");
    return success(res, result);
  } catch (error) { next(error); }
}
