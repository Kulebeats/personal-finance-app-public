/**
 * Goals Controller Helpers
 *
 * Shared mapper and normalizer functions for goal data transformation.
 *
 * @module modules/goals/goals.helpers
 */

import { toMoneyDto } from "../../core/money";
import type { MoneyDto } from "@shared/money";
import { goalService } from "./goals.service";
import { ValidationError } from "../../utils/errorHandler";
import type {
  CreateGoalInput,
  UpdateSaveUpGoalInput,
  UpdatePayDownGoalInput,
  UpdateInvestmentGoalInput,
} from "./goals.validation";

const toAmountString = (value: MoneyDto) => value.amount;

export const mapGoalMoney = <
  T extends {
    targetAmount?: string | number | null;
    currentAmount?: string | number | null;
    monthlyProjection?: string | number | null;
    originalBalance?: string | number | null;
    minimumPayment?: string | number | null;
    monthlyPayment?: string | number | null;
    oneTimePayment?: string | number | null;
    currency?: string | null;
  }
>(
  goal: T
): T => {
  const currency = goal.currency ?? "ZMW";
  return {
    ...goal,
    // Null when the target is a hidden debt account's balance (FIN-01).
    targetAmount:
      goal.targetAmount !== undefined && goal.targetAmount !== null
        ? toMoneyDto(goal.targetAmount, currency)
        : goal.targetAmount,
    // Null means the viewer may not see this goal's progress sources.
    currentAmount:
      goal.currentAmount !== undefined && goal.currentAmount !== null
        ? toMoneyDto(goal.currentAmount, currency)
        : goal.currentAmount,
    monthlyProjection:
      goal.monthlyProjection !== undefined && goal.monthlyProjection !== null
        ? toMoneyDto(goal.monthlyProjection, currency)
        : goal.monthlyProjection,
    originalBalance:
      goal.originalBalance !== undefined && goal.originalBalance !== null
        ? toMoneyDto(goal.originalBalance, currency)
        : goal.originalBalance,
    minimumPayment:
      goal.minimumPayment !== undefined && goal.minimumPayment !== null
        ? toMoneyDto(goal.minimumPayment, currency)
        : goal.minimumPayment,
    monthlyPayment:
      goal.monthlyPayment !== undefined && goal.monthlyPayment !== null
        ? toMoneyDto(goal.monthlyPayment, currency)
        : goal.monthlyPayment,
    oneTimePayment:
      goal.oneTimePayment !== undefined && goal.oneTimePayment !== null
        ? toMoneyDto(goal.oneTimePayment, currency)
        : goal.oneTimePayment,
  };
};

export const mapGoalTransferMoney = <T extends { amount?: string | number }>(
  transfer: T,
  currency: string
): T => ({
  ...transfer,
  amount:
    transfer.amount !== undefined
      ? toMoneyDto(transfer.amount, currency)
      : transfer.amount,
});

/**
 * A listed transfer as the viewer may see it: a transfer that touches a goal
 * whose progress they cannot see keeps its row but not its amount (owner
 * decision on #235 F1). The amount is null, the shape a hidden link delta has.
 */
export const mapViewerTransferMoney = <T extends { amount: string; amountVisible: boolean }>(
  { amountVisible, ...transfer }: T,
  currency: string
) => ({
  ...transfer,
  amount: amountVisible === true ? toMoneyDto(transfer.amount, currency) : null,
});

/**
 * A correction row's money with its currency. Its applied delta is shown only
 * to a member who can see all of the goal's progress (FIN-01): the delta is
 * floored at zero, so for anyone else it would disclose the hidden balance.
 */
export const mapCorrectionMoney = <T extends { amount: string; appliedDelta: string | null }>(
  correction: T,
  currency: string,
  progressVisible: boolean
) => ({
  ...correction,
  amount: toMoneyDto(correction.amount, currency),
  appliedDelta:
    progressVisible && correction.appliedDelta !== null
      ? toMoneyDto(correction.appliedDelta, currency)
      : null,
});

/**
 * A newly written link as its author may see it: amounts as MoneyDto, and the
 * applied delta only for a member who can see all of the goal's progress. A
 * spend's delta is floored at the progress it found, so for anyone else it
 * would disclose the hidden balance (FIN-01, the mapCorrectionMoney rule).
 */
export const mapLinkResponseMoney = <
  T extends { amount: string; sourceAmount: string | null; sourceCurrency: string | null; appliedDelta: string | null }
>(
  link: T,
  goalCurrency: string,
  progressVisible: boolean
) => ({
  ...link,
  amount: toMoneyDto(link.amount, goalCurrency),
  sourceAmount:
    link.sourceAmount != null ? toMoneyDto(link.sourceAmount, link.sourceCurrency ?? goalCurrency) : null,
  appliedDelta:
    progressVisible && link.appliedDelta != null ? toMoneyDto(link.appliedDelta, goalCurrency) : null,
});

export const mapAssignmentMoney = <
  T extends {
    partialAmount?: string | number | null;
    accountBalance?: string | number | null;
    accountCurrency?: string | null;
    goalCurrency?: string | null;
  }
>(
  assignment: T
): T => {
  const currency =
    assignment.accountCurrency ?? assignment.goalCurrency ?? "ZMW";
  return {
    ...assignment,
    partialAmount:
      assignment.partialAmount !== undefined &&
      assignment.partialAmount !== null
        ? toMoneyDto(assignment.partialAmount, currency)
        : assignment.partialAmount,
    accountBalance:
      assignment.accountBalance !== undefined &&
      assignment.accountBalance !== null
        ? toMoneyDto(assignment.accountBalance, currency)
        : assignment.accountBalance,
  };
};

export const mapAvailableFundsMoney = <
  T extends {
    balance?: string | number;
    assignedAmount?: string | number;
    availableAmount?: string | number;
    currency?: string | null;
  }
>(
  funds: T
): T => {
  const currency = funds.currency ?? "ZMW";
  return {
    ...funds,
    balance:
      funds.balance !== undefined
        ? toMoneyDto(funds.balance, currency)
        : funds.balance,
    assignedAmount:
      funds.assignedAmount !== undefined
        ? toMoneyDto(funds.assignedAmount, currency)
        : funds.assignedAmount,
    availableAmount:
      funds.availableAmount !== undefined
        ? toMoneyDto(funds.availableAmount, currency)
        : funds.availableAmount,
  };
};

export const normalizeCreateGoalInput = (
  data: CreateGoalInput
): Parameters<typeof goalService.createGoal>[0] => {
  if (data.type === "save_up") {
    return {
      ...data,
      targetAmount: toAmountString(data.targetAmount),
      currency: data.targetAmount.currency,
    };
  }

  if (data.type === "investment") {
    return {
      ...data,
      targetAmount: toAmountString(data.targetAmount),
      currency: data.targetAmount.currency,
    };
  }

  // FIX DATA-GOAL-002: Provide placeholder targetAmount
  // GoalMutationService will override these with debt account balance
  return {
    ...data,
    // The payments' one currency, which GoalMutationService checks against the debt account's.
    currency: paymentCurrency(data.minimumPayment, data.monthlyPayment, data.oneTimePayment),
    targetAmount: "0", // Placeholder - will be overridden by GoalMutationService
    minimumPayment: toAmountString(data.minimumPayment),
    monthlyPayment: toAmountString(data.monthlyPayment),
    oneTimePayment: data.oneTimePayment
      ? toAmountString(data.oneTimePayment)
      : data.oneTimePayment,
    // Note: originalBalance and currentAmount
    // will be set by GoalMutationService based on debt account
  };
};

/** The one currency of a pay-down goal's payments; payments in different currencies are refused. */
function paymentCurrency(...payments: Array<{ currency: string } | null | undefined>): string | undefined {
  const currencies = payments.flatMap((payment) => (payment ? [payment.currency] : []));
  if (currencies.some((currency) => currency !== currencies[0])) {
    throw new ValidationError("Goal payments must use the same currency");
  }
  return currencies[0];
}

export const normalizeUpdateGoalInput = (
  type: "save_up" | "pay_down" | "investment",
  data:
    | UpdateSaveUpGoalInput
    | UpdatePayDownGoalInput
    | UpdateInvestmentGoalInput
): Partial<Parameters<typeof goalService.updateGoal>[1]> => {
  if (type === "save_up" || type === "investment") {
    const { targetAmount, ...rest } = data as
      | UpdateSaveUpGoalInput
      | UpdateInvestmentGoalInput;
    const updateData: Partial<Parameters<typeof goalService.updateGoal>[1]> = {
      ...rest,
    };
    if (targetAmount) {
      updateData.targetAmount = toAmountString(targetAmount);
      updateData.currency = targetAmount.currency;
    }
    return updateData;
  }

  const { minimumPayment, monthlyPayment, oneTimePayment, ...rest } =
    data as UpdatePayDownGoalInput;
  const updateData: Partial<Parameters<typeof goalService.updateGoal>[1]> = {
    ...rest,
  };
  const currency = paymentCurrency(minimumPayment, monthlyPayment, oneTimePayment);
  if (currency !== undefined) updateData.currency = currency;
  if (minimumPayment) {
    updateData.minimumPayment = toAmountString(minimumPayment);
  }
  if (monthlyPayment) {
    updateData.monthlyPayment = toAmountString(monthlyPayment);
  }
  if (oneTimePayment !== undefined) {
    updateData.oneTimePayment = oneTimePayment
      ? toAmountString(oneTimePayment)
      : oneTimePayment;
  }

  return updateData;
};
