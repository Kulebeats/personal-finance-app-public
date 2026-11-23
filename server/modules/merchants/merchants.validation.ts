import { z } from "zod";

/**
 * A merchant logo is either an external image URL or the path of a logo this
 * server rasterised and stored (POST /api/merchants/:id/logo). The stored path
 * must be accepted here too, or saving the edit form after an upload would 400.
 */
const UPLOADED_LOGO_PATH =
  /^\/uploads\/merchant-logos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/i;
const logoUrlSchema = z
  .union([
    z.string().url(),
    z.string().regex(UPLOADED_LOGO_PATH, "Invalid uploaded logo path"),
  ])
  .nullable()
  .optional();

export const createMerchantSchema = z.object({
  name: z.string().min(1).max(255),
  logoUrl: logoUrlSchema,
  category: z.string().max(100).optional().nullable(),
  defaultCategoryId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  iconType: z.string().max(20).optional().nullable(),
  customIcon: z.string().optional().nullable(),
});

export const updateMerchantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  logoUrl: logoUrlSchema,
  category: z.string().max(100).optional().nullable(),
  defaultCategoryId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  iconType: z.string().max(20).optional().nullable(),
  customIcon: z.string().optional().nullable(),
});

export const mergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export const mergeBySourceSchema = z.object({
  targetMerchantId: z.string().uuid(),
});

/**
 * DELETE /merchants/:id archives. Permanent delete ("hard") has no retention
 * policy yet (OI-04) and merge has its own endpoint, so both are refused
 * rather than silently archiving.
 */
export const deleteMerchantQuerySchema = z
  .object({ action: z.literal("soft").optional() })
  .strict();

export const undoMergeParamsSchema = z.object({
  historyId: z.string().uuid(),
});

export const merchantIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const merchantAliasParamsSchema = z.object({
  id: z.string().uuid(),
  aliasId: z.string().uuid(),
});

export const addMerchantAliasSchema = z.object({
  aliasName: z.string().trim().min(1).max(255),
});

export type AddMerchantAliasInput = z.infer<typeof addMerchantAliasSchema>;

/** YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (isNaN(date.getTime())) return false;
    const [year, month, day] = value.split("-").map((part) => parseInt(part, 10));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  }, { message: "Invalid date - the date does not exist" });

const dateRangeShape = {
  startDate: validDateSchema.optional(),
  endDate: validDateSchema.optional(),
};

function startNotAfterEnd(value: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx): void {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must not be before startDate" });
  }
}

/** GET /merchants/:id/analytics */
export const merchantAnalyticsQuerySchema = z
  .object({ ...dateRangeShape, groupBy: z.enum(["day", "month"]).default("month") })
  .strict()
  .superRefine(startNotAfterEnd);

/** A non-negative decimal amount in the household currency, compared in SQL as numeric. */
const amountFilterSchema = z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a non-negative decimal");

/** GET /merchants/:id/transactions */
export const merchantTransactionsQuerySchema = z
  .object({
    ...dateRangeShape,
    limit: z.coerce.number().int().min(1).max(100).default(10),
    offset: z.coerce.number().int().min(0).default(0),
    categoryId: z.string().uuid().optional(),
    minAmount: amountFilterSchema.optional(),
    maxAmount: amountFilterSchema.optional(),
  })
  .strict()
  .superRefine(startNotAfterEnd);

export type MerchantAnalyticsQuery = z.infer<typeof merchantAnalyticsQuerySchema>;
export type MerchantTransactionsQuery = z.infer<typeof merchantTransactionsQuerySchema>;
