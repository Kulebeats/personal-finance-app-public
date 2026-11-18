import { parseISO } from "date-fns";
import { toMoneyNumber } from "@/lib/money";
import type { Transaction } from "@/lib/api";

export type TransactionFormValues = {
  type: "income" | "expense" | "transfer";
  amount: string;
  merchantName?: string;
  merchantId?: string;
  date: Date;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  goalId?: string;
  isRecurring: boolean;
  recurringFrequency?:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "semi_annually"
    | "annually"
    | "custom";
  recurringIntervalValue?: number;
  recurringIntervalUnit?: "days" | "weeks" | "months" | "years";
  recurringEndDate?: Date;
  recurringAmountType?: "fixed" | "variable";
  recurringAmountTolerance?: number;
  recurringReminderDays?: number;
  recurringReminderEmail?: boolean;
  recurringReminderPush?: boolean;
  recurringReminderInApp?: boolean;
  recurringAutoLinkEnabled?: boolean;
  recurringAutoMarkReviewed?: boolean;
  recurringIsSubscription?: boolean;
  recurringTrialEndDate?: Date;
  notes?: string;
  tags: string[];
  ownerUserId: string | null;
};

export type UserPreferences = {
  rememberLastAccount?: boolean;
  defaultTransactionType?: string;
  autoFillTodayDate?: boolean;
  rememberLastCategoryPerMerchant?: boolean;
};

export function buildEditModeDefaults(
  transaction: Transaction,
  transactionTagIds: string[],
  existingRecurring?: {
    frequency?: TransactionFormValues["recurringFrequency"];
    endDate?: Date;
  }
): TransactionFormValues {
  return {
    type:
      transaction.type === "transfer"
        ? "transfer"
        : transaction.type === "income"
        ? "income"
        : "expense",
    amount: Math.abs(toMoneyNumber(transaction.amount)).toString(),
    merchantName: transaction.merchantName || transaction.name,
    merchantId: transaction.merchantId || "",
    date: parseISO(transaction.date),
    accountId: transaction.accountId,
    toAccountId: transaction.transferAccountId || "",
    categoryId: transaction.categoryId || undefined,
    goalId: undefined,
    isRecurring: transaction.isRecurring || false,
    recurringFrequency: existingRecurring?.frequency,
    recurringEndDate: existingRecurring?.endDate,
    recurringIntervalValue: undefined,
    recurringIntervalUnit: undefined,
    recurringAmountType: "fixed",
    recurringAmountTolerance: 0,
    recurringReminderDays: 3,
    recurringReminderEmail: false,
    recurringReminderPush: false,
    recurringReminderInApp: true,
    recurringAutoLinkEnabled: true,
    recurringAutoMarkReviewed: false,
    recurringIsSubscription: false,
    recurringTrialEndDate: undefined,
    notes: transaction.notes || undefined,
    tags: transactionTagIds,
    ownerUserId: transaction.ownerUserId || null,
  };
}

export function buildCreateModeDefaults(options: {
  userPrefs?: UserPreferences;
  lastAccountId?: string | null;
  now?: Date;
}): TransactionFormValues {
  const { userPrefs, lastAccountId, now } = options;
  const defaultAccountId =
    userPrefs?.rememberLastAccount && lastAccountId ? lastAccountId : "";

  const defaultType =
    (userPrefs?.defaultTransactionType as TransactionFormValues["type"]) ||
    "expense";

  const baseDate = now ?? new Date();
  const defaultDate = userPrefs?.autoFillTodayDate ? baseDate : baseDate;

  return {
    type: defaultType,
    amount: "",
    merchantName: "",
    merchantId: "",
    date: defaultDate,
    accountId: defaultAccountId,
    toAccountId: "",
    isRecurring: false,
    recurringFrequency: undefined,
    recurringIntervalValue: undefined,
    recurringIntervalUnit: undefined,
    recurringEndDate: undefined,
    recurringAmountType: "fixed",
    recurringAmountTolerance: 0,
    recurringReminderDays: 3,
    recurringReminderEmail: false,
    recurringReminderPush: false,
    recurringReminderInApp: true,
    recurringAutoLinkEnabled: true,
    recurringAutoMarkReviewed: false,
    recurringIsSubscription: false,
    recurringTrialEndDate: undefined,
    tags: [],
    ownerUserId: null,
  };
}

export function cleanMerchantName(value: string): string {
  const cleaned = value
    .replace(/[#*]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(pos|purchase|payment|card|debit|credit|txn|ref)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return value.trim();

  return cleaned
    .split(" ")
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
