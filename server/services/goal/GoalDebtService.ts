import { ValidationError } from "../../utils/errorHandler";
import { debtPayoffCalculator } from "../DebtPayoffCalculator";
import { GoalContributionService } from "./GoalContributionService";
import { Money } from "../../core/money";
import {
  calculateGoalProjection,
  type GoalProjectionCalculatorInput,
  type GoalProjectionCalculatorResult,
} from "./GoalProjectionCalculator";

export class GoalDebtService extends GoalContributionService {
  /**
   * Calculate payoff scenario for a pay-down goal.
   *
   * Note on precision: The debtPayoffCalculator is a legacy API that expects number inputs.
   * We convert Money to number at the boundary. This is acceptable here because:
   * 1. Interest calculations inherently involve approximations (monthly compounding, etc.)
   * 2. The results are projections, not actual financial transactions
   * 3. The calculator rounds results to 2 decimal places internally
   *
   * For actual balance updates, always use the Money class directly.
   */
  async calculatePayoff(
    id: string,
    householdId: string,
    data: { monthlyPayment: number; oneTimePayment?: number }
  ) {
    const goal = await this.getGoalById(id, householdId);

    if (goal.type !== "pay_down") {
      throw new ValidationError(
        "Payoff calculations only apply to pay down goals"
      );
    }

    // Convert to numbers at the boundary for debtPayoffCalculator (legacy API)
    // Use Money.abs() to ensure positive balance, then toNumber() for calculator
    const balanceMoney = new Money(goal.currentAmount).abs();
    const apr = Number(goal.interestRate ?? 0); // Interest rate is a percentage, not currency

    return debtPayoffCalculator.calculatePayoff(
      balanceMoney.toNumber(),
      apr,
      data.monthlyPayment,
      data.oneTimePayment ?? 0
    );
  }

  /**
   * Get multiple payoff scenarios for a pay-down goal.
   *
   * Returns four scenarios: minimum, current, accelerated, and aggressive payment plans.
   * See calculatePayoff() for notes on precision handling.
   */
  async getPayoffScenarios(id: string, householdId: string) {
    const goal = await this.getGoalById(id, householdId);

    if (goal.type !== "pay_down") {
      throw new ValidationError(
        "Payoff calculations only apply to pay down goals"
      );
    }

    // Keep Money objects, convert to numbers only at the boundary for debtPayoffCalculator
    // This ensures precision is maintained until the final conversion
    const balanceMoney = new Money(goal.currentAmount).abs();
    const apr = Number(goal.interestRate ?? 0); // Interest rate is a percentage
    const minimumPaymentMoney = new Money(goal.minimumPayment ?? 0);
    const currentPaymentMoney = new Money(goal.monthlyPayment ?? 0);
    const oneTimePaymentMoney = goal.oneTimePayment
      ? new Money(goal.oneTimePayment)
      : Money.zero();

    return debtPayoffCalculator.calculateScenarios({
      balance: balanceMoney.toNumber(),
      apr,
      minimumPayment: minimumPaymentMoney.toNumber(),
      currentPayment: currentPaymentMoney.toNumber(),
      oneTimePayment: oneTimePaymentMoney.toNumber(),
    });
  }

  async calculateDebtStrategy(
    method: "snowball" | "avalanche",
    debts: Array<{
      id: string;
      balance: number;
      rate: number;
      minPayment: number;
    }>
  ) {
    if (method === "snowball") {
      return debtPayoffCalculator.calculateSnowball(debts);
    }

    return debtPayoffCalculator.calculateAvalanche(debts);
  }

  /**
   * Standalone "what-if" investment growth projection (arbitrary
   * user-entered inputs, not tied to a saved goal). See
   * GoalProjectionCalculator for the math and precision notes.
   */
  calculateProjection(
    input: GoalProjectionCalculatorInput
  ): GoalProjectionCalculatorResult {
    return calculateGoalProjection(input);
  }
}
