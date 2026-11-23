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
  investmentTransactions,
} from "@shared/schema";
import { getLatestFxRates as getFxRatesFromCalc } from "../../core/calculations";
import { CalculationError } from "../../core/calculations/errors";
import { Money } from "../../core/money";
import { logger } from "../../utils/logger";
import { buildFxRateExpr, resolvedFxRate } from "./fxRateExpr";
import type { TransactionType } from "../../utils/withTransaction";

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
      throw new CalculationError(
        "MISSING_FX_RATE",
        { from: normalizedCurrency, to: normalizedBase },
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
    toCurrency: string,
    householdId: string
  ): Promise<Map<string, number>> {
    const baseCurrency = this.normalizeCurrency(toCurrency) || "USD";
    const normalizedCurrencies = fromCurrencies
      .map((c) => this.normalizeCurrency(c))
      .filter((c) => c.length > 0);

    return getFxRatesFromCalc(normalizedCurrencies, baseCurrency, householdId);
  }

  /**
   * Get household's base currency
   */
  protected async getHouseholdCurrency(householdId: string, tx?: TransactionType): Promise<string> {
    const [household] = await (tx ?? db)
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
   * The household's own manual rate valid on the date wins, then the shared
   * provider rate (R12). A missing rate is never 1: any query embedding the
   * expression MUST first call assertFxRatesAvailable for the same range so
   * the caller gets a typed 422, and a row that slips past the guard fails
   * the statement. With `nullOnMissing`, a missing rate yields NULL instead,
   * for row-by-row callers that convert in JS and fail closed per row
   * (e.g. net-worth snapshots, whose currencies the transaction-based
   * assertFxRatesAvailable guard never sees).
   */
  protected buildFxRateExpr(
    currencyExpr: ReturnType<typeof sql>,
    baseCurrency: string,
    dateExpr: ReturnType<typeof sql> | undefined,
    options: { householdId: string; nullOnMissing?: boolean }
  ) {
    return buildFxRateExpr(currencyExpr, baseCurrency, dateExpr, options);
  }

  /**
   * Pre-aggregation FX guard (SCP-321: fail closed on missing rates).
   *
   * Report queries convert amounts in SQL via buildFxRateExpr. Before such an
   * aggregate runs, this asserts that every distinct non-base currency and
   * date in the queried range resolves to a rate through the same lookup
   * (the household's own rate for the date, else the shared rate on or
   * before it). A missing rate throws CalculationError("MISSING_FX_RATE"),
   * which reaches the client as a 422 naming the pair and date.
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
       * (category averages, budget-comparison spending) so hidden-account
       * currencies are checked too.
       */
      includeHiddenAccounts?: boolean;
      transactionFilter?: ReturnType<typeof sql>;
    }, tx?: TransactionType
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
             t.transaction_date AS rate_date
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
      GROUP BY 1, 2`
      : sql``;

    const result = await (tx ?? db).execute<{ currency: string; rate_date: string }>(sql`
      WITH report_currencies AS (
        SELECT COALESCE(t.currency, a.currency) AS currency,
               t.date AS rate_date
        FROM ${transactions} t
        JOIN ${accounts} a ON a.id = t.account_id
        WHERE t.household_id = ${householdId}::uuid
          AND ${options.transactionFilter ?? sql`TRUE`}
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
        GROUP BY 1, 2
        ${investmentSource}
      ),
      distinct_needs AS (
        SELECT DISTINCT currency, rate_date FROM report_currencies
      )
      SELECT dn.currency, dn.rate_date::text AS rate_date
      FROM distinct_needs dn
      WHERE ${resolvedFxRate(householdId, sql`dn.currency`, base, sql`dn.rate_date`)} IS NULL
      ORDER BY dn.rate_date, dn.currency
    `);

    const missing = result.rows || [];
    if (missing.length > 0) {
      const currencies = Array.from(new Set(missing.map((row) => row.currency)));
      logger.error("Missing FX rate for report aggregation", {
        householdId,
        fromCurrencies: currencies,
        toCurrency: base,
        from,
        to,
      });
      throw new CalculationError(
        "MISSING_FX_RATE",
        { from: missing[0].currency, to: base, date: missing[0].rate_date },
        `Exchange rate unavailable for ${currencies.join(", ")} -> ${base} on ${missing[0].rate_date}`,
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
