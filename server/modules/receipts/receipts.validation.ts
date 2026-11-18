/**
 * Receipts Module - Validation Schemas
 *
 * Zod schemas for receipts endpoints.
 *
 * @module modules/receipts/validation
 */

import { z } from "zod";

const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(
    (dateStr) => {
      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) return false;
      const [year, month, day] = dateStr.split("-").map(Number);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      );
    },
    { message: "Invalid date - the date does not exist" }
  );

/**
 * Match receipt to transaction
 */
export const matchSchema = z.object({
  transactionId: z.string().uuid("Invalid transaction ID format"),
  skipAmountValidation: z.boolean().optional().default(false),
});

/**
 * Store OCR results from client-side processing
 */
export const ocrResultsSchema = z.object({
  merchantName: z.string().trim().min(1).max(255).optional(),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
    .optional(),
  date: validDateSchema.optional(),
  subtotal: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid subtotal format")
    .optional(),
  tax: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid tax format")
    .optional(),
  tip: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid tip format")
    .optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(255),
        amount: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,2})?$/, "Invalid line item amount format"),
        quantity: z.number().int().positive().optional(),
        suggestedCategoryId: z
          .string()
          .uuid("Invalid category ID format")
          .optional(),
      })
    )
    .optional(),
  rawText: z.string().trim().max(10000).optional(),
  currency: z.string().trim().length(3).optional(),
  paymentMethod: z.string().trim().max(100).optional(),
  confidence: z.number().min(0).max(1),
});

/**
 * Create transaction from receipt data
 */
export const createTransactionSchema = z.object({
  accountId: z.string().uuid("Invalid account ID format"),
  name: z.string().min(1).max(200),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Invalid amount format"),
  date: validDateSchema,
  categoryId: z.string().uuid("Invalid category ID format").optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * List receipts query params
 */
export const listQuerySchema = z.object({
  status: z.enum(["pending", "matched", "all"]).optional().default("pending"),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
