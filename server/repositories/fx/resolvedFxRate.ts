/**
 * The one FX rate resolution shared by Reports, Budgets and the transaction
 * summary (FIN-06).
 *
 * A rate for one currency on one date is the household's own manual rate valid
 * on that date, else the shared rate dated on or before it (`fx_rates`, which
 * the market refresh fills from provider quotes). Another household's manual
 * rate is never read, and a missing rate is NULL — never 1. Callers fail
 * closed on NULL.
 *
 * @module repositories/fx/resolvedFxRate
 */

import { sql, type SQL } from "drizzle-orm";
import { fxRates, householdFxRateOverrides } from "@shared/schema";

/** The base currency as a bound code or an SQL expression yielding one. */
export type FxBaseCurrency = string | SQL;

function onDateOf(dateExpr?: SQL): SQL {
  return dateExpr ?? sql`(transaction_timestamp() AT TIME ZONE 'UTC')::date`;
}

function householdRateRow(householdId: string, currencyExpr: SQL, baseCurrency: FxBaseCurrency, onDate: SQL): SQL {
  return sql`SELECT hfx_own.id, hfx_own.rate::numeric AS rate
     FROM ${householdFxRateOverrides} hfx_own
     WHERE hfx_own.household_id = ${householdId}::uuid
       AND hfx_own.from_currency = ${currencyExpr}
       AND hfx_own.to_currency = ${baseCurrency}::text
       AND hfx_own.effective_date <= ${onDate}
       AND hfx_own.valid_through >= ${onDate}
     ORDER BY hfx_own.effective_date DESC
     LIMIT 1`;
}

function sharedRateRow(currencyExpr: SQL, baseCurrency: FxBaseCurrency, dateExpr?: SQL): SQL {
  const sharedDateClause = dateExpr ? sql`AND hfx_shared.date <= ${dateExpr}` : sql``;
  // fx_rates has no unique (from, to, date): the lower id breaks a same-day
  // tie, as in the investments datedRateRow.
  return sql`SELECT hfx_shared.id, hfx_shared.rate::numeric AS rate
     FROM ${fxRates} hfx_shared
     WHERE hfx_shared.from_currency = ${currencyExpr}
       AND hfx_shared.to_currency = ${baseCurrency}::text
       ${sharedDateClause}
     ORDER BY hfx_shared.date DESC, hfx_shared.id ASC
     LIMIT 1`;
}

/**
 * The resolved rate for one currency on one date, or NULL when none exists.
 *
 * @param householdId - The household whose own manual rates may apply
 * @param currencyExpr - SQL expression yielding the source currency
 * @param baseCurrency - Target (household base) currency
 * @param dateExpr - SQL expression for the conversion date; when absent, the
 *                   household rate must be valid today and the latest shared
 *                   rate applies
 */
export function resolvedFxRate(
  householdId: string,
  currencyExpr: SQL,
  baseCurrency: FxBaseCurrency,
  dateExpr?: SQL,
): SQL {
  const own = householdRateRow(householdId, currencyExpr, baseCurrency, onDateOf(dateExpr));
  const shared = sharedRateRow(currencyExpr, baseCurrency, dateExpr);
  return sql`COALESCE((SELECT own.rate FROM (${own}) own), (SELECT shared.rate FROM (${shared}) shared))`;
}

/**
 * The same resolution as `resolvedFxRate`, as a one-row relation for
 * `LEFT JOIN LATERAL ... ON true`. Besides `rate` it names the row actually
 * used: `override_id` (a household manual rate) or `shared_id` (an `fx_rates`
 * row), never both, so a publisher can lock exactly the rate it relied on.
 */
export function resolvedFxRateSource(
  householdId: string,
  currencyExpr: SQL,
  baseCurrency: FxBaseCurrency,
  dateExpr: SQL,
): SQL {
  const own = householdRateRow(householdId, currencyExpr, baseCurrency, dateExpr);
  const shared = sharedRateRow(currencyExpr, baseCurrency, dateExpr);
  return sql`(SELECT COALESCE(own.rate, shared.rate) AS rate, own.id AS override_id, shared.id AS shared_id
    FROM (SELECT 1) seed
    LEFT JOIN LATERAL (${own}) own ON true
    LEFT JOIN LATERAL (${shared}) shared ON own.id IS NULL)`;
}
