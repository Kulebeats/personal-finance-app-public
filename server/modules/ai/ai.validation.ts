/**
 * AI Module Validation Schemas
 *
 * Zod schemas for input validation on AI endpoints AND for Gemini-supplied
 * tool arguments.
 *
 * SCP-314: Gemini is an untrusted source. Tool args it produces are validated
 * here BEFORE they reach any SQL filter (ILIKE / gte / lte / eq) in the
 * analytics layer. The per-tool schemas below are the single source of truth
 * for each tool's argument shape and are wired into `ai.service.ts` via
 * `validateToolArgs`. Do not cast raw model args into query filters; route them
 * through the schema first.
 *
 * @module ai/ai.validation
 */

import { z } from 'zod';

// ============================================================================
// REQUEST VALIDATION SCHEMAS
// ============================================================================

export const chatRequestSchema = z.object({
  message: z.string()
    .min(1, "Message cannot be empty")
    .max(1000, "Message exceeds maximum length of 1000 characters")
    .trim(),
  conversationId: z.string().uuid().optional()
});

export const conversationListQuerySchema = z.object({
  limit: z.coerce.number()
    .int()
    .min(1)
    .max(50)
    .default(10),
  offset: z.coerce.number()
    .int()
    .min(0)
    .default(0)
});

export const conversationIdSchema = z.object({
  id: z.string().uuid()
});

export const consentRequestSchema = z.object({
  consentGiven: z.boolean()
});

// ============================================================================
// SHARED TOOL PARAMETER PRIMITIVES
// ============================================================================

/** Full period enum (spending-by-category supports the 7-day window). */
export const periodSchema = z.enum(['7d', '30d', '90d', '12m']);

/** Merchant/trend period enum (no 7-day window; matches the tool definition). */
export const merchantPeriodSchema = z.enum(['30d', '90d', '12m']);

export const daysSchema = z.number()
  .int()
  .min(1)
  .max(365);

export const monthsSchema = z.number()
  .int()
  .min(1)
  .max(24);

export const limitSchema = z.number()
  .int()
  .min(1)
  .max(100);

/**
 * Internal identifier coming from the model. These flow into `eq(...)` filters
 * on UUID columns, so a malformed value must be rejected rather than cast.
 */
const idSchema = z.string().uuid();

/**
 * Free-text search term that flows into an ILIKE filter. Bounded length and
 * disallows the wildcard/escape characters that would let the model widen the
 * match or smuggle pattern syntax. Drizzle parameterizes the value (so this is
 * not classic SQL injection), but bounding it keeps the LIKE pattern honest.
 */
const searchTextSchema = z.string()
  .min(1, 'Search text cannot be empty')
  .max(100, 'Search text exceeds maximum length')
  .refine((s) => !/[%_\\]/.test(s), {
    message: 'Search text contains disallowed pattern characters'
  });

/**
 * Date in YYYY-MM-DD that flows into gte/lte on a date column. Validates BOTH
 * the format AND that the date actually exists (Rule 8: regex is not enough).
 */
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return false;
    const [y, m, day] = s.split('-').map((part) => Number.parseInt(part, 10));
    return (
      d.getUTCFullYear() === y &&
      d.getUTCMonth() + 1 === m &&
      d.getUTCDate() === day
    );
  }, { message: 'Invalid date - the date does not exist' });

/** Month in YYYY-MM that drives month-start/-end range construction. */
const monthSchema = z.string()
  .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM')
  .refine((s) => {
    const month = Number.parseInt(s.split('-')[1], 10);
    return month >= 1 && month <= 12;
  }, { message: 'Invalid month' });

/**
 * Money amount as a decimal string that flows into gte/lte on a decimal column.
 * Money columns are decimal/strings, so the bound must be a finite numeric
 * string (no float arithmetic here - just shape validation).
 */
const amountSchema = z.string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Amount must be a valid decimal string');

// ============================================================================
// PER-TOOL ARGUMENT SCHEMAS
// ============================================================================
//
// Each schema mirrors the shape consumed in `ai.service.ts#fetchToolData`. They
// strip unknown keys (default Zod object behaviour) and apply the tool's own
// defaults so a valid-but-partial arg set still works.

export const spendingByCategoryArgsSchema = z.object({
  period: periodSchema.default('30d')
});

export const goalsStatusArgsSchema = z.object({
  includeCompleted: z.boolean().optional()
});

export const recentTransactionsArgsSchema = z.object({
  limit: limitSchema.default(20)
});

export const upcomingRecurringArgsSchema = z.object({
  days: daysSchema.default(30)
});

export const budgetStatusArgsSchema = z.object({
  month: monthSchema.optional()
});

export const accountBalancesArgsSchema = z.object({
  includeArchived: z.boolean().optional()
});

export const merchantSpendingArgsSchema = z.object({
  period: merchantPeriodSchema.default('30d'),
  limit: limitSchema.default(20)
});

export const categoryTrendsArgsSchema = z.object({
  months: monthsSchema.default(6),
  categoryId: idSchema.optional()
});

export const monthlySummaryArgsSchema = z.object({
  month: monthSchema.optional()
});

export const transactionSearchArgsSchema = z.object({
  text: searchTextSchema.optional(),
  categoryId: idSchema.optional(),
  merchantId: idSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  minAmount: amountSchema.optional(),
  maxAmount: amountSchema.optional(),
  limit: limitSchema.default(20)
});

export const goalAssignmentsArgsSchema = z.object({}).strip();

export const cashFlowArgsSchema = z.object({
  months: monthsSchema.default(3)
});

/**
 * Registry mapping each Gemini tool name to its argument schema. The keys MUST
 * stay in lockstep with the tool names dispatched in `fetchToolData` and the
 * declarations in `ai.gemini.ts`.
 */
export const TOOL_ARG_SCHEMAS = {
  get_spending_by_category: spendingByCategoryArgsSchema,
  get_goals_status: goalsStatusArgsSchema,
  get_recent_transactions: recentTransactionsArgsSchema,
  get_upcoming_recurring: upcomingRecurringArgsSchema,
  get_budget_status: budgetStatusArgsSchema,
  get_account_balances: accountBalancesArgsSchema,
  get_merchant_spending: merchantSpendingArgsSchema,
  get_category_trends: categoryTrendsArgsSchema,
  get_monthly_summary: monthlySummaryArgsSchema,
  get_transaction_search: transactionSearchArgsSchema,
  get_goal_assignments: goalAssignmentsArgsSchema,
  get_cash_flow: cashFlowArgsSchema
} as const;

export type ToolName = keyof typeof TOOL_ARG_SCHEMAS;

export interface ToolArgValidationSuccess {
  ok: true;
  /** Parsed, defaulted, type-safe args ready to dispatch to the analytics layer. */
  args: Record<string, unknown>;
}

export interface ToolArgValidationFailure {
  ok: false;
  /** Human-readable reason, surfaced to the model as a tool error (no PII). */
  error: string;
}

export type ToolArgValidationResult =
  | ToolArgValidationSuccess
  | ToolArgValidationFailure;

/**
 * Validate Gemini-supplied tool args against the tool's Zod schema BEFORE they
 * reach any SQL filter. Returns parsed args on success, or a clean error the
 * caller can surface to the model. Never throws; never casts raw args.
 *
 * An unknown tool name is a failure (fail closed) - the caller must not run a
 * query for a tool with no registered schema.
 */
export function validateToolArgs(
  toolName: string,
  rawArgs: unknown
): ToolArgValidationResult {
  const schema = TOOL_ARG_SCHEMAS[toolName as ToolName];
  if (!schema) {
    return { ok: false, error: `No argument schema registered for tool: ${toolName}` };
  }

  // Gemini occasionally omits the args object entirely; treat that as "{}".
  const candidate =
    rawArgs === undefined || rawArgs === null ? {} : rawArgs;

  const result = schema.safeParse(candidate);
  if (!result.success) {
    const reason = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `Invalid arguments for ${toolName}: ${reason}` };
  }

  return { ok: true, args: result.data as Record<string, unknown> };
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type ConversationIdParam = z.infer<typeof conversationIdSchema>;
export type ConsentRequest = z.infer<typeof consentRequestSchema>;
