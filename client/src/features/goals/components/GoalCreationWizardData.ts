/**
 * GoalCreationWizardData - Constants and helpers for goal creation wizard
 */

import type {
  PayoffMethod,
  AssignmentType,
  AssignAccountInput,
} from "@/hooks/useGoals";
import type { SaveUpGoalDraft } from "./SaveUpGoalForm";
import type { PayDownGoalDraft } from "./PayDownGoalForm";
import type { InvestmentGoalDraft } from "./InvestmentGoalForm";
import type { AssignmentDraft } from "./GoalAssignmentStep";
import { parseMoney } from "@/lib/utils";

/** Minimal account type for wizard data functions */
interface AccountLike {
  id: string;
  currency?: string | null;
  balance?: string | null;
}

export const DEFAULT_SAVE_UP: SaveUpGoalDraft = {
  name: "",
  goalType: "other",
  otherGoalType: "",
  icon: "",
  color: "",
  customImageUrl: "",
  targetAmount: "",
  targetDate: "",
  startDate: "",
  description: "",
  spendingReducesProgress: false,
  priority: 0,
  notes: "",
};

export const DEFAULT_PAY_DOWN: PayDownGoalDraft = {
  name: "",
  goalType: "credit_card",
  otherGoalType: "",
  debtAccountId: "",
  interestRate: "",
  minimumPayment: "",
  monthlyPayment: "",
  oneTimePayment: "",
  payoffMethod: "custom",
  priority: 0,
  notes: "",
};

export const DEFAULT_INVESTMENT: InvestmentGoalDraft = {
  name: "",
  goalType: "wealth_building",
  otherGoalType: "",
  icon: "",
  color: "",
  customImageUrl: "",
  targetAmount: "",
  targetDate: "",
  startDate: "",
  linkedAccountId: "",
  expectedReturn: "8.0",
  inflationRate: "3.0",
  description: "",
  priority: 0,
  notes: "",
};

export function parseAmount(value?: string | null): number {
  return parseMoney(value);
}

export function getMonthsRemaining(targetDate?: string): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const months =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  return Math.max(1, months);
}

export function canSubmitSaveUp(draft: SaveUpGoalDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.targetAmount.length > 0 &&
    (draft.goalType !== "other" || draft.otherGoalType.trim().length > 0)
  );
}

export function canSubmitPayDown(draft: PayDownGoalDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.debtAccountId.length > 0 &&
    draft.interestRate.length > 0 &&
    draft.minimumPayment.length > 0 &&
    draft.monthlyPayment.length > 0 &&
    (draft.goalType !== "other" || draft.otherGoalType.trim().length > 0)
  );
}

export function canSubmitInvestment(draft: InvestmentGoalDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.targetAmount.length > 0 &&
    (draft.goalType !== "other" || draft.otherGoalType.trim().length > 0)
  );
}

export function buildSaveUpPayload(draft: SaveUpGoalDraft, currency: string) {
  const resolvedGoalType =
    draft.goalType === "other"
      ? draft.otherGoalType.trim() || "other"
      : draft.goalType;

  return {
    type: "save_up" as const,
    goalType: resolvedGoalType,
    name: draft.name.trim(),
    icon: draft.icon || undefined,
    color: draft.color || undefined,
    customImageUrl: draft.customImageUrl || undefined,
    targetAmount: {
      amount: draft.targetAmount,
      currency,
    },
    targetDate: draft.targetDate || undefined,
    startDate: draft.startDate || undefined,
    description: draft.description || undefined,
    spendingReducesProgress: draft.spendingReducesProgress,
    priority: draft.priority,
    notes: draft.notes || undefined,
  };
}

export function buildInvestmentPayload(
  draft: InvestmentGoalDraft,
  currency: string
) {
  const resolvedGoalType =
    draft.goalType === "other"
      ? draft.otherGoalType.trim() || "other"
      : draft.goalType;

  return {
    type: "investment" as const,
    goalType: resolvedGoalType,
    name: draft.name.trim(),
    icon: draft.icon || undefined,
    color: draft.color || undefined,
    customImageUrl: draft.customImageUrl || undefined,
    targetAmount: {
      amount: draft.targetAmount,
      currency,
    },
    targetDate: draft.targetDate || undefined,
    startDate: draft.startDate || undefined,
    description: draft.description || undefined,
    linkedAccountId: draft.linkedAccountId || undefined,
    progressSource: "holdings" as const,
    expectedReturn: draft.expectedReturn,
    inflationRate: draft.inflationRate,
    priority: draft.priority,
    notes: draft.notes || undefined,
  };
}

export function buildPayDownPayload(
  draft: PayDownGoalDraft,
  accounts: AccountLike[],
  defaultCurrency: string
) {
  const resolvedGoalType =
    draft.goalType === "other"
      ? draft.otherGoalType.trim() || "other"
      : draft.goalType;
  const debtAccount = accounts.find(
    (account) => account.id === draft.debtAccountId
  );
  const payDownCurrency = debtAccount?.currency || defaultCurrency;

  return {
    type: "pay_down" as const,
    goalType: resolvedGoalType,
    name: draft.name.trim(),
    debtAccountId: draft.debtAccountId,
    interestRate: draft.interestRate,
    minimumPayment: {
      amount: draft.minimumPayment,
      currency: payDownCurrency,
    },
    monthlyPayment: {
      amount: draft.monthlyPayment,
      currency: payDownCurrency,
    },
    oneTimePayment: draft.oneTimePayment
      ? {
          amount: draft.oneTimePayment,
          currency: payDownCurrency,
        }
      : undefined,
    payoffMethod: draft.payoffMethod as PayoffMethod,
    priority: draft.priority,
    notes: draft.notes || undefined,
  };
}

export function buildAssignmentPayload(
  assignment: AssignmentDraft,
  currency: string
): AssignAccountInput {
  const assignmentType: AssignmentType =
    assignment.assignmentType === "partial_balance"
      ? "partial_balance"
      : "full_balance";

  return {
    accountId: assignment.accountId,
    assignmentType,
    partialAmount:
      assignmentType === "partial_balance"
        ? {
            amount: assignment.partialAmount,
            currency,
          }
        : null,
    autoUpdate: assignmentType === "full_balance",
  };
}

export function calculateTotalAssigned(
  assignments: AssignmentDraft[],
  accounts: AccountLike[]
): number {
  return assignments.reduce((sum, assignment) => {
    const account = accounts.find((a) => a.id === assignment.accountId);
    if (!account) return sum;
    if (assignment.assignmentType === "full_balance") {
      return sum + parseAmount(account.balance);
    }
    if (assignment.assignmentType === "partial_balance") {
      return sum + parseAmount(assignment.partialAmount);
    }
    return sum;
  }, 0);
}
