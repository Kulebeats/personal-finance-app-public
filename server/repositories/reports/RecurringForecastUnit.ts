/**
 * A recurring rule's forecast amount in the report currency (Astra A-10).
 *
 * A rule's amount is in its proven unit (`verifiedCurrency`), not in whatever
 * the household currency is now. A rule in another unit is converted once, at
 * the report's dated rate for today: the household's own rate valid today,
 * else the latest shared rate (`resolvedFxRate`, as the report actuals use).
 * With no rate the forecast fails closed with MISSING_FX_RATE, never a rate
 * of 1. A rule with no proven unit keeps the household-unit assumption in this report.
 *
 * @module repositories/reports/RecurringForecastUnit
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { Money } from "../../core/money";
import { CalculationError } from "../../core/calculations/errors";
import type { VisibleRecurringRule } from "../../services/recurring/RecurringDenomination";
import { resolvedFxRate } from "./fxRateExpr";

type RateRow = { rate: string | null; onDate: string };

/** Only these rules reach a forecast total, so only their units need a rate. */
function isCounted(rule: VisibleRecurringRule): boolean {
  return rule.isActive && !rule.isPaused && (rule.type === "income" || rule.type === "expense");
}

/** Today's rate from `unit` to `currency`; a missing rate fails closed. */
async function readRate(householdId: string, unit: string, currency: string): Promise<string> {
  const result = await db.execute<RateRow>(sql`SELECT
    (${resolvedFxRate(householdId, sql`${unit}::text`, currency)})::text AS "rate",
    ((transaction_timestamp() AT TIME ZONE 'UTC')::date)::text AS "onDate"`);
  const row = result.rows[0];
  if (!row?.rate) throw new CalculationError("MISSING_FX_RATE", { from: unit, to: currency, date: row?.onDate });
  return row.rate;
}

/**
 * Each rule's amount in `currency`, keyed by rule id. A counted rule in a
 * foreign unit with no rate throws MISSING_FX_RATE.
 */
export async function recurringAmountsIn(
  householdId: string,
  rules: readonly VisibleRecurringRule[],
  currency: string,
): Promise<ReadonlyMap<string, string>> {
  const unitOf = (rule: VisibleRecurringRule) => rule.verifiedCurrency ?? currency;
  const foreign = Array.from(new Set(rules.filter(isCounted).map(unitOf).filter((unit) => unit !== currency)));
  const rates = new Map<string, string>();
  for (const unit of foreign) rates.set(unit, await readRate(householdId, unit, currency));

  const amounts = new Map<string, string>();
  for (const rule of rules) {
    const unit = unitOf(rule);
    const rate = unit === currency ? undefined : rates.get(unit);
    if (unit !== currency && rate === undefined) continue; // Not counted: never summed.
    const converted = rate === undefined ? new Money(rule.amount, unit) : new Money(rule.amount, unit).multiply(rate);
    amounts.set(rule.id, converted.toFullString());
  }
  return amounts;
}
