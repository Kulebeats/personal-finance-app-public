import { z } from "zod";
import {
  nonNegativeMoneyDtoSchema,
  positiveMoneyDtoSchema,
} from "../../core/validation/money";

/**
 * Validates that a string is a valid ISO date (YYYY-MM-DD)
 * Checks both format AND actual date validity (rejects "2025-13-45")
 */
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (dateStr) => {
      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) return false;
      // Ensure the parsed date matches the input (catches invalid dates like Feb 30)
      const [year, month, day] = dateStr.split("-").map(Number);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      );
    },
    { message: "Invalid date - the date does not exist" }
  );

// Goal type categories
export const saveUpGoalTypes = [
  "vacation",
  "emergency_fund",
  "down_payment",
  "wedding",
  "vehicle",
  "home_improvement",
  "special_event",
  "education",
  "other",
] as const;

export const payDownGoalTypes = [
  "credit_card",
  "student_loan",
  "car_loan",
  "mortgage",
  "personal_loan",
  "medical_debt",
  "other",
] as const;

const customImageUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith("/uploads/")) return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, "Custom image URL must be a valid URL or upload path");

const positiveMoneyAmountSchema = positiveMoneyDtoSchema.transform(
  (value) => value.amount
);

// Create Save Up Goal
export const createSaveUpGoalSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.literal("save_up"),
  goalType: z.string().min(1).max(50),
  description: z.string().max(1000).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .nullable(),
  customImageUrl: customImageUrlSchema.optional().nullable(),
  targetAmount: positiveMoneyDtoSchema,
  targetDate: validDateSchema.optional().nullable(),
  startDate: validDateSchema.optional(),
  spendingReducesProgress: z.boolean().default(false),
  priority: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

// Create Pay Down Goal
export const createPayDownGoalSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.literal("pay_down"),
  goalType: z.string().min(1).max(50),
  debtAccountId: z.string().uuid(),
  interestRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine(
      (val) => Number(val) >= 0 && Number(val) <= 100,
      "Interest rate must be between 0 and 100"
    ),
  minimumPayment: nonNegativeMoneyDtoSchema,
  monthlyPayment: positiveMoneyDtoSchema,
  oneTimePayment: nonNegativeMoneyDtoSchema.optional().nullable(),
  payoffMethod: z.enum(["avalanche", "snowball", "custom"]).default("custom"),
  priority: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

// Create Investment Goal
export const createInvestmentGoalSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.literal("investment"),
  goalType: z.string().min(1).max(50),
  description: z.string().max(1000).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .nullable(),
  customImageUrl: customImageUrlSchema.optional().nullable(),
  targetAmount: positiveMoneyDtoSchema,
  targetDate: validDateSchema.optional().nullable(),
  startDate: validDateSchema.optional(),
  linkedAccountId: z.string().uuid().optional().nullable(),
  progressSource: z.enum(["contributions", "holdings"]).optional(),
  expectedReturn: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  inflationRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  priority: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

// Union schema for create
export const createGoalSchema = z.discriminatedUnion("type", [
  createSaveUpGoalSchema,
  createPayDownGoalSchema,
  createInvestmentGoalSchema,
]);

// Update schemas (partial versions)
export const updateSaveUpGoalSchema = createSaveUpGoalSchema
  .partial()
  .omit({ type: true });
export const updatePayDownGoalSchema = createPayDownGoalSchema
  .partial()
  .omit({ type: true });
export const updateInvestmentGoalSchema = createInvestmentGoalSchema
  .partial()
  .omit({ type: true });

// Account assignment
export const assignAccountSchema = z
  .object({
    accountId: z.string().uuid(),
    assignmentType: z.enum(["full_balance", "partial_balance"]),
    partialAmount: positiveMoneyAmountSchema.optional().nullable(),
    // FIN-09: the default follows the type, so a partial request that omits it
    // is valid (a partial assignment never auto-updates).
    autoUpdate: z.boolean().optional(),
  })
  .transform((data) => ({ ...data, autoUpdate: data.autoUpdate ?? data.assignmentType === "full_balance" }))
  .refine(
    (data) => data.assignmentType !== "partial_balance" || data.partialAmount,
    {
      message: "Partial amount required for partial_balance assignment",
      path: ["partialAmount"],
    }
  );

// Goal transfer
export const goalTransferSchema = z
  .object({
    fromGoalId: z.string().uuid(),
    toGoalId: z.string().uuid(),
    // A-06: the amount keeps its currency; the locked write refuses one unlike the goals'.
    amount: positiveMoneyDtoSchema,
    reason: z.string().max(500).optional().nullable(),
    // Taking the receiving goal past its target needs confirmation (goals QA F5).
    confirmOverfund: z.boolean().optional().default(false),
  })
  .refine((data) => data.fromGoalId !== data.toGoalId, {
    message: "Cannot transfer to the same goal",
    path: ["toGoalId"],
  });

// Transaction linking
// An explicit amount keeps its currency, which must be the transaction's; one
// that takes a contribution past the target needs confirmOverfund (NEW-29).
export const linkTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  linkType: z.enum(["contribution", "spending"]),
  amount: positiveMoneyDtoSchema.optional(),
  confirmOverfund: z.boolean().optional().default(false),
});

// Add contribution (manual)
// NEW-29: the amount is validated money (positive, at most 2 dp, within the
// column range) and keeps its currency, which must be the goal's. Taking the
// goal past its target needs confirmOverfund: true.
export const addContributionSchema = z.object({
  amount: positiveMoneyDtoSchema,
  date: validDateSchema.optional(),
  notes: z.string().max(500).optional(),
  transactionId: z.string().uuid().optional(),
  confirmOverfund: z.boolean().optional().default(false),
});

// A contribution paid from an account: the expense and its link, as one write
// (#245). The key is the client's, one per contribution, so a repeat replays.
export const accountContributionSchema = z.object({
  accountId: z.string().uuid(),
  amount: positiveMoneyDtoSchema,
  date: validDateSchema,
  reason: z.string().trim().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  confirmOverfund: z.boolean().optional().default(false),
  idempotencyKey: z.string().uuid(),
});

// A mistaken contribution is reversed by an audited correction row.
export const reverseContributionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// Payoff calculation (pay_down goals)
export const calculatePayoffSchema = z.object({
  monthlyPayment: z.coerce.number().positive(),
  oneTimePayment: z.coerce.number().nonnegative().optional(),
});

// Debt strategy calculation inputs
export const debtStrategySchema = z.object({
  method: z.enum(["snowball", "avalanche"]),
  debts: z.array(
    z.object({
      id: z.string().uuid(),
      balance: z.coerce.number().nonnegative(),
      rate: z.coerce.number().nonnegative(),
      minPayment: z.coerce.number().nonnegative(),
    })
  ),
});

// Standalone "what-if" investment growth projection (arbitrary inputs, not
// tied to a saved goal — see server/services/goal/GoalProjectionCalculator).
export const calculateProjectionSchema = z.object({
  currentAmount: z.coerce.number().nonnegative(),
  monthlyContribution: z.coerce.number().nonnegative(),
  returnRate: z.coerce.number().min(0).max(100),
  inflationRate: z.coerce.number().min(0).max(100).default(0),
  years: z.coerce.number().int().positive().max(100),
  targetAmount: z.coerce.number().positive().optional(),
});

// Query schemas
export const listGoalsQuerySchema = z.object({
  type: z.enum(["save_up", "pay_down", "investment"]).optional(),
  status: z.enum(["on_track", "behind", "at_risk", "completed"]).optional(),
  includeArchived: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  includeCompleted: z
    .string()
    .transform((v) => v === "true")
    .optional(),
});

// Type exports
export type CreateSaveUpGoalInput = z.infer<typeof createSaveUpGoalSchema>;
export type CreatePayDownGoalInput = z.infer<typeof createPayDownGoalSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateSaveUpGoalInput = z.infer<typeof updateSaveUpGoalSchema>;
export type UpdatePayDownGoalInput = z.infer<typeof updatePayDownGoalSchema>;
export type UpdateInvestmentGoalInput = z.infer<
  typeof updateInvestmentGoalSchema
>;
export type AssignAccountInput = z.infer<typeof assignAccountSchema>;
export type GoalTransferInput = z.infer<typeof goalTransferSchema>;
export type LinkTransactionInput = z.infer<typeof linkTransactionSchema>;
export type AddContributionInput = z.infer<typeof addContributionSchema>;
export type ReverseContributionInput = z.infer<typeof reverseContributionSchema>;
export type CalculatePayoffInput = z.infer<typeof calculatePayoffSchema>;
export type DebtStrategyInput = z.infer<typeof debtStrategySchema>;
export type CalculateProjectionInput = z.infer<
  typeof calculateProjectionSchema
>;
export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;
