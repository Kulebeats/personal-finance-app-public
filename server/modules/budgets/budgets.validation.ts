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
const moneyAmountSchema = moneyDtoSchema.transform((value) => value.amount);

// BUDGET-VAL-001: Use positive amount (rejects zero) for budget creation
export const createBudgetSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name cannot exceed 255 characters"),
    categoryId: z.string().uuid().optional().nullable(),
    categoryGroupId: z.string().uuid().optional().nullable(),
    amount: positiveMoneyAmountSchema, // Changed from nonNegativeMoneyAmountSchema to reject zero
    period: budgetPeriodSchema.default("monthly"),
    rolloverEnabled: z.boolean().default(false),
    warningThreshold: z.number().int().min(0).max(100).default(80),
    alertThreshold: z.number().int().min(0).max(100).default(100),
    isActive: z.boolean().default(true),
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
  );

/**
 * Schema for updating a budget
 */
// BUDGET-VAL-001: Use positive amount for budget updates as well
export const updateBudgetSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    categoryId: z.string().uuid().optional().nullable(),
    categoryGroupId: z.string().uuid().optional().nullable(),
    amount: positiveMoneyAmountSchema.optional(), // Changed to reject zero
    period: budgetPeriodSchema.optional(),
    rolloverEnabled: z.boolean().optional(),
    rolloverAmount: moneyAmountSchema.optional(),
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
  );

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
  amount: nonNegativeMoneyAmountSchema, // Keep as non-negative (zero allowed for clearing)
  applyScope: z.enum(["this_month", "all_future"]).optional(),
  months: z.number().int().min(1).max(36).optional(),
});

export const recalcBudgetsSchema = z.object({
  months: z.number().int().min(1).max(12).optional(),
});

export const clearBudgetsSchema = z.object({
  confirm: z.boolean().optional(),
});

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
