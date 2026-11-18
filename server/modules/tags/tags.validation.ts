/**
 * Tags Module Validation Schemas
 *
 * Re-exports shared validation schemas from @shared/schema.
 * Duplicate schemas removed per TAGS-VAL-001 fix.
 *
 * @module modules/tags/tags.validation
 */

import { z } from "zod";
import { insertTagSchema, updateTagSchema as sharedUpdateTagSchema } from "@shared/schema";

// ============================================================================
// Tag Schemas
// ============================================================================

/**
 * Create tag schema
 * Re-exported from shared schema
 */
export const createTagSchema = insertTagSchema;

/**
 * Update tag schema
 * Re-exported from shared schema
 */
export const updateTagSchema = sharedUpdateTagSchema;

// ============================================================================
// Query Schemas
// ============================================================================

export const tagQuerySchema = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type TagQuery = z.infer<typeof tagQuerySchema>;
