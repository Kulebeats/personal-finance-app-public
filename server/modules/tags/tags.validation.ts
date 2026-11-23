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
import { ValidationError } from "../../core/errors";

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

const integerQuery = (min: number, max: number) => z.string().regex(/^\d+$/)
  .transform(Number).pipe(z.number().int().min(min).max(max));
const defaultInteger = (value: number, min: number, max: number) =>
  z.preprocess((input) => input === undefined ? String(value) : input, integerQuery(min, max));
export const listTagsQuerySchema = z.object({ search: z.string().max(100).optional(), limit: integerQuery(1, 500).optional() }).strict();
export const tagTransactionsQuerySchema = z.object({ limit: defaultInteger(50, 1, 100), offset: defaultInteger(0, 0, Number.MAX_SAFE_INTEGER) }).strict();
export const analyticsQuerySchema = z.object({ limit: defaultInteger(20, 1, 500) }).strict();
export const suggestQuerySchema = z.object({ transactionName: z.string().max(500).optional(), merchantName: z.string().max(500).optional(), limit: defaultInteger(5, 1, 500) }).strict();

/** Most source tags one merge may name (NEW-19). */
const MAX_MERGE_SOURCE_TAGS = 100;
const tagIdSchema = z.string().uuid("Tag ids must be UUIDs").transform((id) => id.toLowerCase());

/** POST /api/tags/merge body (NEW-19): a malformed id is a 400, never a database error. */
export const mergeTagsSchema = z.object({
  sourceTagIds: z.array(tagIdSchema, { invalid_type_error: "sourceTagIds must be an array" })
    .min(1, "At least one source tag is required")
    .max(MAX_MERGE_SOURCE_TAGS, `At most ${MAX_MERGE_SOURCE_TAGS} source tags can be merged at once`),
  targetTagId: tagIdSchema,
});

export function parseTagId(id: string) {
  const result = z.string().uuid().safeParse(id);
  if (!result.success) throw new ValidationError("Invalid UUID", result.error.errors);
  return result.data;
}

// ============================================================================
// Type Exports
// ============================================================================

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type TagQuery = z.infer<typeof tagQuerySchema>;
export type MergeTagsBody = z.infer<typeof mergeTagsSchema>;
