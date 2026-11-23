/**
 * Goal forecasts in Money and calendar months (NEW-15).
 *
 * `today` is the household's calendar date ("YYYY-MM-DD", from
 * householdToday), never the server's UTC day. A month is a calendar month
 * (31 Jan + 1 month = 28 Feb, or 29 Feb in a leap year), never 30 days.
 *
 * @module services/goal/goalForecast
 */
import Decimal from "decimal.js";
import { Money } from "../../core/money";
import { addCalendarMonths, wholeCalendarMonthsBetween } from "./goalCalendarDays";

const CENTS = 2;

/**
 * The monthly amount that reaches the target by `targetDate`: what remains,
 * spread over the whole calendar months left (at least one), rounded up to
 * the cent so that paying it every month does reach the target.
 */
export function requiredMonthlyContribution(remaining: Money, today: string, targetDate: string): Money {
  const months = Math.max(1, wholeCalendarMonthsBetween(today, targetDate));
  return new Money(remaining.amount.div(months).toDecimalPlaces(CENTS, Decimal.ROUND_UP), remaining.currency);
}

/**
 * The date the goal completes at `monthly` a month: today plus the calendar
 * months the remaining amount needs (a part month counts as a whole one).
 * Null when nothing is being added.
 */
export function projectedCompletionDate(remaining: Money, monthly: Money, today: string): string | null {
  if (remaining.isNegativeOrZero()) return today;
  if (monthly.isNegativeOrZero()) return null;
  const months = remaining.amount.div(monthly.amount).ceil();
  return addCalendarMonths(today, months.toNumber());
}
