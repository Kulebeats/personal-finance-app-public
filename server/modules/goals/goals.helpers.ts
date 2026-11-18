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
import type {
  CreateGoalInput,
  UpdateSaveUpGoalInput,
  UpdatePayDownGoalInput,
  UpdateInvestmentGoalInput,
} from "./goals.validation";

const toAmountString = (value: MoneyDto) => value.amount;

export const mapGoalMoney = <
  T extends {
    targetAmount?: string | number;
    currentAmount?: string | number;
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
    targetAmount:
      goal.targetAmount !== undefined
        ? toMoneyDto(goal.targetAmount, currency)
        : goal.targetAmount,
    currentAmount:
      goal.currentAmount !== undefined
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

export const mapGoalLinkMoney = <T extends { amount?: string | number }>(
  link: T,
  currency: string
): T => ({
  ...link,
  amount:
    link.amount !== undefined ? toMoneyDto(link.amount, currency) : link.amount,
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
    targetAmount: "0", // Placeholder - will be overridden by GoalMutationService
    minimumPayment: toAmountString(data.minimumPayment),
    monthlyPayment: toAmountString(data.monthlyPayment),
    oneTimePayment: data.oneTimePayment
      ? toAmountString(data.oneTimePayment)
      : data.oneTimePayment,
    // Note: originalBalance, currentAmount, and currency
    // will be set by GoalMutationService based on debt account
  };
};

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
