import Decimal from "decimal.js";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { householdFxRateOverrides, type fxRates } from "@shared/schema";
import type { db } from "../../../db";

type RateReader = Pick<typeof db, "select" | "selectDistinctOn">;

/** A stored rate is usable only when it is a finite positive number; never fall back to 1. */
function usableRate(value: string | null): number | null {
  if (value === null) return null;
  let rate: Decimal;
  try {
    rate = new Decimal(value);
  } catch {
    return null;
  }
  return rate.isFinite() && rate.gt(0) ? rate.toNumber() : null;
}

/**
 * Latest rates to `to` for each currency, for one household (R12, NEW-13).
 * The household's own manual rate valid on `asOf` (default: today, UTC) wins;
 * otherwise the latest shared provider row applies. Another household's manual
 * rate is never read. A currency with no usable rate is absent from the map.
 */
export async function readLatestFxRates(
  database: RateReader,
  fxRatesTable: typeof fxRates,
  fromCurrencies: string[],
  to: string,
  householdId: string,
  asOf?: string,
): Promise<Map<string, number>> {
  const normalizedCurrencies = fromCurrencies.map((c) => c.toUpperCase());
  const normalizedTo = to.toUpperCase();

  if (normalizedCurrencies.length === 0) {
    return new Map();
  }

  const onDate = asOf ? sql`${asOf}::date` : sql`(transaction_timestamp() AT TIME ZONE 'UTC')::date`;
  const own = await database
    .selectDistinctOn([householdFxRateOverrides.fromCurrency], {
      fromCurrency: householdFxRateOverrides.fromCurrency,
      rate: householdFxRateOverrides.rate,
    })
    .from(householdFxRateOverrides)
    .where(
      and(
        eq(householdFxRateOverrides.householdId, householdId),
        inArray(householdFxRateOverrides.fromCurrency, normalizedCurrencies),
        eq(householdFxRateOverrides.toCurrency, normalizedTo),
        lte(householdFxRateOverrides.effectiveDate, onDate),
        gte(householdFxRateOverrides.validThrough, onDate),
      )
    )
    .orderBy(householdFxRateOverrides.fromCurrency, desc(householdFxRateOverrides.effectiveDate));

  const shared = await database
    .selectDistinctOn([fxRatesTable.fromCurrency], {
      fromCurrency: fxRatesTable.fromCurrency,
      rate: fxRatesTable.rate,
    })
    .from(fxRatesTable)
    .where(
      and(
        inArray(fxRatesTable.fromCurrency, normalizedCurrencies),
        eq(fxRatesTable.toCurrency, normalizedTo)
      )
    )
    .orderBy(fxRatesTable.fromCurrency, desc(fxRatesTable.date));

  const rateMap = new Map<string, number>();

  // Add self-rate for target currency
  if (normalizedCurrencies.includes(normalizedTo)) {
    rateMap.set(normalizedTo, 1);
  }

  for (const row of [...shared, ...own]) {
    const rate = usableRate(row.rate);
    if (rate !== null) rateMap.set(row.fromCurrency, rate);
  }

  return rateMap;
}
