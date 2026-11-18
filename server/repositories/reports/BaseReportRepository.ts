/**
 * Base Report Repository
 *
 * Shared utilities for all report repositories including:
 * - Currency normalization
 * - FX rate conversion
 * - Common query filters
 *
 * @module repositories/reports/BaseReportRepository
 */

import { db } from "../../db";
import { sql, and, eq, gte, lte, isNull, or } from "drizzle-orm";
import {
  transactions,
  accounts,
  households,
  fxRates,
  investmentTransactions,
} from "@shared/schema";
import { getLatestFxRates as getFxRatesFromCalc } from "../../core/calculations";
import { Money } from "../../core/money";
import { logger } from "../../utils/logger";
import { buildFxRateExpr } from "./fxRateExpr";

/**
 * Abstract base class providing shared utilities for all report repositories.
 */
export abstract class BaseReportRepository {
  /**
   * Normalize currency code to uppercase
   */
  protected normalizeCurrency(value: string | null | undefined): string {
    return (value || "").trim().toUpperCase();
  }

  /**
   * Get effective currency with fallbacks
   */
  protected getEffectiveCurrency(
    transactionCurrency: string | null | undefined,
    accountCurrency: string | null | undefined,
    baseCurrency: string
  ): string {
    const fallback = this.normalizeCurrency(baseCurrency) || "USD";
    const currency =
      this.normalizeCurrency(transactionCurrency) ||
      this.normalizeCurrency(accountCurrency) ||
      fallback;
    return currency || fallback;
  }

  /**
   * Convert amount using FX rates
   * Uses Money class for precise decimal parsing (ISSUE-RPT-001 fix)
   */
  protected convertAmount(
    amount: string | number | null | undefined,
    currency: string,
    baseCurrency: string,
    fxRatesByCurrency: Map<string, number>
  ): Money {
    const normalizedBase = this.normalizeCurrency(baseCurrency) || "USD";
    const normalizedCurrency =
      this.normalizeCurrency(currency) || normalizedBase;

    let parsed: Money;
    try {
      parsed = new Money(String(amount ?? "0"), normalizedCurrency);
    } catch {
      parsed = Money.zero(normalizedBase);
    }

    if (normalizedCurrency === normalizedBase) {
      return new Money(parsed.amount, normalizedBase);
    }

    // SCP-321: fail closed on a missing rate — never silently use 1, which
    // would corrupt the report total.
    const fxRate = fxRatesByCurrency.get(normalizedCurrency);
    if (fxRate === undefined) {
      logger.error("Missing FX rate in report conversion", {
        fromCurrency: normalizedCurrency,
        toCurrency: normalizedBase,
      });
      throw new Error(
        `Exchange rate unavailable for ${normalizedCurrency} -> ${normalizedBase}`,
      );
    }
    return new Money(parsed.amount.times(fxRate), normalizedBase);
  }

  /**
   * Get latest FX rates - delegates to centralized calculation engine
   */
  protected async getLatestFxRates(
    fromCurrencies: string[],
    toCurrency: string
  ): Promise<Map<string, number>> {
    const baseCurrency = this.normalizeCurrency(toCurrency) || "USD";
    const normalizedCurrencies = fromCurrencies
      .map((c) => this.normalizeCurrency(c))
      .filter((c) => c.length > 0);

    return getFxRatesFromCalc(normalizedCurrencies, baseCurrency);
  }

  /**
   * Get household's base currency
   */
  protected async getHouseholdCurrency(householdId: string): Promise<string> {
    const [household] = await db
      .select({ currency: households.currency })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    return this.normalizeCurrency(household?.currency) || "USD";
  }

  /**
   * Build SQL expression for currency with fallback
   */
  protected buildCurrencyExpr(baseCurrency: string) {
    return sql`COALESCE(t.currency, a.currency, ${baseCurrency}::text)`;
  }

  /**
   * Build SQL expression for FX rate lookup.
   *
   * Delegates to the shared implementation in fxRateExpr.ts.
   *
   * By default the expression COALESCEs a missing rate to 1, so any query
   * embedding it MUST first call assertFxRatesAvailable for the same range
   * (SCP-321) — a NULL rate inside a SQL aggregate would silently poison
   * whole SUMs. With `nullOnMissing`, a missing rate yields NULL instead,
   * for row-by-row callers that convert in JS and fail closed per row
   * (e.g. net-worth snapshots, whose currencies the transaction-based
   * assertFxRatesAvailable guard never sees).
   */
  protected buildFxRateExpr(
    currencyExpr: ReturnType<typeof sql>,
    baseCurrency: string,
    dateExpr?: ReturnType<typeof sql>,
    options?: { nullOnMissing?: boolean }
  ) {
    return buildFxRateExpr(currencyExpr, baseCurrency, dateExpr, options);
  }

  /**
   * Pre-aggregation FX guard (SCP-321: fail closed on missing rates).
   *
   * Report queries convert amounts in SQL via buildFxRateExpr, whose rate
   * subquery COALESCEs to 1 when no rate row matches — silently corrupting
   * multi-currency totals. Before running such an aggregate, this asserts
   * that every distinct non-base transaction currency in the queried range
   * has a rate to the household base currency dated on/before the earliest
   * transaction that needs it (matching the `fx.date <= t.date` bound used
   * by the aggregation expression). Throws the same error shape as
   * convertAmount — a missing rate is a surfaced error, never rate = 1.
   */
  protected async assertFxRatesAvailable(
    householdId: string,
    baseCurrency: string,
    options: {
      from: string;
      to: string;
      includePending?: boolean;
      scope?: string;
      userId?: string;
      /** Also check orphaned investment-income currencies (cashflow). */
      includeInvestmentIncome?: boolean;
      /**
       * Set when the guarded aggregate has NO hide_transactions filter
       * (expense classification, category averages, budget-comparison
       * spending) so hidden-account currencies are checked too.
       */
      includeHiddenAccounts?: boolean;
    }
  ): Promise<void> {
    const base = this.normalizeCurrency(baseCurrency) || "USD";
    const {
      from,
      to,
      includePending = false,
      scope = "household",
      userId,
      includeInvestmentIncome = false,
      includeHiddenAccounts = false,
    } = options;
    const userIdParam = userId ?? null;

    const investmentSource = includeInvestmentIncome
      ? sql`
      UNION ALL
      SELECT COALESCE(t.currency, a.currency) AS currency,
             MIN(t.transaction_date) AS min_date
      FROM ${investmentTransactions} t
      JOIN ${accounts} a ON a.id = t.account_id
      WHERE t.household_id = ${householdId}::uuid
        AND t.linked_transaction_id IS NULL
        AND t.type IN ('dividend', 'interest', 'coupon')
        AND t.transaction_date >= ${from}::date
        AND t.transaction_date <= ${to}::date
        AND a.deleted_at IS NULL
        AND (${userIdParam}::uuid IS NULL OR a.is_private = FALSE OR a.owner_user_id = ${userIdParam}::uuid)
        AND COALESCE(t.currency, a.currency) IS NOT NULL
        AND COALESCE(t.currency, a.currency) != ${base}::text
      GROUP BY 1`
      : sql``;

    const result = await db.execute<{ currency: string }>(sql`
      WITH report_currencies AS (
        SELECT COALESCE(t.currency, a.currency) AS currency,
               MIN(t.date) AS min_date
        FROM ${transactions} t
        JOIN ${accounts} a ON a.id = t.account_id
        WHERE t.household_id = ${householdId}::uuid
          AND t.deleted_at IS NULL
          AND t.is_excluded_from_reports = FALSE
          AND t.date >= ${from}::date
          AND t.date <= ${to}::date
          AND (${includePending}::boolean = TRUE OR t.is_pending = FALSE)
          AND (${scope}::text = 'household' OR t.owner_user_id = ${userIdParam}::uuid)
          AND (${userIdParam}::uuid IS NULL OR t.is_private = FALSE OR t.owner_user_id = ${userIdParam}::uuid)
          AND (${userIdParam}::uuid IS NULL OR a.is_private = FALSE OR a.owner_user_id = ${userIdParam}::uuid)
          AND (${includeHiddenAccounts}::boolean = TRUE OR a.hide_transactions = FALSE OR a.hide_transactions IS NULL)
          AND COALESCE(t.currency, a.currency) IS NOT NULL
          AND COALESCE(t.currency, a.currency) != ${base}::text
        GROUP BY 1
        ${investmentSource}
      ),
      distinct_currencies AS (
        SELECT currency, MIN(min_date) AS min_date
        FROM report_currencies
        GROUP BY currency
      )
      SELECT dc.currency
      FROM distinct_currencies dc
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${fxRates} fx
        WHERE fx.from_currency = dc.currency
          AND fx.to_currency = ${base}::text
          AND fx.date <= dc.min_date
      )
      ORDER BY dc.currency
    `);

    const missing = (result.rows || []).map((row) => row.currency);
    if (missing.length > 0) {
      logger.error("Missing FX rate for report aggregation", {
        householdId,
        fromCurrencies: missing,
        toCurrency: base,
        from,
        to,
      });
      throw new Error(
        `Exchange rate unavailable for ${missing.join(", ")} -> ${base}`
      );
    }
  }

  /**
   * Build common WHERE clause conditions for transaction queries
   */
  protected buildBaseConditions(
    householdId: string,
    options: {
      from?: string;
      to?: string;
      includePending?: boolean;
      includeTransfers?: boolean;
      scope?: string;
      userId?: string;
    }
  ) {
    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isExcludedFromReports, false),
      sql`NOT EXISTS (
        SELECT 1 FROM transaction_splits
        WHERE transaction_splits.transaction_id = ${transactions.id}
      )`,
    ];

    if (options.from) {
      conditions.push(gte(transactions.date, options.from));
    }
    if (options.to) {
      conditions.push(lte(transactions.date, options.to));
    }
    if (!options.includePending) {
      conditions.push(eq(transactions.isPending, false));
    }
    if (!options.includeTransfers) {
      // Note: transfers are excluded by type check in queries
    }
    if (options.scope === "mine" && options.userId) {
      conditions.push(eq(transactions.ownerUserId, options.userId));
    }

    return and(...conditions);
  }
}
