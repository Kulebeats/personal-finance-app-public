/**
 * Accounts Module Validation Schemas
 *
 * Zod schemas for validating account-related requests.
 *
 * @module modules/accounts/accounts.validation
 */

import { strictBooleanSchema } from "../../core/validation/query-boolean";
import { z } from "zod";
import Decimal from "decimal.js";

// ============================================================================
// Account Type Enums
// ============================================================================

export const accountTypeSchema = z.enum([
  "checking",
  "savings",
  "credit",
  "cash",
  "mobile_money",
  "investment",
  "loan",
  "mortgage",
  "other_liability",
  "real_estate",
  "vehicle",
  "other",
]);

export const accountSubtypeSchema = z
  .enum([
    "traditional",
    "roth",
    "401k",
    "brokerage",
    "crypto",
    "property",
    "vehicle",
    "personal",
    "business",
    "other",
  ])
  .optional();

// ============================================================================
// Create/Update Schemas
// ============================================================================

// TODO-012: Amount schema enforces max 2 decimals to match DB scale
const amountSchema = z
  .union([z.string(), z.number()])
  .transform((val) => String(val))
  .refine((val) => /^-?\d+(\.\d{1,2})?$/.test(val), {
    message: "Invalid amount format (max 2 decimals)",
  });

const nullableAmountSchema = z.union([amountSchema, z.null()]);

const normalizeOwnerUserId = (value: unknown) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed === "shared") return null;
  if (trimmed === "all") return undefined;
  return trimmed;
};

const ownerUserIdSchema = z.preprocess(
  normalizeOwnerUserId,
  z.string().uuid().nullable().optional(),
);

const ownerUserIdRequiredSchema = z.preprocess(
  normalizeOwnerUserId,
  z.string().uuid().nullable(),
);

/**
 * Date string schema with actual date validation
 * Uses refine() to validate that the date actually exists (e.g., rejects "2025-02-30")
 */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
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

const accountBaseSchema = z.object({
  name: z.string().min(1).max(100),
  type: accountTypeSchema,
  subtype: accountSubtypeSchema,
  currency: z.string().length(3).default("ZMW"),
  initialBalance: amountSchema.optional(),
  balance: amountSchema.optional(),
  institution: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  ownerUserId: ownerUserIdSchema,
  // Credit/loan account fields
  creditLimit: amountSchema.optional(),
  apr: z.coerce.number().min(0).max(100).optional(), // APR percentage 0-100
  statementDay: z.coerce.number().int().min(1).max(31).optional(), // Day 1-31
  // Property/vehicle fields
  estimatedValue: nullableAmountSchema.optional(),
  purchaseDate: dateStringSchema.nullable().optional(),
  address: z.string().max(255).nullable().optional(),
});

export const createAccountSchema = accountBaseSchema.transform((data) => {
  const { balance, initialBalance, apr, ...rest } = data;
  return {
    ...rest,
    initialBalance: initialBalance ?? balance ?? "0",
    apr: apr !== undefined ? String(apr) : undefined,
  };
});

export const updateAccountSchema = accountBaseSchema
  .partial()
  .extend({
    isArchived: z.boolean().optional(),
    displayOrder: z.coerce.number().int().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .transform((data) => {
    const { apr, ...rest } = data;
    return {
      ...rest,
      apr: apr !== undefined ? String(apr) : undefined,
    };
  });

export const balanceAdjustmentSchema = z.object({
  amount: amountSchema.refine(
    (val) => {
      try {
        return new Decimal(val).greaterThan(0);
      } catch {
        return false;
      }
    },
    { message: "Amount must be positive" },
  ),
  isIncrease: strictBooleanSchema,
  notes: z.string().max(500).optional(),
});

// ============================================================================
// Query Schemas
// ============================================================================

export const accountQuerySchema = z.object({
  includeArchived: strictBooleanSchema.default(false),
  includeHidden: strictBooleanSchema.default(false),
  ownerUserId: ownerUserIdSchema,
});

export const listAccountsQuerySchema = accountQuerySchema;

export const balanceHistoryQuerySchema = z.object({
  dateRange: z.enum(["1w", "1m", "3m", "6m", "ytd", "1y", "all"]).default("1m"),
});

export const netWorthHistoryQuerySchema = z.object({
  dateRange: z.enum(["1w", "1m", "3m", "6m", "ytd", "1y", "all"]).default("1m"),
  scope: z.enum(["user", "household"]).default("user"),
  includeAccounts: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  ownerUserId: ownerUserIdSchema,
});

export type NetWorthHistoryQuery = z.infer<typeof netWorthHistoryQuerySchema>;

export const transactionsExportQuerySchema = z.object({
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
});

export const balanceHistoryImportSchema = z.object({
  data: z.array(
    z.object({
      date: dateStringSchema,
      amount: amountSchema,
    }),
  ),
});

/** A-01: bounds the per-row review decisions (one per flagged row at most). */
const IMPORT_REVIEW_DECISIONS_MAX = 5000;

export const transactionImportSchema = z.object({
  transactions: z.array(
    z.object({
      date: dateStringSchema,
      merchant: z.string().min(1).max(255),
      category: z.string().optional(),
      originalStatement: z.string().optional(),
      notes: z.string().optional(),
      amount: amountSchema,
      tags: z.string().optional(),
    }),
  ),
  adjustBalance: strictBooleanSchema.default(false),
  // A-01: the member's choice for each row a previous attempt flagged, bound to the match it was shown.
  possibleDuplicateDecisions: z.array(z.object({
    row: z.number().int().min(1),
    matchesTransactionId: z.string().uuid(),
    decision: z.enum(["post", "skip"]),
  }).strict()).max(IMPORT_REVIEW_DECISIONS_MAX).default([])
    .refine(decisions => new Set(decisions.map(item => item.row)).size === decisions.length,
      { message: "Each row may have only one decision" }),
});

export const accountSettingsSchema = z.object({
  isHidden: z.boolean().optional(),
  excludeFromNetWorth: z.boolean().optional(),
  hideTransactions: z.boolean().optional(),
});

export const setAccountOwnerSchema = z.object({
  ownerUserId: ownerUserIdRequiredSchema,
});

export const bulkSetAccountOwnerSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1).max(100),
  ownerUserId: ownerUserIdRequiredSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type BalanceAdjustmentInput = z.infer<typeof balanceAdjustmentSchema>;
export type AccountQuery = z.infer<typeof accountQuerySchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
export type BalanceHistoryQuery = z.infer<typeof balanceHistoryQuerySchema>;
export type DateRange = z.infer<typeof balanceHistoryQuerySchema>["dateRange"];
