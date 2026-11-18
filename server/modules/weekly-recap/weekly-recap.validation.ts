/**
 * Weekly Recap Module Validation Schemas
 *
 * Zod schemas for validating weekly recap requests.
 *
 * @module modules/weekly-recap/weekly-recap.validation
 */

import { z } from "zod";

// ============================================================================
// Query Schemas
// ============================================================================

/**
 * Helper to validate date strings
 * Checks both format (YYYY-MM-DD) and validity (e.g., rejects 2024-13-45)
 */
const isValidDate = (dateStr: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr);
  // Check if date is valid and matches the input
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr);
};

export const weeklyRecapQuerySchema = z.object({
  weekOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidDate, { message: "Invalid date format" })
    .optional(),
});

export const generateRecapSchema = z.object({
  weekOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidDate, { message: "Invalid date format" }),
  forceRegenerate: z.boolean().default(false),
});

// ============================================================================
// Recap Settings Schema
// ============================================================================

export const updateRecapSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(), // 0 = Sunday
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(), // HH:MM
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  includeBudgetProgress: z.boolean().optional(),
  includeGoalProgress: z.boolean().optional(),
  includeUpcomingBills: z.boolean().optional(),
  includeSpendingInsights: z.boolean().optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type WeeklyRecapQuery = z.infer<typeof weeklyRecapQuerySchema>;
export type GenerateRecapInput = z.infer<typeof generateRecapSchema>;
export type UpdateRecapSettingsInput = z.infer<
  typeof updateRecapSettingsSchema
>;
