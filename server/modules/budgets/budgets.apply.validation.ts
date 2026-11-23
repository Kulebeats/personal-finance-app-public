import { z } from "zod";
import { isCurrencyCode } from "@shared/denomination";

const displayedMoney = z.object({
  amount: z.string().max(64).regex(/^\d+\.\d{2}$/),
  currency: z.string().refine(isCurrencyCode, "Unsupported currency"),
}).strict();
const currentBudget = z.object({
  id: z.string().uuid(), amount: displayedMoney,
  periodId: z.string().uuid().nullable(), periodVersion: z.number().int().positive().nullable(),
}).strict().refine(row => (row.periodId === null) === (row.periodVersion === null), "Invalid displayed budget version");
const suggestion = z.object({
  categoryId: z.string().uuid().nullable(), categoryGroupId: z.string().uuid().nullable(),
  historicalTotal: displayedMoney, amount: displayedMoney, currentBudget: currentBudget.nullable(),
}).strict().refine(row => (row.categoryId === null) !== (row.categoryGroupId === null), "Choose a category or group");

export const budgetApplySchema = z.object({
  operationId: z.string().uuid().transform(value => value.toLowerCase()),
  months: z.literal(3),
  targetPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  suggestions: z.array(suggestion).min(1).max(500),
}).strict().refine(input => new Set(input.suggestions.map(row => row.categoryId ? `category:${row.categoryId}` : `group:${row.categoryGroupId}`)).size === input.suggestions.length,
  "Selected suggestions must be unique");
