/**
 * Cashflow Forecast Calculation Module
 *
 * Generates projected income and expenses for future periods based on:
 * 1. Active recurring rules (primary source)
 * 2. Budget allocations (where recurring not available)
 * 3. Category averages (fallback for unbudgeted categories)
 *
 * @module core/calculations/cashflow/forecast
 */

import { Money } from "../../money";
import { readBudgetMoney } from "../../money/budget-denomination";
import { CalculationError } from "../errors";
import type { MoneyDto } from "@shared/money";
import type {
  Frequency,
  IntervalUnit,
} from "../recurring/types";

// ============================================================================
// Types
// ============================================================================

export interface ForecastConfig {
  horizonMonths: number;
  baseCurrency: string;
  startDate: string; // First forecast period start (YYYY-MM-DD)
}

export interface RecurringRuleInput {
  id: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  frequency: Frequency;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  nextDueDate: string;
  endDate?: string | null;
  isActive: boolean;
  isPaused: boolean;
}

export interface BudgetInput {
  categoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  periodType: "monthly" | "yearly";
  /** An explicit month overrides a recurring default only for that month. */
  targetPeriod?: string;
}

export interface CategoryAverageInput {
  categoryId: string;
  categoryName: string;
  type: "income" | "expense";
  monthlyAverage: string;
  currency: string;
  standardDeviation?: string; // For confidence interval calculation
  sampleSize?: number; // Number of months used for average
}

export interface ConfidenceInterval {
  low: Money;
  mid: Money;
  high: Money;
  confidenceLevel: number; // 0.90 for 90% confidence
}

export interface ForecastPoint {
  period: string; // YYYY-MM-DD (first day of month)
  periodLabel: string; // "Jan 2026"
  income: Money;
  expenses: Money;
  savings: Money;
  savingsRate: number;
  isForecast: true;
  sources: {
    recurringIncome: Money;
    recurringExpenses: Money;
    budgetedExpenses: Money;
    averageIncome: Money;
    averageExpenses: Money;
  };
  confidence?: {
    income: ConfidenceInterval;
    expenses: ConfidenceInterval;
    savings: ConfidenceInterval;
    level: "high" | "medium" | "low";
    reason: string;
  };
}

export interface ForecastResult {
  points: ForecastPoint[];
  dataSourcesUsed: ("recurring" | "budgets" | "averages")[];
  warnings: string[];
  confidenceMetadata?: {
    overallLevel: "high" | "medium" | "low";
    confidencePercent: number; // 90 for 90% confidence
    factors: {
      hasRecurringRules: boolean;
      hasBudgets: boolean;
      hasHistoricalData: boolean;
      sampleMonths: number;
    };
    description: string;
  };
}

// ============================================================================
// Core Forecast Logic
// ============================================================================

/**
 * Generate cashflow forecast for future months.
 *
 * @param config - Forecast configuration
 * @param recurringRules - Active recurring income/expense rules
 * @param budgets - Budget allocations by category
 * @param categoryAverages - Historical category averages (6-month lookback)
 * @returns Forecast points with source breakdown
 */
export function generateForecast(
  config: ForecastConfig,
  recurringRules: RecurringRuleInput[],
  budgets: BudgetInput[],
  categoryAverages: CategoryAverageInput[]
): ForecastResult {
  const { horizonMonths, baseCurrency, startDate } = config;
  const points: ForecastPoint[] = [];
  const warnings: string[] = [];
  const dataSourcesUsed = new Set<"recurring" | "budgets" | "averages">();

  // Filter active rules
  const activeRules = recurringRules.filter(
    (r) => r.isActive && !r.isPaused
  );

  // Separate by type
  const incomeRules = activeRules.filter((r) => r.type === "income");
  const expenseRules = activeRules.filter((r) => r.type === "expense");

  // Calculate monthly totals from recurring
  const recurringIncomeMonthly = incomeRules.reduce(
    (sum, rule) => sum.add(normalizeToMonthly(rule, baseCurrency)),
    Money.zero(baseCurrency)
  );

  const recurringExpensesMonthly = expenseRules.reduce(
    (sum, rule) => sum.add(normalizeToMonthly(rule, baseCurrency)),
    Money.zero(baseCurrency)
  );

  if (!recurringIncomeMonthly.isZero() || !recurringExpensesMonthly.isZero()) {
    dataSourcesUsed.add("recurring");
  }

  // Calculate average-based projections (fallback)
  const avgIncome = categoryAverages
    .filter((c) => c.type === "income")
    .reduce(
      (sum, c) => sum.add(new Money(c.monthlyAverage, baseCurrency)),
      Money.zero(baseCurrency)
    );

  const avgExpenses = categoryAverages
    .filter((c) => c.type === "expense")
    .reduce(
      (sum, c) => sum.add(new Money(c.monthlyAverage, baseCurrency)),
      Money.zero(baseCurrency)
    );

  if (!avgIncome.isZero() || !avgExpenses.isZero()) {
    dataSourcesUsed.add("averages");
  }

  // Determine final monthly projections using priority:
  // 1. Recurring rules (most reliable)
  // 2. Budgets (for expenses not covered by recurring)
  // 3. Averages (fallback)
  // Applied per month below, after each rule's end date (R14).

  // Add warnings if data sources are limited
  if (incomeRules.length === 0 && avgIncome.isZero()) {
    warnings.push("No recurring income or historical data available for income projection");
  }
  if (expenseRules.length === 0 && budgets.length === 0 && avgExpenses.isZero()) {
    warnings.push("No recurring expenses, budgets, or historical data available for expense projection");
  }

  // Generate forecast points for each month
  const start = new Date(startDate + "T00:00:00Z");

  for (let i = 0; i < horizonMonths; i++) {
    const periodDate = new Date(start);
    periodDate.setUTCMonth(start.getUTCMonth() + i);

    const periodStr = periodDate.toISOString().split("T")[0];
    const monthBudgets = new Map<string, BudgetInput>();
    for (const budget of budgets) if (!budget.targetPeriod) monthBudgets.set(budget.categoryId, budget);
    for (const budget of budgets) if (budget.targetPeriod === periodStr.slice(0, 7)) monthBudgets.set(budget.categoryId, budget);
    const budgetedExpensesMonthly = Array.from(monthBudgets.values()).reduce((sum, budget) =>
      sum.add(normalizeBudgetToMonthly(budget, baseCurrency)), Money.zero(baseCurrency));
    if (!budgetedExpensesMonthly.isZero()) dataSourcesUsed.add("budgets");
    // R14: a rule's inclusive end date drops it from every month that starts after it.
    // The source choice (recurring vs fallback) stays horizon-wide, so a month after
    // the last rule ends projects zero rather than re-adding history through averages.
    const periodIncome = recurringMonthlyFor(incomeRules, periodStr, baseCurrency);
    const periodRecurringExpenses = recurringMonthlyFor(expenseRules, periodStr, baseCurrency);
    const projectedIncome = !recurringIncomeMonthly.isZero() ? periodIncome : avgIncome;
    const projectedExpenses = !recurringExpensesMonthly.isZero() ? periodRecurringExpenses
      : monthBudgets.size > 0 ? budgetedExpensesMonthly : avgExpenses;
    const periodLabel = periodDate.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    const savings = projectedIncome.subtract(projectedExpenses);
    const savingsRate = projectedIncome.isZero()
      ? 0
      : Number(
          savings.divide(projectedIncome.toString()).multiply(100).toNumber().toFixed(2)
        );

    points.push({
      period: periodStr,
      periodLabel,
      income: projectedIncome,
      expenses: projectedExpenses,
      savings,
      savingsRate,
      isForecast: true,
      sources: {
        recurringIncome: periodIncome,
        recurringExpenses: periodRecurringExpenses,
        budgetedExpenses: budgetedExpensesMonthly,
        averageIncome: avgIncome,
        averageExpenses: avgExpenses,
      },
    });
  }

  return {
    points,
    dataSourcesUsed: Array.from(dataSourcesUsed),
    warnings,
  };
}

// ============================================================================
// Normalization Helpers
// ============================================================================

/** Last day (YYYY-MM-DD) of the month starting `periodStart`. */
function monthEnd(periodStart: string): string {
  const end = new Date(periodStart + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return end.toISOString().split("T")[0];
}

/**
 * Monthly recurring total for the month starting `periodStart`, counting only
 * rules already due by the end of that month (A-37) whose inclusive end date
 * is on or after its start (R14).
 */
function recurringMonthlyFor(rules: RecurringRuleInput[], periodStart: string, targetCurrency: string): Money {
  const periodEnd = monthEnd(periodStart);
  return rules
    .filter((rule) => rule.nextDueDate <= periodEnd && (!rule.endDate || rule.endDate >= periodStart))
    .reduce((sum, rule) => sum.add(normalizeToMonthly(rule, targetCurrency)), Money.zero(targetCurrency));
}

/**
 * Normalize a recurring rule amount to a monthly equivalent in its own unit.
 * A-10: the caller converts a rule into `targetCurrency` first; a rule still in
 * another unit is refused rather than relabelled.
 */
export function normalizeToMonthly(
  rule: RecurringRuleInput,
  targetCurrency: string
): Money {
  if (rule.currency !== targetCurrency) {
    throw new CalculationError("INVALID_CURRENCY", {
      functionName: "normalizeToMonthly", from: rule.currency, to: targetCurrency,
    });
  }
  const amount = new Money(rule.amount, rule.currency);

  switch (rule.frequency) {
    case "daily":
      return amount.multiply(30);
    case "weekly":
      return amount.multiply("4.33");
    case "biweekly":
      return amount.multiply("2.17");
    case "monthly":
      return amount;
    case "quarterly":
      return amount.divide(3);
    case "yearly":
    case "annually":
      return amount.divide(12);
    case "semi_annually":
      return amount.divide(6);
    case "custom": {
      const value = Math.max(rule.intervalValue ?? 1, 1);
      switch (rule.intervalUnit) {
        case "days":
          return amount.multiply(30).divide(value);
        case "weeks":
          return amount.multiply("4.33").divide(value);
        case "months":
          return amount.divide(value);
        case "years":
          return amount.divide(12 * value);
        default:
          return amount;
      }
    }
    default:
      return amount;
  }
}

/**
 * Normalize a budget amount to monthly.
 */
export function normalizeBudgetToMonthly(
  budget: BudgetInput,
  targetCurrency: string
): Money {
  const amount = readBudgetMoney(budget.amount, budget.currency, targetCurrency);

  switch (budget.periodType) {
    case "monthly":
      return amount;
    case "yearly":
      return amount.divide(12);
    default:
      return amount;
  }
}

/**
 * Calculate the first day of the next month from a given date.
 */
export function getNextMonthStart(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(1);
  return date.toISOString().split("T")[0];
}

/**
 * Convert forecast point to API response format.
 */
export function toForecastSeriesPoint(
  point: ForecastPoint,
  currency: string
): {
  periodStart: string;
  periodEnd: string;
  label: string;
  income: MoneyDto;
  expenses: MoneyDto;
  savings: MoneyDto;
  savingsRate: number;
  debt: MoneyDto;
  isForecast: true;
  confidence?: {
    income: { low: MoneyDto; mid: MoneyDto; high: MoneyDto };
    expenses: { low: MoneyDto; mid: MoneyDto; high: MoneyDto };
    savings: { low: MoneyDto; mid: MoneyDto; high: MoneyDto };
    level: "high" | "medium" | "low";
  };
} {
  // Calculate last day of the month
  const start = new Date(point.period + "T00:00:00Z");
  const endDate = new Date(start);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0); // Last day of current month

  const result: ReturnType<typeof toForecastSeriesPoint> = {
    periodStart: point.period,
    periodEnd: endDate.toISOString().split("T")[0],
    label: point.periodLabel,
    income: { amount: point.income.toString(), currency },
    expenses: { amount: point.expenses.toString(), currency },
    savings: { amount: point.savings.toString(), currency },
    savingsRate: point.savingsRate,
    debt: { amount: "0.00", currency }, // Forecast doesn't project debt separately
    isForecast: true,
  };

  // Add confidence intervals if available
  if (point.confidence) {
    result.confidence = {
      income: {
        low: { amount: point.confidence.income.low.toString(), currency },
        mid: { amount: point.confidence.income.mid.toString(), currency },
        high: { amount: point.confidence.income.high.toString(), currency },
      },
      expenses: {
        low: { amount: point.confidence.expenses.low.toString(), currency },
        mid: { amount: point.confidence.expenses.mid.toString(), currency },
        high: { amount: point.confidence.expenses.high.toString(), currency },
      },
      savings: {
        low: { amount: point.confidence.savings.low.toString(), currency },
        mid: { amount: point.confidence.savings.mid.toString(), currency },
        high: { amount: point.confidence.savings.high.toString(), currency },
      },
      level: point.confidence.level,
    };
  }

  return result;
}

// Re-export confidence interval logic from separate module for backwards compatibility
export {
  type HistoricalVarianceInput,
  calculateConfidenceInterval,
  determineConfidenceLevel,
  generateForecastWithConfidence,
} from "./forecastConfidence";
