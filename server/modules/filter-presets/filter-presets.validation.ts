/**
 * Filter Presets Module - Validation Schemas
 *
 * Zod schemas for validating filter preset API requests.
 *
 * @module modules/filter-presets/filter-presets.validation
 */

import { z } from "zod";

export const FilterContextSchema = z.enum([
  "transactions",
  "reports",
  "budget",
  "cashflow",
]);

export const CreateFilterPresetSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  context: FilterContextSchema,
  filters: z.record(z.unknown()),
  isDefault: z.boolean().optional().default(false),
  isShared: z.boolean().optional().default(false),
});

export const UpdateFilterPresetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  filters: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isShared: z.boolean().optional(),
});

export const ListFilterPresetsQuerySchema = z.object({
  context: FilterContextSchema.optional(),
});

export type CreateFilterPresetDto = z.infer<typeof CreateFilterPresetSchema>;
export type UpdateFilterPresetDto = z.infer<typeof UpdateFilterPresetSchema>;
