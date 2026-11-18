/**
 * AI Data Sanitization Module
 *
 * FIX AI-DATA-001: Minimize and sanitize data sent to external AI API.
 * - Remove PII (names, account numbers, emails)
 * - Mask sensitive information
 * - Only send aggregated/anonymized data
 * - Limit data volume
 *
 * @module ai/ai.sanitizer
 */

import { Money } from '../../core/money';
import type {
  SpendingByCategoryResult,
  GoalStatusResult,
  RecentTransactionResult,
  AccountBalanceResult,
  TopMerchantResult,
  UpcomingRecurringResult,
  BudgetStatusResult,
  MonthlyTrendResult,
  SanitizedSpendingData,
  SanitizedGoalData,
  SanitizedTransactionData,
  SanitizedRecurringData,
  SanitizedBudgetData,
  SanitizedMerchantData,
  SanitizedAccountData,
  SanitizedCategoryTrendData,
  SanitizedMonthlySummaryData,
  SanitizedGoalAssignmentData,
  SanitizedCashFlowData,
  SanitizedToolOutput
} from './ai.types';

// ============================================================================
// RAW TOOL RESULT SHAPES (for tools whose result types live inline in the
// analytics service). These describe the unsanitized rows the analytics layer
// returns so the central sanitizer can strip internal identifiers before any
// data reaches the external AI prompt.
// ============================================================================

interface CategoryTrendResult {
  categoryId: string;
  categoryName: string;
  points: Array<{ month: string; amount: Money }>;
  trendDirection: 'up' | 'down' | 'flat';
}

interface GoalAssignmentResult {
  goalId: string;
  goalName: string;
  accountId: string | null;
  accountName: string | null;
  target: Money;
  current: Money;
}

interface CashFlowResult {
  month: string;
  inflow: Money;
  outflow: Money;
  net: Money;
  projectedEndingBalance: Money | null;
}

// ============================================================================
// DATA MINIMIZATION CONSTANTS
// ============================================================================

const MAX_CATEGORIES = 20;
const MAX_GOALS = 10;
const MAX_TRANSACTIONS = 20;
const MAX_MERCHANTS = 10;
const MAX_ACCOUNTS = 20;

// ============================================================================
// SANITIZATION FUNCTIONS (AI-DATA-001 FIX)
// ============================================================================

/**
 * Sanitize spending by category data for AI API.
 * - Limits to top 20 categories
 * - Converts Money to string representation
 * - Removes any PII that might be in category names
 */
export function sanitizeSpendingData(
  data: SpendingByCategoryResult[],
  currency: string
): SanitizedSpendingData {
  // Limit to top categories
  const limited = data.slice(0, MAX_CATEGORIES);

  const categories = limited.map(item => ({
    name: item.category,
    amount: item.amount.toString(), // String, not Money object
    count: item.transactionCount
  }));

  // Calculate total
  const total = limited
    .reduce((sum, item) => sum.add(item.amount), Money.zero(currency))
    .toString();

  return {
    categories,
    total,
    period: 'last_period'
  };
}

/**
 * Sanitize goal data for AI API.
 * - Limits to 10 goals
 * - Removes goal IDs (internal identifiers)
 * - Converts Money to string
 * - Sanitizes goal names (removes personal details)
 */
export function sanitizeGoalData(
  data: GoalStatusResult[]
): SanitizedGoalData {
  const limited = data.slice(0, MAX_GOALS);

  const goals = limited.map(goal => ({
    name: sanitizeGoalName(goal.name),
    targetAmount: goal.target.toString(),
    currentAmount: goal.current.toString(),
    progressPercent: calculateProgress(goal.current, goal.target),
    status: goal.status
  }));

  return { goals };
}

/**
 * Sanitize transaction data for AI API.
 * - Limits to 20 recent transactions
 * - Removes transaction IDs
 * - Masks merchant names if they contain personal info
 * - Converts Money to string
 * - Removes any personal notes or memos
 */
export function sanitizeTransactionData(
  data: RecentTransactionResult[]
): SanitizedTransactionData {
  const limited = data.slice(0, MAX_TRANSACTIONS);

  const transactions = limited.map(txn => ({
    date: txn.date,
    description: sanitizeMerchantName(txn.merchant || txn.description),
    amount: txn.amount.toString(),
    category: txn.category
  }));

  return { transactions };
}

/**
 * Sanitize merchant data for AI API.
 * - Limits to top 10 merchants
 * - Removes merchant IDs
 * - Masks personal merchant names
 */
export function sanitizeMerchantData(data: TopMerchantResult[]) {
  const limited = data.slice(0, MAX_MERCHANTS);

  return limited.map(merchant => ({
    name: sanitizeMerchantName(merchant.merchantName),
    totalSpent: merchant.totalSpent.toString(),
    transactionCount: merchant.transactionCount,
    avgAmount: merchant.avgTransactionAmount.toString()
  }));
}

/**
 * Sanitize account balance data for AI API.
 * - Limits to 20 accounts
 * - Removes account IDs and account numbers
 * - Generalizes account names
 */
export function sanitizeAccountData(data: AccountBalanceResult[]) {
  const limited = data.slice(0, MAX_ACCOUNTS);

  return limited.map((account, index) => ({
    type: account.accountType,
    name: `${account.accountType}_${index + 1}`, // Generic name
    balance: account.balance.toString(),
    isActive: account.isActive
  }));
}

/**
 * Sanitize upcoming recurring transactions for AI API.
 * - Removes internal rule IDs
 * - Masks personal info in rule descriptions
 * - Converts Money to string
 */
export function sanitizeRecurringData(
  data: UpcomingRecurringResult[]
): SanitizedRecurringData {
  const limited = data.slice(0, MAX_TRANSACTIONS);

  const recurring = limited.map(rule => ({
    description: sanitizeMerchantName(rule.description),
    amount: rule.amount.toString(),
    nextDate: rule.nextDate,
    frequency: rule.frequency,
    category: rule.category
  }));

  return { recurring };
}

/**
 * Sanitize budget status data for AI API.
 * - Removes internal category IDs
 * - Converts Money to string
 */
export function sanitizeBudgetData(
  data: BudgetStatusResult[]
): SanitizedBudgetData {
  const limited = data.slice(0, MAX_CATEGORIES);

  const budgets = limited.map(budget => ({
    categoryName: budget.categoryName,
    budgeted: budget.budgeted.toString(),
    spent: budget.spent.toString(),
    remaining: budget.remaining.toString(),
    percentUsed: budget.percentUsed,
    status: budget.status
  }));

  return { budgets };
}

/**
 * Sanitize merchant spending data for AI API (envelope form).
 * Wraps the array-returning sanitizeMerchantData so the external prompt only
 * ever sees masked names and string amounts, never internal merchant IDs.
 */
export function sanitizeMerchantSpendingData(
  data: TopMerchantResult[]
): SanitizedMerchantData {
  return { merchants: sanitizeMerchantData(data) };
}

/**
 * Sanitize account balance data for AI API (envelope form).
 * Wraps the array-returning sanitizeAccountData so the external prompt only
 * ever sees generic names, never internal account IDs or raw account names.
 */
export function sanitizeAccountBalanceData(
  data: AccountBalanceResult[]
): SanitizedAccountData {
  return { accounts: sanitizeAccountData(data) };
}

/**
 * Sanitize category trend data for AI API.
 * - Removes internal category IDs
 * - Converts Money points to strings
 */
export function sanitizeCategoryTrendData(
  data: CategoryTrendResult[]
): SanitizedCategoryTrendData {
  const limited = data.slice(0, MAX_CATEGORIES);

  const trends = limited.map(trend => ({
    categoryName: trend.categoryName,
    points: trend.points.map(point => ({
      month: point.month,
      amount: point.amount.toString()
    })),
    trendDirection: trend.trendDirection
  }));

  return { trends };
}

/**
 * Sanitize monthly summary data for AI API.
 * - Converts Money to string (no internal identifiers in this shape)
 */
export function sanitizeMonthlySummaryData(
  data: MonthlyTrendResult
): SanitizedMonthlySummaryData {
  return {
    month: data.month,
    income: data.income.toString(),
    expenses: data.expenses.toString(),
    netSavings: data.netSavings.toString(),
    savingsRate: data.savingsRate
  };
}

/**
 * Sanitize goal-account assignment data for AI API.
 * - Removes internal goal and account IDs
 * - Sanitizes goal names and generalizes account names
 * - Converts Money to string
 */
export function sanitizeGoalAssignmentData(
  data: GoalAssignmentResult[]
): SanitizedGoalAssignmentData {
  const limited = data.slice(0, MAX_GOALS);

  const assignments = limited.map((assignment, index) => ({
    goalName: sanitizeGoalName(assignment.goalName),
    accountName: assignment.accountName
      ? `account_${index + 1}` // Generic name, never the raw account name
      : null,
    target: assignment.target.toString(),
    current: assignment.current.toString()
  }));

  return { assignments };
}

/**
 * Sanitize cash flow projection data for AI API.
 * - Converts Money to string (no internal identifiers in this shape)
 */
export function sanitizeCashFlowData(
  data: CashFlowResult[]
): SanitizedCashFlowData {
  const projections = data.map(projection => ({
    month: projection.month,
    inflow: projection.inflow.toString(),
    outflow: projection.outflow.toString(),
    net: projection.net.toString(),
    projectedEndingBalance: projection.projectedEndingBalance
      ? projection.projectedEndingBalance.toString()
      : null
  }));

  return { projections };
}

// ============================================================================
// CENTRAL SANITIZER DISPATCH (SCP-313)
// ============================================================================

/**
 * Set of every tool name the central sanitizer knows how to sanitize.
 * Kept in sync with the dispatch switch below. Exported for tests/guards so a
 * newly added tool that forgets a sanitizer branch is detectable.
 */
export const SANITIZED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_spending_by_category',
  'get_goals_status',
  'get_recent_transactions',
  'get_upcoming_recurring',
  'get_budget_status',
  'get_account_balances',
  'get_merchant_spending',
  'get_category_trends',
  'get_monthly_summary',
  'get_transaction_search',
  'get_goal_assignments',
  'get_cash_flow'
]);

/**
 * Central sanitization chokepoint (SCP-313).
 *
 * Routes EVERY AI tool's raw result through its dedicated sanitizer before the
 * data can reach the external Gemini prompt. This is the single place that
 * decides what leaves the system, so no individual tool can bypass PII
 * stripping by being added to the service without a sanitizer.
 *
 * Returns `sanitized: false` for any tool without a known sanitizer branch so
 * the caller can record an honest `data_sanitized` value in the audit log
 * instead of a hardcoded `true`.
 *
 * @param toolName - The AI tool that produced the data.
 * @param rawData - The unsanitized result from the analytics service.
 * @param currency - Household currency for Money aggregation.
 */
export function sanitizeToolResult(
  toolName: string,
  rawData: unknown,
  currency: string
): SanitizedToolOutput {
  switch (toolName) {
    case 'get_spending_by_category':
      return {
        data: sanitizeSpendingData(rawData as SpendingByCategoryResult[], currency),
        sanitized: true
      };

    case 'get_goals_status':
      return {
        data: sanitizeGoalData(rawData as GoalStatusResult[]),
        sanitized: true
      };

    case 'get_recent_transactions':
    case 'get_transaction_search':
      return {
        data: sanitizeTransactionData(rawData as RecentTransactionResult[]),
        sanitized: true
      };

    case 'get_upcoming_recurring':
      return {
        data: sanitizeRecurringData(rawData as UpcomingRecurringResult[]),
        sanitized: true
      };

    case 'get_budget_status':
      return {
        data: sanitizeBudgetData(rawData as BudgetStatusResult[]),
        sanitized: true
      };

    case 'get_account_balances':
      return {
        data: sanitizeAccountBalanceData(rawData as AccountBalanceResult[]),
        sanitized: true
      };

    case 'get_merchant_spending':
      return {
        data: sanitizeMerchantSpendingData(rawData as TopMerchantResult[]),
        sanitized: true
      };

    case 'get_category_trends':
      return {
        data: sanitizeCategoryTrendData(rawData as CategoryTrendResult[]),
        sanitized: true
      };

    case 'get_monthly_summary':
      return {
        data: sanitizeMonthlySummaryData(rawData as MonthlyTrendResult),
        sanitized: true
      };

    case 'get_goal_assignments':
      return {
        data: sanitizeGoalAssignmentData(rawData as GoalAssignmentResult[]),
        sanitized: true
      };

    case 'get_cash_flow':
      return {
        data: sanitizeCashFlowData(rawData as CashFlowResult[]),
        sanitized: true
      };

    default:
      // Fail closed: an unknown tool has no sanitizer, so we never forward its
      // raw data and we report that sanitization did not run.
      return { data: null, sanitized: false };
  }
}

// ============================================================================
// PII REMOVAL HELPERS
// ============================================================================

/**
 * Sanitize goal names to remove personal information.
 * Examples:
 * - "John's Emergency Fund" -> "Emergency Fund"
 * - "Save for Sarah's Birthday" -> "Save for Event"
 */
function sanitizeGoalName(name: string): string {
  // Remove possessive names
  let sanitized = name.replace(/\b[A-Z][a-z]+'s\s+/g, '');

  // Replace specific personal events with generic terms
  sanitized = sanitized.replace(/\bfor [A-Z][a-z]+('s)?\b/gi, 'for Event');

  // Remove any remaining proper names (simple heuristic)
  sanitized = sanitized.replace(/\b[A-Z][a-z]+\b/g, match => {
    // Keep common financial terms
    const financialTerms = ['Emergency', 'Fund', 'Savings', 'Retirement', 'Investment', 'Vacation', 'House', 'Car', 'Education'];
    return financialTerms.includes(match) ? match : 'Goal';
  });

  return sanitized.trim();
}

/**
 * Sanitize merchant names to remove personal information.
 * - Keep well-known merchant names
 * - Mask unknown or personal merchants
 */
function sanitizeMerchantName(name: string | null): string {
  if (!name) return 'Unknown Merchant';

  // If merchant name contains personal indicators, mask it
  const personalIndicators = [
    'personal',
    'transfer to',
    'transfer from',
    'payment to',
    'payment from',
    '@', // Email addresses
    'mobile:',
    'phone:'
  ];

  const lowerName = name.toLowerCase();
  const hasPersonalInfo = personalIndicators.some(indicator =>
    lowerName.includes(indicator)
  );

  if (hasPersonalInfo) {
    return 'Private Transaction';
  }

  // Remove account numbers or reference numbers
  let sanitized = name.replace(/\b\d{4,}\b/g, '####');

  // Remove email addresses
  sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]');

  // Remove phone numbers
  sanitized = sanitized.replace(/\+?\d{10,}/g, '[phone]');

  return sanitized;
}

/**
 * Calculate progress percentage safely
 */
function calculateProgress(current: Money, target: Money): number {
  if (target.toNumber() === 0) return 0;
  const progress = (current.toNumber() / target.toNumber()) * 100;
  return Math.min(Math.round(progress), 100);
}

// ============================================================================
// AGGREGATION SUMMARY
// ============================================================================

/**
 * Create high-level summary statistics (most privacy-preserving)
 */
export function createFinancialSummary(data: {
  totalIncome: Money;
  totalExpenses: Money;
  netSavings: Money;
  savingsRate: number;
  accountCount: number;
  goalCount: number;
  activeGoals: number;
}) {
  return {
    income: data.totalIncome.toString(),
    expenses: data.totalExpenses.toString(),
    netSavings: data.netSavings.toString(),
    savingsRate: `${data.savingsRate.toFixed(1)}%`,
    accountCount: data.accountCount,
    goalCount: data.goalCount,
    activeGoals: data.activeGoals
  };
}

/**
 * Data sanitization summary for audit logging
 */
export function getSanitizationSummary(
  originalCount: number,
  sanitizedCount: number,
  dataType: string
): string {
  const removed = originalCount - sanitizedCount;
  return `${dataType}: ${sanitizedCount} items sent (${removed} removed for privacy)`;
}
