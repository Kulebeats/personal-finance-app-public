/**
 * Shared FX rate SQL expression for report repositories.
 *
 * Single source of truth for the per-row rate lookup used by report
 * aggregation queries (previously duplicated between BaseReportRepository and
 * SankeyNodes).
 *
 * IMPORTANT: by default the expression COALESCEs a missing rate to 1, which
 * would silently corrupt totals. Every query embedding this expression MUST
 * first run `BaseReportRepository.assertFxRatesAvailable` for the same range
 * so a missing rate fails closed before the aggregate executes (SCP-321).
 *
 * With `nullOnMissing`, a missing rate yields NULL instead of 1 — for
 * row-by-row callers that convert in JS and fail closed per row (net-worth
 * snapshots), whose currencies the transaction-based guard never sees.
 * Never embed a nullOnMissing expression inside a SQL aggregate.
 *
 * @module repositories/reports/fxRateExpr
 */

import { sql } from "drizzle-orm";
import { fxRates } from "@shared/schema";

/**
 * Build the SQL expression resolving a row's FX rate to the base currency.
 *
 * @param currencyExpr - SQL expression yielding the row's effective currency
 * @param baseCurrency - Household base currency code
 * @param dateExpr - Optional SQL expression bounding the rate lookup
 *                   (`rate.date <= dateExpr`); omits the bound when absent
 * @param options - `nullOnMissing`: yield NULL (not 1) when no rate matches,
 *                  so row-by-row JS callers can fail closed per row
 */
export function buildFxRateExpr(
  currencyExpr: ReturnType<typeof sql>,
  baseCurrency: string,
  dateExpr?: ReturnType<typeof sql>,
  options?: { nullOnMissing?: boolean },
) {
  const rateDateClause = dateExpr
    ? sql`AND ${fxRates.date} <= ${dateExpr}`
    : sql``;

  const rateSubquery = sql`(
    SELECT ${fxRates.rate}::numeric
    FROM ${fxRates}
    WHERE ${fxRates.fromCurrency} = ${currencyExpr}
      AND ${fxRates.toCurrency} = ${baseCurrency}::text
      ${rateDateClause}
    ORDER BY ${fxRates.date} DESC
    LIMIT 1
  )`;

  return sql`CASE
    WHEN ${currencyExpr} = ${baseCurrency}::text THEN 1
    ELSE ${options?.nullOnMissing ? rateSubquery : sql`COALESCE(${rateSubquery}, 1)`}
  END`;
}
