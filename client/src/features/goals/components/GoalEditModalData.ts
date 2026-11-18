import {
  type Goal,
  type SaveUpGoalType,
  type PayDownGoalType,
  type InvestmentGoalType,
  type PayoffMethod,
} from "@/hooks/useGoals";
import type { SaveUpGoalDraft } from "./SaveUpGoalForm";
import type { PayDownGoalDraft } from "./PayDownGoalForm";
import type { InvestmentGoalDraft } from "./InvestmentGoalForm";

const SAVE_UP_TYPES = new Set<SaveUpGoalType>([
  "vacation",
  "emergency_fund",
  "down_payment",
  "wedding",
  "vehicle",
  "home_improvement",
  "special_event",
  "education",
  "other",
]);

const PAY_DOWN_TYPES = new Set<PayDownGoalType>([
  "credit_card",
  "student_loan",
  "car_loan",
  "mortgage",
  "personal_loan",
  "medical_debt",
  "other",
]);

const INVESTMENT_TYPES = new Set<InvestmentGoalType>([
  "retirement",
  "wealth_building",
  "education",
  "property",
  "other",
]);

export function buildSaveUpDraft(goal: Goal): SaveUpGoalDraft {
  const goalType = SAVE_UP_TYPES.has(goal.goalType as SaveUpGoalType)
    ? (goal.goalType as SaveUpGoalType)
    : "other";

  return {
    name: goal.name ?? "",
    goalType,
    otherGoalType: goalType === "other" ? goal.goalType ?? "" : "",
    icon: goal.icon ?? "",
    color: goal.color ?? "",
    customImageUrl: goal.customImageUrl ?? "",
    targetAmount: goal.targetAmount ?? "",
    targetDate: goal.targetDate ?? "",
    startDate: goal.startDate ?? "",
    description: goal.description ?? "",
    spendingReducesProgress: !!goal.spendingReducesProgress,
    priority: goal.priority ?? 0,
    notes: goal.notes ?? "",
  };
}

export function buildPayDownDraft(goal: Goal): PayDownGoalDraft {
  const goalType = PAY_DOWN_TYPES.has(goal.goalType as PayDownGoalType)
    ? (goal.goalType as PayDownGoalType)
    : "other";

  return {
    name: goal.name ?? "",
    goalType,
    otherGoalType: goalType === "other" ? goal.goalType ?? "" : "",
    debtAccountId: goal.debtAccountId ?? "",
    interestRate: goal.interestRate ?? "",
    minimumPayment: goal.minimumPayment ?? "",
    monthlyPayment: goal.monthlyPayment ?? "",
    oneTimePayment: goal.oneTimePayment ?? "",
    payoffMethod: (goal.payoffMethod as PayoffMethod) ?? "custom",
    priority: goal.priority ?? 0,
    notes: goal.notes ?? "",
  };
}

export function buildInvestmentDraft(goal: Goal): InvestmentGoalDraft {
  const goalType = INVESTMENT_TYPES.has(goal.goalType as InvestmentGoalType)
    ? (goal.goalType as InvestmentGoalType)
    : "other";

  return {
    name: goal.name ?? "",
    goalType,
    otherGoalType: goalType === "other" ? goal.goalType ?? "" : "",
    icon: goal.icon ?? "",
    color: goal.color ?? "",
    customImageUrl: goal.customImageUrl ?? "",
    targetAmount: goal.targetAmount ?? "",
    targetDate: goal.targetDate ?? "",
    startDate: goal.startDate ?? "",
    linkedAccountId: goal.linkedAccountId ?? "",
    expectedReturn: goal.expectedReturn ?? "",
    inflationRate: goal.inflationRate ?? "",
    description: goal.description ?? "",
    priority: goal.priority ?? 0,
    notes: goal.notes ?? "",
  };
}
