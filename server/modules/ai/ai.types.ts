/**
 * AI Module Type Definitions
 *
 * Strict TypeScript types for AI assistant functionality.
 * NO `any` types allowed per CLAUDE.md standards.
 *
 * @module ai/ai.types
 */

import { Money } from "../../core/money";
import type { HouseholdContext } from "../../middleware/householdGuard";

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

// ChatRequest is exported from ai.validation.ts (Zod-validated type)

import type { AIServiceState, ProviderStatus } from './ai.health.service';

export interface ChatResponse {
  reply: string;
  /** The thread the reply was stored in; absent when there is none (Astra #255 r4). */
  conversationId?: string;
  toolsUsed: string[];
  tokenCount: number;
  remainingQueries: number;
  provenance?: ResponseProvenance;
  /**
   * R17 (17e): how the reply was produced. `claude` / `gemini` are external
   * answers, `local` is the labelled limited summary, `unavailable` is an
   * honest non-answer (nothing was persisted as an assistant reply).
   */
  answerMode: "claude" | "gemini" | "local" | "unavailable";
  /** Which provider handled each stage; null when the stage did not run. */
  providers: {
    analysis: "anthropic" | "gemini" | "local" | null;
    answer: "anthropic" | "gemini" | "local" | null;
  };
}

export interface ResponseProvenance {
  dataWindow: {
    start: string;
    end: string;
  };
  freshnessTs: string;
  tools: string[];
}

/**
 * GET /api/ai/status response shape (v1.1 Workstream E4).
 *
 * `degraded` is additive: older clients that don't know about it simply
 * ignore the extra field, so this is a non-breaking change to the contract.
 */
export interface AIStatusResponse {
  available: boolean;
  degraded: boolean;
  /** R17: real health, from the attempt ledger for the configured models. */
  state: AIServiceState;
  quotaLimited: boolean;
  providers: ProviderStatus[];
  rateLimit: {
    remaining: number;
    resetTime: string;
    isLimited: boolean;
  };
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
  total: number;
  hasMore: boolean;
}

export interface ConversationSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export interface ConversationDetails {
  id: string;
  householdId: string;
  userId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolsUsed?: string[];
}

// ============================================================================
// TOOL RESULT TYPES (ALL USE MONEY CLASS)
// ============================================================================

export interface SpendingByCategoryResult {
  category: string;
  /** Null when any included flow lacks captured denomination or trusted dated FX. */
  amount: Money | null;
  transactionCount: number;
  percentOfTotal: number | null;
}

interface GoalStatusBase {
  goalId: string;
  name: string;
  projectedCompletion: string | null;
}

/**
 * A shared goal and its target stay visible to every member. Progress that
 * depends on a source the current member cannot see is unavailable, never a number.
 */
export type GoalStatusResult =
  | (GoalStatusBase & {
      progressAvailability?: "available";
      target: Money;
      current: Money;
      status: 'on_track' | 'behind' | 'ahead' | 'completed';
      monthlyContribution: Money;
    })
  | (GoalStatusBase & {
      progressAvailability: "unavailable";
      /** Null for a pay-down goal: its target is the hidden debt balance. */
      target: Money | null;
      current: null;
      status: null;
      monthlyContribution: null;
    });

interface GoalAssignmentBase {
  goalId: string;
  goalName: string;
  /** Null for a pay-down goal whose progress is unavailable: its target is the hidden debt balance. */
  target: Money | null;
}

export type GoalAssignmentResult =
  | (GoalAssignmentBase & {
      progressAvailability?: "available";
      accountId: string | null;
      accountName: string | null;
      current: Money;
    })
  | (GoalAssignmentBase & {
      progressAvailability: "unavailable";
      accountId: null;
      accountName: null;
      current: null;
    });

export interface UpcomingRecurringResult {
  ruleId: string;
  description: string;
  amount: Money;
  nextDate: string;
  frequency: string;
  category: string | null;
}

export interface BudgetStatusResult {
  categoryId: string;
  categoryName: string;
  budgeted: Money;
  spent: Money;
  remaining: Money;
  percentUsed: number;
  status: 'under_budget' | 'near_limit' | 'over_budget';
}

export interface TopMerchantResult {
  merchantId: string;
  merchantName: string;
  totalSpent: Money | null;
  transactionCount: number;
  avgTransactionAmount: Money | null;
  /** Set on every returned row if any eligible merchant cannot be valued. */
  rankingAvailability?: "unavailable";
}

export interface CategoryTrendResult {
  categoryId: string;
  categoryName: string;
  points: Array<{ month: string; amount: Money | null }>;
  trendDirection: "up" | "down" | "flat" | "unavailable";
}

export interface MonthlyTrendResult {
  month: string; // YYYY-MM format
  income: Money | null;
  expenses: Money | null;
  netSavings: Money | null;
  savingsRate: number | null; // Percentage
}

export interface RecentTransactionResult {
  transactionId: string;
  date: string;
  description: string;
  amount: Money;
  category: string | null;
  merchant: string | null;
}

export interface AccountBalanceResult {
  accountId: string;
  accountName: string;
  accountType: string;
  /** In the account's own currency (`currency`), not the household's. */
  balance: Money;
  currency: string;
  isActive: boolean;
}

// ============================================================================
// CONTEXT & INTERNAL TYPES
// ============================================================================

export interface QueryContext {
  userId: string;
  householdId: string;
  currency: string;
  ipAddress?: string;
  /** Resolved signed caller. Source-scoped financial readers fail closed without it. */
  actor?: HouseholdContext;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /**
   * Whether the tool's result was routed through the PII sanitizer (SCP-313).
   * Drives the honest `data_sanitized` value in the audit log. A successful
   * tool whose data reaches the external prompt must have `sanitized: true`.
   */
  sanitized?: boolean;
}

// ============================================================================
// DATA SANITIZATION (AI-DATA-001 FIX)
// ============================================================================

/**
 * Sanitized data sent to external AI API.
 * PII removed or masked to minimize data exposure.
 */
export interface SanitizedSpendingData {
  categories: Array<{
    name: string; // Category label, filtered again when the provider prompt is built
    amount: string | null; // Null is unavailable, never a partial category total.
    count: number;
  }>;
  total: string | null;
  period: string;
  rankingAvailability?: "unavailable";
}

export interface SanitizedGoalData {
  goals: Array<{
    name: string; // Goal name (sanitized)
    targetAmount: string | null;
    currentAmount: string | null;
    progressPercent: number | null;
    status: string | null;
    progressAvailability: "available" | "unavailable";
  }>;
}

export interface SanitizedTransactionData {
  transactions: Array<{
    date: string;
    description: string; // Merchant name only, no personal notes
    amount: string;
    category: string | null;
  }>;
}

export interface SanitizedRecurringData {
  recurring: Array<{
    description: string; // Sanitized rule name, no internal ruleId
    amount: string;
    nextDate: string;
    frequency: string;
    category: string | null;
  }>;
}

export interface SanitizedBudgetData {
  budgets: Array<{
    categoryName: string; // No internal categoryId
    budgeted: string;
    spent: string;
    remaining: string;
    percentUsed: number;
    status: string;
  }>;
}

export interface SanitizedMerchantData {
  rankingAvailability?: "unavailable";
  merchants: Array<{
    name: string; // Masked merchant name, no internal merchantId
    totalSpent: string | null;
    transactionCount: number;
    avgAmount: string | null;
  }>;
}

export interface SanitizedAccountData {
  accounts: Array<{
    type: string;
    name: string; // Generic name, no internal accountId or raw account name
    balance: string;
    currency: string; // The account's own currency
    isActive: boolean;
  }>;
}

export interface SanitizedCategoryTrendData {
  trends: Array<{
    categoryName: string; // No internal categoryId
    points: Array<{ month: string; amount: string | null }>;
    trendDirection: string;
  }>;
}

export interface SanitizedMonthlySummaryData {
  month: string;
  income: string | null;
  expenses: string | null;
  netSavings: string | null;
  savingsRate: number | null;
}

export interface SanitizedGoalAssignmentData {
  assignments: Array<{
    goalName: string; // Sanitized, no internal goalId
    accountName: string | null; // Generalized, no internal accountId
    target: string | null;
    current: string | null;
    progressAvailability: "available" | "unavailable";
  }>;
}

export interface SanitizedCashFlowData {
  projections: Array<{
    month: string;
    /** Null when a total depends on a missing conversion. */
    inflow: string | null;
    outflow: string | null;
    net: string | null;
    projectedEndingBalance: string | null;
  }>;
}

/**
 * Result of routing a tool's raw output through the central sanitizer.
 * `sanitized` reflects whether a real sanitizer ran for the given tool.
 */
export interface SanitizedToolOutput {
  data: unknown;
  sanitized: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export enum AIErrorCode {
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  INVALID_INPUT = 'INVALID_INPUT',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  QUERY_FAILED = 'QUERY_FAILED',
  CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
}

export interface AIErrorDetails {
  code: AIErrorCode;
  message: string;
  retryable: boolean;
  retryAfter?: number;
}
