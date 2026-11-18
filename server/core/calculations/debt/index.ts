/**
 * Calculation Engine - Debt Module
 *
 * Re-exports all debt-related calculations.
 *
 * @module core/calculations/debt
 */

export {
  calculateDebtPayoff,
  sortDebtsByStrategy,
  calculateMonthlyInterest,
  type DebtInfo,
  type PayoffPayment,
  type DebtPayoffResult,
  type PayoffStrategy,
} from "./payoff";

export {
  calculateDebtToIncome,
  calculateAffordableDebtPayment,
  DTI_THRESHOLDS,
  type DTIResult,
} from "./dti";
