import { z } from "zod";
import { positiveMoneyDtoSchema } from "../../core/validation/money";
import { createTransactionBaseSchema } from "../transactions/transactions.validation";
import { MAX_PATTERN_CONTRIBUTORS, patternOptionsSchema, patternSelectionSchema } from "@shared/recurring-pattern";

/**
 * Recurring Transaction Validation Schemas
 */

/**
 * Valid date schema - validates format AND actual date existence
 * Rejects invalid dates like "2025-02-30" or "2025-13-45"
 */
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (dateStr) => {
      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) return false;
      // Ensure parsed date matches input (catches Feb 30, etc.)
      const [year, month, day] = dateStr.split("-").map(Number);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      );
    },
    { message: "Invalid date - the date does not exist" },
  );

export const frequencySchema = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semi_annually",
  "annually",
  "yearly",
  "custom",
]);

export const recurringTypeSchema = z.enum(["income", "expense"]);

const positiveMoneyAmountSchema = positiveMoneyDtoSchema.transform(
  (value) => value.amount,
);

/**
 * Schema for creating a recurring rule
 */
export const createRecurringSchema = z
  .object({
    accountId: z.string().uuid("Invalid account ID"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name cannot exceed 255 characters"),
    amount: positiveMoneyAmountSchema,
    amountType: z.enum(["fixed", "variable"]).default("fixed"),
    amountTolerance: z.number().int().min(0).max(50).default(0),
    type: recurringTypeSchema,
    frequency: frequencySchema,
    categoryId: z.string().uuid().optional().nullable(),
    merchantId: z.string().uuid().optional().nullable(),
    intervalValue: z.number().int().min(1).max(365).optional(),
    intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
    startDate: validDateSchema.optional(),
    endDate: validDateSchema.optional().nullable(),
    nextDueDate: validDateSchema,
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    reminderDays: z.number().int().min(0).max(30).default(3),
    reminderEmail: z.boolean().default(false),
    reminderPush: z.boolean().default(false),
    reminderInApp: z.boolean().default(true),
    autoLinkEnabled: z.boolean().default(true),
    autoMarkReviewed: z.boolean().default(false),
    isSubscription: z.boolean().default(false),
    trialEndDate: validDateSchema.optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .transform((data) => ({
    ...data,
    startDate: data.startDate ?? data.nextDueDate,
  }))
  .superRefine((data, ctx) => {
    if (data.frequency === "custom") {
      if (!data.intervalUnit || !data.intervalValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Custom frequency requires intervalUnit and intervalValue",
          path: ["intervalUnit"],
        });
      }
    }
  });

const baseTransactionSchema = createTransactionBaseSchema.omit({
  isRecurring: true,
  recurringTransactionId: true,
});

const recurringOptionsSchema = z
  .object({
    frequency: frequencySchema,
    startDate: validDateSchema.optional(),
    endDate: validDateSchema.optional().nullable(),
    intervalValue: z.number().int().min(1).max(365).optional(),
    intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
    amountType: z.enum(["fixed", "variable"]).optional(),
    amountTolerance: z.number().int().min(0).max(50).optional(),
    reminderDays: z.number().int().min(0).max(30).optional(),
    reminderEmail: z.boolean().optional(),
    reminderPush: z.boolean().optional(),
    reminderInApp: z.boolean().optional(),
    autoLinkEnabled: z.boolean().optional(),
    autoMarkReviewed: z.boolean().optional(),
    isSubscription: z.boolean().optional(),
    trialEndDate: validDateSchema.optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.frequency === "custom") {
      if (!data.intervalUnit || !data.intervalValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Custom frequency requires intervalUnit and intervalValue",
          path: ["intervalUnit"],
        });
      }
    }
  });

/**
 * Schema for creating a transaction and recurring rule together
 */
export const createRecurringFromTransactionSchema = baseTransactionSchema
  .extend({
    recurring: recurringOptionsSchema,
  })
  .superRefine((data, ctx) => {
    if (!data.name && !data.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name is required",
        path: ["name"],
      });
    }
    data.splits?.forEach((split, index) => {
      if (split.amount.currency !== data.amount.currency) ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Split currency must match the transaction currency",
        path: ["splits", index, "amount", "currency"],
      });
    });
  })
  .transform((data) => {
    const { description, recurringRuleId, amount, splits, ...rest } = data;
    const resolvedName = data.name ?? description ?? "";
    return {
      ...rest,
      name: resolvedName,
      amount: amount.amount,
      currency: amount.currency,
      splits: splits?.map((split) => ({
        ...split,
        amount: split.amount.amount,
      })),
      recurringTransactionId: recurringRuleId,
      isRecurring: false as const, // Will be set true after linking
    };
  });

/**
 * Schema for creating a recurring rule from an existing transaction
 */
export const createRecurringFromExistingTransactionSchema =
  recurringOptionsSchema;

/**
 * Schema for updating a recurring rule
 */
export const updateRecurringSchema = z
  .object({
    confirmDenomination: z.boolean().optional(),
    expectedDefinition: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    accountId: z.string().uuid().optional(),
    name: z.string().min(1).max(255).optional(),
    amount: positiveMoneyAmountSchema.optional(),
    amountType: z.enum(["fixed", "variable"]).optional(),
    amountTolerance: z.number().int().min(0).max(50).optional(),
    type: recurringTypeSchema.optional(),
    frequency: frequencySchema.optional(),
    categoryId: z.string().uuid().optional().nullable(),
    merchantId: z.string().uuid().optional().nullable(),
    intervalValue: z.number().int().min(1).max(365).optional(),
    intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
    endDate: validDateSchema.optional().nullable(),
    nextDueDate: validDateSchema.optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    reminderDays: z.number().int().min(0).max(30).optional(),
    reminderEmail: z.boolean().optional(),
    reminderPush: z.boolean().optional(),
    reminderInApp: z.boolean().optional(),
    autoLinkEnabled: z.boolean().optional(),
    autoMarkReviewed: z.boolean().optional(),
    isSubscription: z.boolean().optional(),
    trialEndDate: validDateSchema.optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
    isPaused: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.confirmDenomination && data.amount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the amount to confirm its denomination", path: ["amount"] });
    }
    if (data.confirmDenomination && !data.expectedDefinition) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reload the observed definition before confirming denomination", path: ["expectedDefinition"] });
    }
    if (data.frequency === "custom") {
      if (!data.intervalUnit || !data.intervalValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Custom frequency requires intervalUnit and intervalValue",
          path: ["intervalUnit"],
        });
      }
    }
  });

/**
 * Schema for listing recurring rules
 */
export const listRecurringQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  includePaused: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

// PostgreSQL's calendar represents the year before 0001 as 0001 BC.
const calendarDateSchema = validDateSchema.refine(date => !date.startsWith("0000-"), {
  message: "Year must be between 0001 and 9999",
});
export const recurringCalendarQuerySchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema,
}).refine(({ from, to }) => from <= to && from.slice(0, 7) === to.slice(0, 7), {
  path: ["to"],
  message: "Calendar date range must be within one month",
});

/**
 * Schema for upcoming bills query
 */
export const upcomingQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 14;
      const parsed = parseInt(v, 10);
      if (isNaN(parsed) || parsed < 1) return 14;
      return Math.min(parsed, 365); // Cap at 1 year
    }),
});

/**
 * Pattern detection and linking schemas
 */
export const detectPatternsSchema = patternOptionsSchema;

export const confirmPatternSchema = z.object({
  accountId: z.string().uuid(),
  pattern: z.object({
    name: z.string().min(1),
    type: recurringTypeSchema,
    merchantId: z.string().uuid().optional().nullable(),
    estimatedAmount: positiveMoneyDtoSchema,
    amountVariance: z.number().finite().min(0).optional(), // Measurement is distinct from the bounded rule tolerance.
    confidence: z.number().min(0).max(100).optional(),
    frequency: frequencySchema,
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    suggestedStartDate: validDateSchema,
    suggestedNextDueDate: validDateSchema,
    sampleTransactionIds: z.array(z.string().uuid().transform(id => id.toLowerCase())).min(1).max(MAX_PATTERN_CONTRIBUTORS)
      .refine(ids => new Set(ids).size === ids.length, "Duplicate contributor IDs are not allowed"),
    occurrences: z.number().int().min(2).optional(),
    selection: patternSelectionSchema.optional(),
  }),
});

export const linkTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  matchConfidence: z.number().int().min(0).max(100).optional(),
});

/** R14: naming the skipped occurrence makes a repeated skip an idempotent no-op. */
export const skipRecurringSchema = z.object({
  occurrenceDate: validDateSchema.optional(),
});

export const endRecurringSchema = z.object({
  endDate: validDateSchema.optional(),
  reason: z.string().max(500).optional(),
});

export const historyQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 50;
      const parsed = parseInt(v, 10);
      if (isNaN(parsed) || parsed < 1) return 50;
      return Math.min(parsed, 100); // Cap at 100 items
    }),
});

/**
 * Schema for manual recurring processing
 */
export const processRecurringSchema = z.object({
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, only simulate processing without creating transactions"),
  asOfDate: validDateSchema
    .optional()
    .describe("Process rules due as of this date (defaults to today)"),
});

// Type exports
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type CreateRecurringFromTransactionInput = z.infer<
  typeof createRecurringFromTransactionSchema
>;
export type CreateRecurringFromExistingTransactionInput = z.infer<
  typeof createRecurringFromExistingTransactionSchema
>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
export type ListRecurringQuery = z.infer<typeof listRecurringQuerySchema>;
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;
export type ConfirmPatternInput = z.infer<
  typeof confirmPatternSchema
>["pattern"] & {
  confidence?: number;
  amountVariance?: number;
};
