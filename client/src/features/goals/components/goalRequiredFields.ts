import type { SaveUpGoalDraft } from "./SaveUpGoalForm";
import type { PayDownGoalDraft } from "./PayDownGoalForm";
import type { InvestmentGoalDraft } from "./InvestmentGoalForm";

export type GoalFieldErrors = Record<string, string>;

function amountGoalErrors(prefix: string, draft: SaveUpGoalDraft | InvestmentGoalDraft): GoalFieldErrors {
  const errors: GoalFieldErrors = {};
  if (!draft.name.trim()) errors[`${prefix}-name`] = "Enter a goal name";
  if (draft.goalType === "other" && !draft.otherGoalType.trim()) errors[`${prefix}-other-type`] = "Specify the goal type";
  if (!draft.targetAmount.length) errors[`${prefix}-target`] = "Enter a target amount";
  return errors;
}
// These describe the existing required-field gate. Financial/range validation
// remains authoritative on the server; no value is normalized or inferred here.
export const saveUpRequiredErrors = (draft: SaveUpGoalDraft) => amountGoalErrors("save-up", draft);
export const investmentRequiredErrors = (draft: InvestmentGoalDraft) => amountGoalErrors("inv", draft);
export function payDownRequiredErrors(draft: PayDownGoalDraft): GoalFieldErrors {
  const errors: GoalFieldErrors = {};
  if (!draft.name.trim()) errors["pay-down-name"] = "Enter a goal name";
  if (draft.goalType === "other" && !draft.otherGoalType.trim()) errors["pay-down-other-type"] = "Specify the goal type";
  if (!draft.debtAccountId.length) errors["pay-down-debt-account"] = "Select a debt account";
  if (!draft.interestRate.length) errors["pay-down-interest"] = "Enter an interest rate";
  if (!draft.minimumPayment.length) errors["pay-down-minimum"] = "Enter a minimum payment";
  if (!draft.monthlyPayment.length) errors["pay-down-monthly"] = "Enter a monthly payment";
  return errors;
}
export function goalFieldErrorProps(errors: GoalFieldErrors, field: string) {
  return { "aria-invalid": errors[field] ? true : undefined, "aria-describedby": errors[field] ? `${field}-error` : undefined };
}
