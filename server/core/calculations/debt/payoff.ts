/**
 * Calculation Engine - Debt Payoff Calculations
 *
 * Calculates debt payoff schedules using various strategies.
 *
 * @module core/calculations/debt/payoff
 */

import { Money, toMoney } from "../types";
import { roundToDecimals, preciseMultiply, preciseDivide } from "../helpers";

/**
 * Debt information for payoff calculation.
 */
export interface DebtInfo {
  /** Debt identifier */
  id: string;
  /** Debt name */
  name: string;
  /** Current balance */
  balance: number;
  /** Annual percentage rate (APR) */
  apr: number;
  /** Minimum monthly payment */
  minimumPayment: number;
}

/**
 * Monthly payment in payoff schedule.
 */
export interface PayoffPayment {
  month: number;
  payment: Money;
  principal: Money;
  interest: Money;
  remainingBalance: Money;
}

/**
 * Payoff result for a single debt.
 */
export interface DebtPayoffResult {
  debtId: string;
  debtName: string;
  originalBalance: Money;
  totalInterest: Money;
  totalPayments: Money;
  monthsToPayoff: number;
  schedule: PayoffPayment[];
}

/**
 * Payoff strategy type.
 */
export type PayoffStrategy = "avalanche" | "snowball" | "minimum";

/**
 * Calculates debt payoff schedule for a single debt.
 *
 * @param debt - Debt information
 * @param monthlyPayment - Monthly payment amount (must be >= minimum)
 * @param maxMonths - Maximum months to calculate (default 360 = 30 years)
 * @returns Payoff result with schedule
 */
export function calculateDebtPayoff(
  debt: DebtInfo,
  monthlyPayment: number,
  maxMonths: number = 360
): DebtPayoffResult {
  const payment = Math.max(monthlyPayment, debt.minimumPayment);
  const monthlyRate = preciseDivide(debt.apr, 100 * 12);

  let balance = debt.balance;
  let totalInterest = 0;
  let totalPayments = 0;
  const schedule: PayoffPayment[] = [];
  let month = 0;

  while (balance > 0.01 && month < maxMonths) {
    month++;

    // Calculate interest for this month
    const interest = roundToDecimals(preciseMultiply(balance, monthlyRate), 2);

    // Apply payment
    const actualPayment = Math.min(payment, balance + interest);
    const principal = roundToDecimals(actualPayment - interest, 2);

    balance = roundToDecimals(balance - principal, 2);
    totalInterest += interest;
    totalPayments += actualPayment;

    schedule.push({
      month,
      payment: toMoney(actualPayment),
      principal: toMoney(principal),
      interest: toMoney(interest),
      remainingBalance: toMoney(Math.max(0, balance)),
    });
  }

  return {
    debtId: debt.id,
    debtName: debt.name,
    originalBalance: toMoney(debt.balance),
    totalInterest: toMoney(roundToDecimals(totalInterest, 2)),
    totalPayments: toMoney(roundToDecimals(totalPayments, 2)),
    monthsToPayoff: month,
    schedule,
  };
}

/**
 * Sorts debts by payoff strategy.
 *
 * - Avalanche: Highest APR first (saves most money)
 * - Snowball: Lowest balance first (psychological wins)
 *
 * @param debts - Array of debts
 * @param strategy - Payoff strategy
 * @returns Sorted debts
 */
export function sortDebtsByStrategy(
  debts: DebtInfo[],
  strategy: PayoffStrategy
): DebtInfo[] {
  const sorted = [...debts];

  switch (strategy) {
    case "avalanche":
      // Highest APR first
      sorted.sort((a, b) => b.apr - a.apr);
      break;
    case "snowball":
      // Lowest balance first
      sorted.sort((a, b) => a.balance - b.balance);
      break;
    case "minimum":
      // No sorting, pay minimums only
      break;
  }

  return sorted;
}

/**
 * Calculates monthly interest for a debt.
 *
 * @formula interest = balance * (apr / 100 / 12)
 *
 * @param balance - Current balance
 * @param apr - Annual percentage rate
 * @returns Monthly interest amount
 */
export function calculateMonthlyInterest(balance: Money, apr: number): Money {
  const monthlyRate = preciseDivide(apr, 100 * 12);
  const interest = preciseMultiply(balance, monthlyRate);
  return toMoney(roundToDecimals(interest, 2));
}
