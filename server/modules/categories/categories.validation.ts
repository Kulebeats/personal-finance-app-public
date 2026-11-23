/**
 * Categories Module Validation Schemas
 *
 * Zod schemas for validating category-related requests.
 *
 * @module modules/categories/categories.validation
 */

import { strictBooleanSchema } from "../../core/validation/query-boolean";
import { z } from "zod";
import { moneyAmountStringSchema } from "../../core/validation/money";

// ============================================================================
// Category Group Type
// ============================================================================

export const categoryGroupTypeSchema = z.enum([
  "income",
  "expense",
  "expenses", // Support both singular and plural for compatibility
  "transfers",
  "other",
]);

export const budgetModeSchema = z.enum(["by_category", "by_group"]);

// ============================================================================
// Category Group Schemas
// ============================================================================

export const createCategoryGroupSchema = z.object({
  name: z.string().min(1).max(100),
  type: categoryGroupTypeSchema,
  budgetMode: budgetModeSchema.default("by_category"),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).default(0),
  isArchived: z.boolean().default(false),
});

export const updateCategoryGroupSchema = createCategoryGroupSchema.partial();

// ============================================================================
// Category Schemas
// ============================================================================

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  groupId: z.string().uuid(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).default(0),
  // SCP-335: budget-config fields are first-class on the categories table but
  // were previously unreachable via the API. Wire them through create/update.
  includeInBudget: z.boolean().default(true),
  rolloverEnabled: z.boolean().default(false),
  // DECIMAL(15,2) column — accept a validated decimal string (never a float).
  rolloverStartBalance: moneyAmountStringSchema.optional().nullable(),
  isArchived: z.boolean().default(false),
});

export const updateCategorySchema = createCategorySchema.partial();

// ============================================================================
// Query Schemas
// ============================================================================

export const categoryQuerySchema = z.object({
  includeArchived: strictBooleanSchema.default(false),
  groupType: categoryGroupTypeSchema.optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateCategoryGroupInput = z.infer<
  typeof createCategoryGroupSchema
>;
export type UpdateCategoryGroupInput = z.infer<
  typeof updateCategoryGroupSchema
>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryQuery = z.infer<typeof categoryQuerySchema>;
