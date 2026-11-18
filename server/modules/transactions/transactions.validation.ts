/**
 * Transaction Module Validation Schemas
 *
 * Zod schemas for validating transaction-related requests.
 *
 * @module modules/transactions/transactions.validation
 */

import { z } from "zod";
import { positiveMoneyDtoSchema } from "../../core/validation/money";

// ============================================================================
// Base Transaction Schemas
// ============================================================================

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate that a YYYY-MM-DD string is a real calendar date.
 * This rejects impossible dates like 2025-02-30.
 */
function isValidIsoDate(value: string): boolean {
  if (!isoDateRegex.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const dateStringSchema = z
  .union([z.string(), z.date()])
  .transform((value) => {
    // Strict ISO-only contract: YYYY-MM-DD is the ONLY accepted string format.
    // A Date instance is serialized to YYYY-MM-DD; a string is passed through
    // untouched (no new Date() coercion). This deliberately rejects ambiguous,
    // locale-unsafe inputs like "01-01-2026" instead of silently reinterpreting
    // them (which also caused a timezone off-by-one via new Date()/toISOString).
    // Consistent with server/modules/reports/reports.validation.ts.
    if (value instanceof Date) {
      return value.toISOString().split("T")[0];
    }

    return value.trim();
  })
  .refine((value) => isoDateRegex.test(value), {
    message: "Invalid date format. Use YYYY-MM-DD",
  })
  .refine((value) => isValidIsoDate(value), {
    message: "Invalid date value. Use a real calendar date (YYYY-MM-DD)",
  });

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const transactionNameSchema = z.string().min(1).max(255);

const ownerUserIdBodySchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed === "shared") return null;
  return trimmed;
}, z.string().uuid().nullable());

const ownerUserIdQuerySchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  if (trimmed === "shared") return null;
  return trimmed;
}, z.string().uuid().nullable().optional());

export const transactionTypeSchema = z.enum(["income", "expense", "transfer"]);

export const amountSchema = positiveMoneyDtoSchema;

const createTransactionBaseObjectSchema = z.object({
  accountId: z.string().uuid(),
  amount: amountSchema,
  type: transactionTypeSchema,
  date: dateStringSchema,
  name: transactionNameSchema.optional(),
  description: transactionNameSchema.optional(),
  categoryId: z.string().uuid().optional(),
  merchantId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  splits: z
    .array(
      z.object({
        amount: amountSchema,
        categoryId: z.string().uuid().optional().nullable(),
        merchantId: z.string().uuid().optional().nullable(),
        notes: z.string().max(1000).optional().nullable(),
      }),
    )
    .max(50)
    .optional(),
  isRecurring: z.boolean().optional().default(false),
  recurringTransactionId: z.string().uuid().optional(),
  recurringRuleId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const createTransactionBaseSchema = createTransactionBaseObjectSchema;

export const createTransactionSchema = createTransactionBaseObjectSchema
  .superRefine((data, ctx) => {
    if (!data.name && !data.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name is required",
        path: ["name"],
      });
    }
  })
  .transform((data) => {
    const { description, recurringRuleId, amount, splits, categoryId, ...rest } = data;
    const resolvedName = data.name ?? description ?? "";

    // FIX DATA-SPLIT-001: Clear categoryId when splits are provided to prevent double-counting
    // Parent transaction should not have a category if it has splits
    const hasSplits = splits && splits.length > 0;

    return {
      ...rest,
      name: resolvedName,
      amount: amount.amount,
      currency: amount.currency,
      // Only include categoryId if no splits present
      ...(hasSplits ? {} : { categoryId }),
      splits: splits?.map((split) => ({
        ...split,
        amount: split.amount.amount,
      })),
      recurringTransactionId: data.recurringTransactionId ?? recurringRuleId,
    };
  });

export const updateTransactionSchema = z
  .object({
    amount: positiveMoneyDtoSchema.optional(),
    type: transactionTypeSchema.optional(),
    date: dateStringSchema.optional(),
    name: transactionNameSchema.optional(),
    description: transactionNameSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    merchantId: z.string().uuid().nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
    updatedAt: timestampSchema.optional(),
    expectedUpdatedAt: timestampSchema.optional(),
    // R-05: Allow owner updates via main update endpoint
    ownerUserId: ownerUserIdBodySchema.optional(),
  })
  .transform((data) => {
    const { description, expectedUpdatedAt, amount, ...rest } = data;
    const output = {
      ...rest,
    } as typeof rest & {
      name?: string;
      updatedAt?: string;
      amount?: string;
      currency?: string;
    };

    const resolvedName = data.name ?? description;
    if (resolvedName) output.name = resolvedName;

    if (amount) {
      output.amount = amount.amount;
      output.currency = amount.currency;
    }

    const resolvedUpdatedAt = data.updatedAt ?? expectedUpdatedAt;
    if (resolvedUpdatedAt) output.updatedAt = resolvedUpdatedAt;

    return output;
  });

// ============================================================================
// Transfer Schemas
// ============================================================================

// ============================================================================
// Transfer Schemas
// ============================================================================

export const createTransferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: amountSchema,
    date: dateStringSchema.optional(),
    name: transactionNameSchema.optional(),
    description: transactionNameSchema.optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: z.string().uuid().optional(),
    // FX fields for cross-currency transfers (required when currencies differ)
    fxRate: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/, "Invalid FX rate format")
      .optional(),
    fxSource: z.string().max(50).default("manual"),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "From and to accounts must be different",
    path: ["toAccountId"],
  })
  .transform((data) => {
    const { description, amount, fxRate, fxSource, ...rest } = data;
    const resolvedName = data.name ?? description;

    return {
      ...rest,
      name: resolvedName,
      amount: amount.amount,
      currency: amount.currency,
      fxRate: fxRate ?? null,
      fxSource: fxSource ?? "manual",
    };
  });

export const updateTransferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: amountSchema,
    date: dateStringSchema.optional(),
    name: transactionNameSchema.optional(),
    description: transactionNameSchema.optional(),
    notes: z.string().max(1000).nullable().optional(),
    // FX fields for cross-currency transfers (required when currencies differ)
    fxRate: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/, "Invalid FX rate format")
      .optional(),
    fxSource: z.string().max(50).optional(),
  })
  .transform((data) => {
    const { description, amount, fxRate, fxSource, ...rest } = data;
    const resolvedName = data.name ?? description;

    return {
      ...rest,
      name: resolvedName,
      amount: amount.amount,
      currency: amount.currency,
      fxRate: fxRate ? parseFloat(fxRate) : undefined, // FIX DATA-TRANSFER-002: Convert to number
      fxSource: fxSource ?? null,
    };
  });

// ============================================================================
// Query Schemas
// ============================================================================

// UUID regex for validating tag IDs
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTagIds(tagsParam?: string): string[] | undefined {
  if (!tagsParam) return undefined;

  const tagIds = tagsParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && uuidRegex.test(t));

  return tagIds.length > 0 ? tagIds : undefined;
}

export const transactionQuerySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    merchantId: z.string().uuid().optional(),
    type: transactionTypeSchema.optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    search: z.string().max(100).optional(),
    tags: z.string().optional(), // Comma-separated tag IDs
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: z.enum(["date", "amount", "description"]).default("date"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    ownerUserId: ownerUserIdQuerySchema,
    amountMin: z.coerce.number().positive().optional(),
    amountMax: z.coerce.number().positive().optional(),
    reviewed: z.enum(["reviewed", "unreviewed"]).optional(),
  })
  .transform((data) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tags, ...rest } = data;
    return {
      ...rest,
      tagIds: parseTagIds(tags),
    };
  });

export const summaryQuerySchema = z
  .object({
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    accountId: z.string().uuid().optional(),
    groupBy: z.enum(["day", "week", "month", "year"]).default("month"),
    ownerUserId: ownerUserIdQuerySchema,
    tags: z.string().optional(), // Comma-separated tag IDs
  })
  .transform((data) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tags, ...rest } = data;
    return {
      ...rest,
      tagIds: parseTagIds(tags),
    };
  });

export const listTransactionsQuerySchema = transactionQuerySchema;

// ============================================================================
// Bulk Operation Schemas
// ============================================================================

export const bulkUpdateSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(100),
  updates: updateTransactionSchema,
});

export const bulkDeleteSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(100),
});

export const setTransactionOwnerSchema = z.object({
  ownerUserId: ownerUserIdBodySchema,
});

export const bulkSetTransactionOwnerSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(100),
  ownerUserId: ownerUserIdBodySchema,
});

export const bulkUpdateCategorySchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(100),
  categoryId: z.string().uuid().nullable(),
});

export const bulkAddTagsSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(100),
  tagIds: z.array(z.string().uuid()).min(1).max(10),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type UpdateTransferInput = z.infer<typeof updateTransferSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type SetTransactionOwnerInput = z.infer<
  typeof setTransactionOwnerSchema
>;
export type BulkSetTransactionOwnerInput = z.infer<
  typeof bulkSetTransactionOwnerSchema
>;
export type BulkUpdateCategoryInput = z.infer<typeof bulkUpdateCategorySchema>;
export type BulkAddTagsInput = z.infer<typeof bulkAddTagsSchema>;
