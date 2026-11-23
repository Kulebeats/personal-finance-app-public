/**
 * R05.2 named household saved views: the shared client/server contract (Rule 18).
 *
 * A saved view is a narrowing filter over the transaction list. Every field is
 * an AND-ed condition the list already understands; there is no field that
 * names a household, a member's privacy or anything else that could widen what
 * the viewer may see. Unknown keys are rejected (strict).
 */
import { z } from "zod";

const uuid = z.string().uuid();
const MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

/** "YYYY-MM-DD" that names a real calendar day (Rule 8: a regex alone accepts 2026-02-30). */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((value) => {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "The date does not exist");

/**
 * Positive decimal string with at most 2 decimal places (Rule 1: money stays a string).
 * Zod still runs refinements after a failed regex, so the BigInt conversion is guarded:
 * "1e3" or "abc" must be a validation issue (400), never a thrown SyntaxError (500).
 */
const moneyAmount = z.string().regex(MONEY_PATTERN, "Use a positive amount with at most 2 decimal places")
  .refine((value) => !MONEY_PATTERN.test(value) || toCents(value) > 0n, "The amount must be greater than zero");

/** Exact integer cents, for comparing two amounts without floating point. */
function toCents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export const savedViewFilterSchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  tagIds: z.array(uuid).min(1).max(20).optional(),
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  amountMin: moneyAmount.optional(),
  amountMax: moneyAmount.optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  reviewed: z.enum(["reviewed", "unreviewed"]).optional(),
  /** Relative to the person applying the view: "mine" = their own transactions. */
  owner: z.enum(["mine", "shared"]).optional(),
}).strict().superRefine((filter, ctx) => {
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "The end date is before the start date" });
  }
  if (filter.amountMin && filter.amountMax && MONEY_PATTERN.test(filter.amountMin) && MONEY_PATTERN.test(filter.amountMax)
    && toCents(filter.amountMin) > toCents(filter.amountMax)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountMax"], message: "The maximum is below the minimum" });
  }
});

const savedViewName = z.string().trim().min(1, "Name is required").max(80, "Name must be 80 characters or less");

export const createSavedViewSchema = z.object({
  name: savedViewName,
  filter: savedViewFilterSchema,
}).strict();

export const updateSavedViewSchema = z.object({
  name: savedViewName.optional(),
  filter: savedViewFilterSchema.optional(),
  version: z.number().int().positive(),
}).strict().refine((body) => body.name !== undefined || body.filter !== undefined, {
  message: "Change the name or the filter",
});

export const deleteSavedViewQuerySchema = z.object({
  version: z.coerce.number().int().positive(),
});

export type SavedViewFilter = z.infer<typeof savedViewFilterSchema>;
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;

export interface SavedViewResponse {
  id: string;
  name: string;
  /** The filter as this viewer may see it. */
  filter: SavedViewFilter;
  /** True when the view names an account this viewer cannot see; it is then not applicable. */
  restricted: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
