/**
 * Calculation Engine - Income Allocation Calculation
 *
 * Calculates how income is allocated across expense categories.
 *
 * @module core/calculations/cashflow/incomeAllocation
 */

import { Money, Percentage, toPercentage, toMoney } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Income allocation result for a single category.
 */
export interface AllocationItem {
  /** Category identifier */
  categoryId: string;
  /** Category name */
  categoryName: string;
  /** Amount spent in this category */
  amount: Money;
  /** Percentage of income allocated to this category */
  percentage: Percentage;
}

/**
 * Complete income allocation breakdown.
 */
export interface IncomeAllocation {
  /** Total income */
  totalIncome: Money;
  /** Total expenses */
  totalExpenses: Money;
  /** Net savings (income - expenses) */
  netSavings: Money;
  /** Savings rate as percentage */
  savingsRate: Percentage;
  /** Breakdown by category */
  categories: AllocationItem[];
}

/**
 * Expense category with amount.
 */
export interface ExpenseCategory {
  categoryId: string;
  categoryName: string;
  amount: number;
}

/**
 * Calculates how income is allocated across expense categories.
 *
 * @param income - Total income
 * @param categories - Array of expense categories with amounts
 * @returns Complete income allocation breakdown
 *
 * @example
 * ```ts
 * const allocation = calculateIncomeAllocation(toMoney(5000), [
 *   { categoryId: '1', categoryName: 'Housing', amount: 1500 },
 *   { categoryId: '2', categoryName: 'Food', amount: 600 },
 *   { categoryId: '3', categoryName: 'Transport', amount: 400 },
 * ]);
 * ```
 */
export function calculateIncomeAllocation(
  income: Money,
  categories: ExpenseCategory[]
): IncomeAllocation {
  const totalExpenses = categories.reduce((sum, cat) => sum + cat.amount, 0);
  const netSavings = income - totalExpenses;

  const savingsRate =
    income > 0 ? roundToDecimals((netSavings / income) * 100, 2) : 0;

  const categoryAllocations: AllocationItem[] = categories.map((cat) => ({
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    amount: toMoney(cat.amount),
    percentage: toPercentage(
      income > 0 ? roundToDecimals((cat.amount / income) * 100, 2) : 0
    ),
  }));

  return {
    totalIncome: income,
    totalExpenses: toMoney(totalExpenses),
    netSavings: toMoney(netSavings),
    savingsRate: toPercentage(savingsRate),
    categories: categoryAllocations,
  };
}
