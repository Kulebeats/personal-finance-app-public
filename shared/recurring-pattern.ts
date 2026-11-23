import { z } from "zod";

// A complete selection travels in the request body, never a truncated preview.
export const MAX_PATTERN_CONTRIBUTORS = 2000;
export const patternOptionsSchema = z.object({
  minOccurrences: z.number().int().min(2).max(12).default(3),
  lookbackMonths: z.number().int().min(1).max(24).default(6),
  confidenceThreshold: z.number().min(50).max(100).default(80),
  merchantId: z.string().uuid().transform(id => id.toLowerCase()).optional(),
  categoryId: z.string().uuid().transform(id => id.toLowerCase()).optional(),
});
export const patternSelectionSchema = z.object({
  version: z.literal(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).max(100),
  timezoneSource: z.enum(["display", "profile"]),
  options: patternOptionsSchema,
  groupKey: z.string().max(512),
  contributorIds: z.array(z.string().uuid().transform(id => id.toLowerCase())).min(2).max(MAX_PATTERN_CONTRIBUTORS)
    .refine(ids => new Set(ids).size === ids.length, "Duplicate contributor IDs are not allowed"),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type PatternOptions = z.infer<typeof patternOptionsSchema>;
export type PatternSelection = z.infer<typeof patternSelectionSchema>;
