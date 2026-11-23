import { z } from "zod";
import {
  moneyDtoSchema,
  nonNegativeMoneyDtoSchema,
  positiveMoneyDtoSchema,
} from "../../core/validation/money";

/**
 * Budget Validation Schemas
 */

// TODO: Restore z.enum(["monthly", "yearly", "custom"]) when period-aware calculations are implemented
// See BUD-ISSUE-003 in docs/reviews/BUDGET_MODULE_REVIEW.md
export const budgetPeriodSchema = z.literal("monthly");

/**
 * Schema for creating a new budget
 */
const nonNegativeMoneyAmountSchema = nonNegativeMoneyDtoSchema.transform(
  (value) => value.amount,
);
const positiveMoneyAmountSchema = positiveMoneyDtoSchema.transform(
  (value) => value.amount,
);

// BUDGET-VAL-001: Use positive amount (rejects zero) for budget creation
export const createBudgetSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name cannot exceed 255 characters"),
    categoryId: z.string().uuid().optional().nullable(),
    categoryGroupId: z.string().uuid().optional().nullable(),
    amount: positiveMoneyDtoSchema,
    period: budgetPeriodSchema.default("monthly"),
    rolloverEnabled: z.boolean().default(false),
    warningThreshold: z.number().int().min(0).max(100).default(80),
    alertThreshold: z.number().int().min(0).max(100).default(100),
    isActive: z.boolean().default(true),
    // "This month only": the amount is that month's limit and the budget gets
    // no recurring default (A-16).
    onlyFor: z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    }).strict().optional(),
  })
  .refine(
    (data) => {
      const hasCategoryId = data.categoryId != null;
      const hasGroupId = data.categoryGroupId != null;
      // Cannot specify both categoryId and categoryGroupId
      return !(hasCategoryId && hasGroupId);
    },
    {
      message: "Cannot specify both categoryId and categoryGroupId",
      path: ["categoryId"],
    },
  )
  .refine(
    (data) => {
      // At least one of categoryId or categoryGroupId is required for regular budgets
      // (Flex budgets are created via a different flow with isFlexBucket flag)
      const hasCategoryId = data.categoryId != null;
      const hasGroupId = data.categoryGroupId != null;
      return hasCategoryId || hasGroupId;
    },
    {
      message: "Either categoryId or categoryGroupId is required",
      path: ["categoryId"],
    },
  ).transform(input => ({ ...input, amount: input.amount.amount, currency: input.amount.currency }));

/**
 * Schema for updating a budget
 */
// BUDGET-VAL-001: Use positive amount for budget updates as well
export const updateBudgetSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    categoryId: z.string().uuid().optional().nullable(),
    categoryGroupId: z.string().uuid().optional().nullable(),
    amount: positiveMoneyDtoSchema.optional(),
    period: budgetPeriodSchema.optional(),
    rolloverEnabled: z.boolean().optional(),
    rolloverAmount: moneyDtoSchema.optional(),
    warningThreshold: z.number().int().min(0).max(100).optional(),
    alertThreshold: z.number().int().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      const hasCategoryId = data.categoryId != null;
      const hasGroupId = data.categoryGroupId != null;
      // Cannot specify both in the same update
      return !(hasCategoryId && hasGroupId);
    },
    {
      message: "Cannot specify both categoryId and categoryGroupId",
      path: ["categoryId"],
    },
  ).superRefine((input, context) => {
    if (input.amount && input.rolloverAmount && input.amount.currency !== input.rolloverAmount.currency) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rolloverAmount", "currency"], message: "Rollover and budget amount currencies must match" });
    }
  }).transform(input => {
    const { amount, rolloverAmount, ...rest } = input;
    const currency = amount?.currency ?? rolloverAmount?.currency;
    return { ...rest, ...(amount ? { amount: amount.amount } : {}), ...(rolloverAmount ? { rolloverAmount: rolloverAmount.amount } : {}),
      ...(currency === undefined ? {} : { currency }) };
  });

/**
 * Schema for budget progress query
 */
export const budgetProgressQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform((v) => parseInt(v, 10)),
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/)
    .transform((v) => parseInt(v, 10)),
});

/**
 * Schema for listing budgets
 */
export const listBudgetsQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export const budgetSettingsSchema = z.object({
  budgetSystem: z.enum(["flex", "category"]).optional(),
  defaultApplyScope: z.enum(["this_month", "all_future"]).optional(),
});

export const forecastQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform((v) => parseInt(v, 10)),
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/)
    .transform((v) => parseInt(v, 10)),
  months: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 12))
    .refine((v) => v >= 1 && v <= 36, "Months must be between 1 and 36"),
});

// BUDGET-VAL-001: Forecast amounts should be non-negative (can be zero to clear budget)
export const forecastUpdateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amount: nonNegativeMoneyDtoSchema, // Retain the explicit denomination through validation.
  applyScope: z.enum(["this_month", "all_future"]).optional(),
  months: z.number().int().min(1).max(36).optional(),
}).transform(input => ({ ...input, amount: input.amount.amount, currency: input.amount.currency }));

export const recalcBudgetsSchema = z.object({
  months: z.number().int().min(1).max(12).optional(),
  mode: z.literal("preview").optional(),
});

export const budgetPreviewQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).optional(),
});

export const clearBudgetsSchema = z.object({
  confirm: z.boolean().optional(),
});

/** POST /flex takes no input: the household comes from its context, the amount from update. */
export const ensureFlexBudgetSchema = z.object({}).strict();

export const moveBudgetSchema = z.object({
  fromBudgetId: z.string().uuid(),
  toBudgetId: z.string().uuid(),
  amount: positiveMoneyAmountSchema,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  applyScope: z.enum(["this_month", "all_future"]).optional(),
  months: z.number().int().min(1).max(36).optional(),
});

// Type exports
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type BudgetProgressQuery = z.infer<typeof budgetProgressQuerySchema>;
export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;
export type BudgetSettingsInput = z.infer<typeof budgetSettingsSchema>;
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;
export type ForecastUpdateInput = z.infer<typeof forecastUpdateSchema>;
export type RecalcBudgetsInput = z.infer<typeof recalcBudgetsSchema>;
export type ClearBudgetsInput = z.infer<typeof clearBudgetsSchema>;
export type MoveBudgetInput = z.infer<typeof moveBudgetSchema>;
