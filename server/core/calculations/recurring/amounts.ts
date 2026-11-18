/**
 * Calculation Engine - Recurring Amounts
 *
 * Logic for calculating average costs and totals for recurring rules.
 */

import { Money, toMoney } from "../types";
import { Frequency, IntervalUnit } from "./types";
import { roundToDecimals } from "../helpers";

/**
 * Calculates the monthly average cost/income for a recurring rule.
 * Useful for budgeting and cashflow forecasting.
 *
 * @param amount - Amount per occurrence
 * @param frequency - Recurrence frequency
 * @param intervalValue - Value for custom interval
 * @param intervalUnit - Unit for custom interval
 * @returns Monthly equivalent amount
 */
export function calculateMonthlyAverage(
  amount: Money,
  frequency: Frequency,
  intervalValue?: number | null,
  intervalUnit?: IntervalUnit | null
): Money {
  let monthlyAmount: number;

  switch (frequency) {
    case "daily":
      monthlyAmount = amount * 30;
      break;
    case "weekly":
      monthlyAmount = amount * 4.33;
      break;
    case "biweekly":
      monthlyAmount = amount * 2.17;
      break;
    case "monthly":
      monthlyAmount = amount;
      break;
    case "quarterly":
      monthlyAmount = amount / 3;
      break;
    case "semi_annually":
      monthlyAmount = amount / 6;
      break;
    case "yearly":
    case "annually":
      monthlyAmount = amount / 12;
      break;
    case "custom": {
      const value = Math.max(intervalValue ?? 1, 1);
      switch (intervalUnit) {
        case "days":
          monthlyAmount = amount * (30 / value);
          break;
        case "weeks":
          monthlyAmount = amount * (4.33 / value);
          break;
        case "months":
          monthlyAmount = amount / value;
          break;
        case "years":
          monthlyAmount = amount / (12 * value);
          break;
        default:
          monthlyAmount = amount;
      }
      break;
    }
    default:
      monthlyAmount = amount;
  }

  return toMoney(roundToDecimals(monthlyAmount, 2));
}
