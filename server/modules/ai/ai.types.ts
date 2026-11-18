/**
 * AI Module Type Definitions
 *
 * Strict TypeScript types for AI assistant functionality.
 * NO `any` types allowed per CLAUDE.md standards.
 *
 * @module ai/ai.types
 */

import { Money } from "../../core/money";

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

// ChatRequest is exported from ai.validation.ts (Zod-validated type)

export interface ChatResponse {
  reply: string;
  conversationId: string;
  toolsUsed: string[];
  tokenCount: number;
  remainingQueries: number;
  provenance?: ResponseProvenance;
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
  amount: Money;
  transactionCount: number;
  percentOfTotal: number;
}

export interface GoalStatusResult {
  goalId: string;
  name: string;
  target: Money;
  current: Money;
  status: 'on_track' | 'behind' | 'ahead' | 'completed';
  projectedCompletion: string | null;
  monthlyContribution: Money;
}

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
  totalSpent: Money;
  transactionCount: number;
  avgTransactionAmount: Money;
}

export interface MonthlyTrendResult {
  month: string; // YYYY-MM format
  income: Money;
  expenses: Money;
  netSavings: Money;
  savingsRate: number; // Percentage
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
  balance: Money;
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
    name: string; // Category name (not PII)
    amount: string; // String representation, not raw Money object
    count: number;
  }>;
  total: string;
  period: string;
}

export interface SanitizedGoalData {
  goals: Array<{
    name: string; // Goal name (sanitized)
    targetAmount: string;
    currentAmount: string;
    progressPercent: number;
    status: string;
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
  merchants: Array<{
    name: string; // Masked merchant name, no internal merchantId
    totalSpent: string;
    transactionCount: number;
    avgAmount: string;
  }>;
}

export interface SanitizedAccountData {
  accounts: Array<{
    type: string;
    name: string; // Generic name, no internal accountId or raw account name
    balance: string;
    isActive: boolean;
  }>;
}

export interface SanitizedCategoryTrendData {
  trends: Array<{
    categoryName: string; // No internal categoryId
    points: Array<{ month: string; amount: string }>;
    trendDirection: string;
  }>;
}

export interface SanitizedMonthlySummaryData {
  month: string;
  income: string;
  expenses: string;
  netSavings: string;
  savingsRate: number;
}

export interface SanitizedGoalAssignmentData {
  assignments: Array<{
    goalName: string; // Sanitized, no internal goalId
    accountName: string | null; // Generalized, no internal accountId
    target: string;
    current: string;
  }>;
}

export interface SanitizedCashFlowData {
  projections: Array<{
    month: string;
    inflow: string;
    outflow: string;
    net: string;
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
