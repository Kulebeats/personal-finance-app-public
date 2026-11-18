import {
  Wallet,
  TrendingUp,
  CreditCard,
  Landmark,
  Banknote,
  type LucideIcon,
} from "lucide-react";
import type { Account } from "@/lib/api";
import { parseMoney } from "@/lib/utils";
import type { AssignAccountInput, AssignmentType } from "@/hooks/useGoals";

export interface AccountGoalSetting {
  enabled: boolean;
  useEntireBalance: boolean;
  linkedGoalId: string;
  partialAmount: string;
}

export function parseAmount(value?: string | null) {
  return parseMoney(value);
}

export function areAccountSettingsEqual(
  left: Record<string, AccountGoalSetting>,
  right: Record<string, AccountGoalSetting>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!rightValue) return false;
    if (
      leftValue.enabled !== rightValue.enabled ||
      leftValue.useEntireBalance !== rightValue.useEntireBalance ||
      leftValue.linkedGoalId !== rightValue.linkedGoalId ||
      leftValue.partialAmount !== rightValue.partialAmount
    ) {
      return false;
    }
  }
  return true;
}

export type AccountGroupName = "Cash" | "Brokerage" | "Credit" | "Loans" | "Other";

export const groupAccountsByType = (accounts: Account[]) => {
  const groups: Record<AccountGroupName, Account[]> = {
    Cash: [],
    Brokerage: [],
    Credit: [],
    Loans: [],
    Other: [],
  };
  accounts?.forEach((account) => {
    const type = account.type.toLowerCase();
    const groupName: AccountGroupName =
      type === "checking" || type === "savings"
        ? "Cash"
        : type === "investment" || type === "brokerage"
        ? "Brokerage"
        : type === "credit_card"
        ? "Credit"
        : type === "loan"
        ? "Loans"
        : "Other";

    groups[groupName].push(account);
  });
  return groups;
};

export const TYPE_ICONS: Record<AccountGroupName, LucideIcon> = {
  Cash: Wallet,
  Brokerage: TrendingUp,
  Credit: CreditCard,
  Loans: Landmark,
  Other: Banknote,
};

export interface ValidationResult {
  valid: boolean;
  errorTitle?: string;
  errorDescription?: string;
}

export function validateAssignmentSetting(
  setting: AccountGoalSetting,
  account: { id: string; name: string; currency?: string },
  selectedGoal: {
    type: string;
    progressSource?: string | null;
    currency?: string;
    spendingReducesProgress?: boolean | null;
  } | undefined
): ValidationResult {
  if (!setting.enabled) {
    return { valid: true };
  }

  if (!setting.linkedGoalId) {
    return {
      valid: false,
      errorTitle: "Missing goal",
      errorDescription: `Select a goal for ${account.name} before saving.`,
    };
  }

  if (!selectedGoal) {
    return {
      valid: false,
      errorTitle: "Goal not found",
      errorDescription: `Select a valid goal for ${account.name}.`,
    };
  }

  const usesHoldings =
    selectedGoal.type === "investment" &&
    selectedGoal.progressSource === "holdings";

  if (!usesHoldings && selectedGoal.currency !== account.currency) {
    return {
      valid: false,
      errorTitle: "Currency mismatch",
      errorDescription: `${account.name} must match ${selectedGoal.currency} to assign this goal.`,
    };
  }

  if (usesHoldings && !setting.useEntireBalance) {
    return {
      valid: false,
      errorTitle: "Full balance required",
      errorDescription:
        "Holdings-tracked investment goals require full balance assignments.",
    };
  }

  if (selectedGoal.spendingReducesProgress && setting.useEntireBalance) {
    return {
      valid: false,
      errorTitle: "Full balance disabled",
      errorDescription:
        "This goal disallows full balance assignments when spending reduces progress.",
    };
  }

  const assignmentType = setting.useEntireBalance
    ? "full_balance"
    : "partial_balance";

  if (assignmentType === "partial_balance") {
    const parsed = parseAmount(setting.partialAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        valid: false,
        errorTitle: "Invalid amount",
        errorDescription: `Enter a positive amount for ${account.name}.`,
      };
    }
  }

  return { valid: true };
}

export function buildAssignmentPayload(
  setting: AccountGoalSetting,
  accountId: string,
  accountCurrency: string
): AssignAccountInput {
  const assignmentType: AssignmentType = setting.useEntireBalance
    ? "full_balance"
    : "partial_balance";
  const partialAmountDto =
    assignmentType === "partial_balance"
      ? {
          amount: setting.partialAmount,
          currency: accountCurrency || "ZMW",
        }
      : null;

  return {
    accountId,
    assignmentType,
    partialAmount: partialAmountDto,
    autoUpdate: assignmentType === "full_balance",
  };
}

export function needsAssignmentUpdate(
  existingAssignment: { assignmentType: string; partialAmount?: string | null },
  setting: AccountGoalSetting
): boolean {
  const newAssignmentType = setting.useEntireBalance
    ? "full_balance"
    : "partial_balance";
  const typeChanged = existingAssignment.assignmentType !== newAssignmentType;
  const partialChanged =
    newAssignmentType === "partial_balance" &&
    Math.abs(
      parseAmount(existingAssignment.partialAmount) -
        parseAmount(setting.partialAmount)
    ) >= 0.005;

  return typeChanged || partialChanged;
}
