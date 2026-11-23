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
  GoalAssignmentResult,
  RecentTransactionResult,
  AccountBalanceResult,
  TopMerchantResult,
  UpcomingRecurringResult,
  BudgetStatusResult,
  MonthlyTrendResult,
  CategoryTrendResult,
  SanitizedSpendingData,
  SanitizedTransactionData,
  SanitizedRecurringData,
  SanitizedBudgetData,
  SanitizedMerchantData,
  SanitizedAccountData,
  SanitizedCategoryTrendData,
  SanitizedMonthlySummaryData,
  SanitizedCashFlowData,
  SanitizedToolOutput
} from './ai.types';
import { sanitizeGoalAssignmentData, sanitizeGoalData } from './ai.goal-sanitizer';
import type { CashFlowPoint } from './ai.cashflow-projection';

export { sanitizeGoalAssignmentData, sanitizeGoalData };

// ============================================================================
// RAW TOOL RESULT SHAPES (for tools whose result types live inline in the
// analytics service). These describe the unsanitized rows the analytics layer
// returns so the central sanitizer can strip internal identifiers before any
// data reaches the external AI prompt.
// ============================================================================

// ============================================================================
// DATA MINIMIZATION CONSTANTS
// ============================================================================

const MAX_CATEGORIES = 20;
const MAX_TRANSACTIONS = 20;
const MAX_MERCHANTS = 10;
const MAX_ACCOUNTS = 20;

// ============================================================================
// SANITIZATION FUNCTIONS (AI-DATA-001 FIX)
// ============================================================================

/**
 * Sanitize spending by category data for AI API.
 * - Limits the category breakdown to 20 rows
 * - Converts Money to string representation
 * - Keeps category labels for local display; the provider prompt redacts identifiers
 */
export function sanitizeSpendingData(
  data: SpendingByCategoryResult[],
  currency: string
): SanitizedSpendingData {
  const limited = data.slice(0, MAX_CATEGORIES);

  const categories = limited.map(item => ({
    name: item.category,
    amount: item.amount?.toString() ?? null,
    count: item.transactionCount
  }));

  // Include every category, even beyond the display limit. A missing group
  // withholds the total rather than silently leaving its contribution out.
  const total = data.reduce<Money | null>(
    (sum, item) => sum && item.amount ? sum.add(item.amount) : null,
    Money.zero(currency),
  );

  return {
    categories,
    total: total?.toString() ?? null,
    period: 'last_period',
    ...(total === null ? { rankingAvailability: 'unavailable' as const } : {}),
  };
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
    totalSpent: merchant.totalSpent?.toString() ?? null,
    transactionCount: merchant.transactionCount,
    avgAmount: merchant.avgTransactionAmount?.toString() ?? null
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
    name: accountLabel(account.accountType, index), // Generic name
    balance: account.balance.toString(),
    currency: account.currency,
    isActive: account.isActive
  }));
}

/** The generic label an account is sent out under: its type and position. */
function accountLabel(accountType: string, index: number): string {
  return `${accountType}_${index + 1}`;
}

/**
 * Each label `sanitizeAccountData` sends out, paired with the account name it
 * stands for (same limit, same order), so the asker's reply can name it.
 */
export function accountLabelPairs(data: AccountBalanceResult[]): Array<readonly [string, string]> {
  return data.slice(0, MAX_ACCOUNTS).map((account, index) => [accountLabel(account.accountType, index), account.accountName] as const);
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
  return {
    merchants: sanitizeMerchantData(data),
    ...(data.some(row => row.rankingAvailability === 'unavailable') ? { rankingAvailability: 'unavailable' as const } : {}),
  };
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
      amount: point.amount?.toString() ?? null
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
    income: data.income?.toString() ?? null,
    expenses: data.expenses?.toString() ?? null,
    netSavings: data.netSavings?.toString() ?? null,
    savingsRate: data.savingsRate
  };
}

/**
 * Sanitize cash flow projection data for AI API.
 * - Converts Money to string (no internal identifiers in this shape)
 */
export function sanitizeCashFlowData(
  data: CashFlowPoint[]
): SanitizedCashFlowData {
  const projections = data.map(projection => ({
    month: projection.month,
    inflow: projection.inflow?.toString() ?? null,
    outflow: projection.outflow?.toString() ?? null,
    net: projection.net?.toString() ?? null,
    projectedEndingBalance: projection.projectedEndingBalance?.toString() ?? null,
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
 * Routes every AI tool's raw result through its dedicated sanitizer before
 * local display or provider prompt serialization. The provider prompt also
 * redacts identifiers in the remaining free-text labels.
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
        data: sanitizeCashFlowData(rawData as CashFlowPoint[]),
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
