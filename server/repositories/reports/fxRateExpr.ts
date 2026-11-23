/**
 * Shared FX rate SQL expressions for report repositories.
 *
 * Single source of truth for the per-row rate lookup used by report
 * aggregation queries and by the pre-aggregation guard
 * (`BaseReportRepository.assertFxRatesAvailable`).
 *
 * R12 (NEW-13): a row's rate is the household's own manual rate valid on the
 * row's date, else the shared provider rate dated on or before it. Another
 * household's manual rate is never read, and a missing rate is never 1.
 *
 * Every aggregate embedding `buildFxRateExpr` MUST first run
 * `assertFxRatesAvailable` for the same range so a missing rate is a typed 422.
 * If a row ever slips past the guard, the default expression fails the whole
 * statement rather than dropping or mis-converting that row. With
 * `nullOnMissing`, a missing rate yields NULL — for row-by-row callers that
 * convert in JS and fail closed per row (net-worth snapshots). Never embed a
 * nullOnMissing expression inside a SQL aggregate.
 *
 * @module repositories/reports/fxRateExpr
 */

import { sql, type SQL } from "drizzle-orm";
import { resolvedFxRate } from "../fx/resolvedFxRate";

// FIN-06: the resolution itself is shared with Budgets and the transaction
// summary; it lives in repositories/fx/resolvedFxRate.
export { resolvedFxRate };

/**
 * Build the SQL expression resolving a row's FX rate to the base currency.
 *
 * @param currencyExpr - SQL expression yielding the row's effective currency
 * @param baseCurrency - Household base currency code
 * @param dateExpr - Optional SQL expression bounding the rate lookup
 * @param options - `householdId`: the household whose manual rates apply;
 *                  `nullOnMissing`: yield NULL (not an error) when no rate
 *                  matches, so row-by-row JS callers can fail closed per row
 */
export function buildFxRateExpr(
  currencyExpr: SQL,
  baseCurrency: string,
  dateExpr: SQL | undefined,
  options: { householdId: string; nullOnMissing?: boolean },
): SQL {
  const rate = resolvedFxRate(options.householdId, currencyExpr, baseCurrency, dateExpr);
  // The cast of a non-numeric text only runs when no rate exists, and fails the
  // statement naming the pair. It replaces the old silent COALESCE(rate, 1).
  const required = sql`COALESCE(${rate}, ('MISSING_FX_RATE ' || ${currencyExpr} || ' -> ' || ${baseCurrency}::text)::numeric)`;
  return sql`CASE
    WHEN ${currencyExpr} = ${baseCurrency}::text THEN 1
    ELSE ${options.nullOnMissing ? rate : required}
  END`;
}
