import { isCurrencyCode } from "@shared/denomination";
import { HttpError } from "../errors";
import { Money } from "../money";

export class BudgetDenominationUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
  constructor() { super("A verified conversion is required to report this budget in the requested currency."); }
}

/** These budget readers have no dated conversion evidence for limits. */
export function readBudgetMoney(amount: string, currency: string | null, requested: string): Money {
  if (!isCurrencyCode(currency) || currency !== requested) throw new BudgetDenominationUnavailable();
  let value: Money;
  try { value = new Money(amount, currency); } catch { throw new BudgetDenominationUnavailable(); }
  if (!value.amount.isFinite()) throw new BudgetDenominationUnavailable();
  return value;
}
