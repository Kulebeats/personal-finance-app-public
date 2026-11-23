import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { providerFxQuotes as quotes } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import type { db } from "../db";
import { Money } from "../core/money";

type ReadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Quote = typeof quotes.$inferSelect;

/** Explicit 0017 dependency. Balance valuation supports same-day observations;
 * the separately approved flow carry window is not a balance valuation policy. */
export async function readAccountValuationQuotes(tx: ReadTransaction, currencies: string[], base: unknown, asOf: Date) {
  if (!isCurrencyCode(base)) return [];
  const foreign = Array.from(new Set(currencies.filter(value => isCurrencyCode(value) && value !== base)));
  if (!foreign.length) return [];
  const date = asOf.toISOString().slice(0, 10);
  // SQL errors propagate. Missing schema or aborted reads are not missing rates.
  return tx.selectDistinctOn([quotes.fromCurrency]).from(quotes).where(and(
    inArray(quotes.fromCurrency, foreign), eq(quotes.toCurrency, base),
    eq(quotes.effectiveDate, date), gte(quotes.validThrough, date), lte(quotes.quotedAt, asOf),
  )).orderBy(quotes.fromCurrency, desc(quotes.quotedAt), asc(quotes.provider));
}

/** Validate selected evidence independently; keep its decimal through valuation. */
export function accountValuationRates(rows: Quote[], base: string, asOf: Date): ReadonlyMap<string, string> {
  const date = asOf.toISOString().slice(0, 10), result = new Map<string, string>();
  for (const row of rows) {
    const quoted = row.quotedAt instanceof Date ? row.quotedAt : new Date(NaN);
    if (!isCurrencyCode(row.fromCurrency) || row.toCurrency !== base || row.fromCurrency === base ||
        !["yahoo_finance", "exchangerate_api"].includes(row.provider) || row.effectiveDate !== date ||
        row.validThrough < date || !Number.isFinite(quoted.getTime()) || quoted > asOf ||
        quoted.toISOString().slice(0, 10) !== date) continue;
    try {
      const rate = new Money(row.rate);
      if (rate.amount.isFinite() && !rate.isZero() && !rate.isNegative()) result.set(row.fromCurrency, row.rate);
    } catch { /* A malformed stored rate is unsupported evidence, not rate 1. */ }
  }
  return result;
}

export function accountQuoteProof(rows: Quote[]) {
  return rows.map(row => ({ id: row.id, from: row.fromCurrency, to: row.toCurrency, provider: row.provider,
    rate: row.rate, quotedAt: row.quotedAt, effectiveDate: row.effectiveDate, validThrough: row.validThrough }));
}
