import { z } from "zod";
import { Money } from "../core/money";
import { nonNegativeMoneyDtoSchema, positiveMoneyDtoSchema } from "../core/validation/money";

// Regex alone accepts "2026-02-30"; the date must actually exist (CLAUDE.md Rule 8).
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    const [year, month, day] = value.split("-").map(Number);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
  }, { message: "Invalid date - the date does not exist" });

/**
 * POST /api/investments/pension/:id/contributions body. Amounts are MoneyDto
 * objects in ONE currency, which the service checks against the holding's.
 */
export const pensionContributionSchema = z
  .object({
    date: validDateSchema,
    employeeContribution: nonNegativeMoneyDtoSchema,
    employerContribution: nonNegativeMoneyDtoSchema,
    totalContribution: positiveMoneyDtoSchema,
  })
  .superRefine((value, ctx) => {
    const { employeeContribution: employee, employerContribution: employer, totalContribution: total } = value;
    if (employee.currency !== total.currency || employer.currency !== total.currency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalContribution", "currency"], message: "All amounts must use the same currency" });
      return;
    }
    const sum = new Money(employee.amount, total.currency).add(new Money(employer.amount, total.currency));
    if (!sum.equals(new Money(total.amount, total.currency))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalContribution", "amount"], message: "Total must equal employee plus employer contribution" });
    }
  });

export type PensionContributionInput = z.infer<typeof pensionContributionSchema>;
