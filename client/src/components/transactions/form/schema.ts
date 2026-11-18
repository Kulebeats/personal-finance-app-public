import { z } from "zod";

export const transactionFormSchema = z
  .object({
    type: z.enum(["income", "expense", "transfer"]),
    amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Amount must be a positive number",
    }),
    merchantName: z.string().optional(),
    merchantId: z.string().optional(),
    date: z.date({
      required_error: "Date is required",
    }),
    accountId: z.string().min(1, "Account is required"),
    toAccountId: z.string().optional(),
    categoryId: z.string().optional(),
    goalId: z.string().optional(),
    isRecurring: z.boolean().default(false),
    recurringFrequency: z
      .enum([
        "daily",
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "semi_annually",
        "annually",
        "yearly",
        "custom",
      ])
      .optional(),
    recurringIntervalValue: z.coerce.number().min(1).max(365).optional(),
    recurringIntervalUnit: z
      .enum(["days", "weeks", "months", "years"])
      .optional(),
    recurringEndDate: z.date().optional(),
    recurringAmountType: z.enum(["fixed", "variable"]).optional(),
    recurringAmountTolerance: z.coerce.number().int().min(0).max(50).optional(),
    recurringReminderDays: z.coerce.number().int().min(0).max(30).optional(),
    recurringReminderEmail: z.boolean().optional(),
    recurringReminderPush: z.boolean().optional(),
    recurringReminderInApp: z.boolean().optional(),
    recurringAutoLinkEnabled: z.boolean().optional(),
    recurringAutoMarkReviewed: z.boolean().optional(),
    recurringIsSubscription: z.boolean().optional(),
    recurringTrialEndDate: z.date().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    ownerUserId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isRecurring && !data.recurringFrequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurringFrequency"],
        message: "Frequency is required for recurring transactions",
      });
    }

    if (data.isRecurring && data.recurringFrequency === "custom") {
      if (!data.recurringIntervalValue || data.recurringIntervalValue < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurringIntervalValue"],
          message: "Interval value is required for custom frequency",
        });
      }
      if (!data.recurringIntervalUnit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurringIntervalUnit"],
          message: "Interval unit is required for custom frequency",
        });
      }
    }

    if (data.isRecurring && data.recurringAmountType === "variable") {
      if (data.recurringAmountTolerance === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurringAmountTolerance"],
          message: "Amount tolerance is required for variable amounts",
        });
      }
    }

    if (data.type === "expense" && !data.merchantName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["merchantName"],
        message: "Merchant name is required",
      });
    }

    if (data.type === "transfer") {
      if (!data.toAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toAccountId"],
          message: "Destination account is required",
        });
      } else if (data.toAccountId === data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toAccountId"],
          message: "Transfer account must be different",
        });
      }
    }
  });

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
