import { z } from "zod";
import type { BudgetRecalculationPreview, BudgetRecalculationSuggestion } from "@shared/budget-recalculation-preview";
import type { MoneyDto } from "@shared/money";

const identity = z.string().uuid();
export const previewMonths = 3;
const period = z.string().regex(/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/);
const money = z.object({
  amount: z.string().max(64).regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
const values = {
  historicalTotal: money,
  amount: money,
  currentBudget: z.object({ id: identity, amount: money, periodId: identity.nullable(), periodVersion: z.number().int().nonnegative().nullable() }).strict().nullable(),
};
const suggestion = z.union([
  z.object({ categoryId: identity, categoryGroupId: z.null(), ...values }).strict(),
  z.object({ categoryId: z.null(), categoryGroupId: identity, ...values }).strict(),
]);
const contract = z.object({
  mode: z.literal("preview"), scope: z.literal("visible_posted_activity"),
  targetPeriod: period, periods: z.array(period).length(previewMonths), suggestions: z.array(suggestion),
}).strict().superRefine((value, context) => {
  const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5));
  const firstMonth = monthIndex(value.targetPeriod) - previewMonths;
  if (value.periods.some((month, index) => monthIndex(month) !== firstMonth + index)) {
    context.addIssue({ code: "custom", message: "Preview requires the requested consecutive completed months" });
  }
  const seen = new Set<string>();
  for (const row of value.suggestions) {
    const key = row.categoryId ? `category:${row.categoryId}` : `group:${row.categoryGroupId}`;
    if (seen.has(key) || row.historicalTotal.currency !== row.amount.currency) {
      context.addIssue({ code: "custom", message: "Preview has inconsistent suggestions" });
    }
    seen.add(key);
  }
});

export function validateBudgetPreview(value: unknown): BudgetRecalculationPreview { return contract.parse(value); }

export interface ConfirmedBudgetApplication {
  operationId: string;
  months: typeof previewMonths;
  targetPeriod: string;
  suggestions: BudgetRecalculationSuggestion[];
}

export function validateBudgetApplication(value: unknown, request: ConfirmedBudgetApplication): void {
  const result = z.object({ success: z.literal(true), data: z.object({
    operationId: identity, targetPeriod: period, appliedCount: z.number().int().nonnegative(),
  }).strict() }).strict().parse(value);
  if (result.data.operationId !== request.operationId || result.data.targetPeriod !== request.targetPeriod ||
    result.data.appliedCount !== request.suggestions.length) throw new Error("Unverified budget application response");
}

/** Exact display only: never convert, average, relabel, or coerce missing money. */
export function formatPreviewMoney(value: MoneyDto): string {
  const [whole, fraction = ""] = value.amount.split(".");
  return `${value.currency} ${whole}.${fraction.padEnd(2, "0")}`;
}
export function previewMonthLabel(value: string): string {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
