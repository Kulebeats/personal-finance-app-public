/**
 * Spending Report Repository
 *
 * Handles spending-related analytics:
 * - getSpendingBreakdown: breakdown by category/merchant/tag
 * - getSpendingTrend: trend with comparison
 * - getSubcategoryBreakdown: subcategory drill-down
 *
 * MIGRATION STATUS: Full implementation
 *
 * @module repositories/reports/SpendingReportRepository
 */

import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import {
  transactions,
  transactionSplits,
  transactionTags,
  tags,
  categories,
  categoryGroups,
  merchants,
  accounts,
} from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import type {
  ReportsSpendingBreakdownResponse,
  ReportsSpendingTrendResponse,
} from "@shared/reports";
import type { MoneyDto } from "@shared/money";
import { Money } from "../../core/money";
import type {
  ReportsSpendingBreakdownQuery,
  ReportsSpendingTrendQuery,
  ReportsCashflowQuery,
} from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import {
  moneyFromDto,
  moneyFromValue,
  percentOf,
  toMoneyDtoSafe,
} from "./moneyUtils";

// Import cashflow for trend comparison
import { CashflowReportRepository } from "./CashflowReportRepository";

/**
 * Repository for spending analytics.
 */
export class SpendingReportRepository extends BaseReportRepository {
  private cashflowRepo = new CashflowReportRepository();

  /**
   * Get spending breakdown by category, merchant, or tag.
   *
   * Inputs:
   * - householdId: household scope for all aggregates.
   * - query.from/query.to: inclusive date range (YYYY-MM-DD).
   * - query.groupBy: categoryGroup | category | merchantCategory | merchant | tag.
   * - query.type: income | expense (default expense).
   * - query.scope: household | mine.
   *
   * Behavior:
   * - Aggregates in household base currency using FX rate expression.
   * - Returns label/color fields based on grouping.
   * - Excludes soft-deleted transactions.
   *
   * Original: ReportRepository lines 121-359.
   */
  async getSpendingBreakdown(
    householdId: string,
    query: QueryWithUser<ReportsSpendingBreakdownQuery>
  ): Promise<ReportsSpendingBreakdownResponse> {
    const {
      from,
      to,
      groupBy = "categoryGroup",
      limit = 10,
      includeOther = false,
      includePending = false,
      includeTransfers = false,
      scope = "household",
      type = "expense",
      merchantId,
      categoryGroupId,
      userId,
    } = query;

    const merchantFilterId = merchantId ?? null;
    const categoryGroupFilterId =
      groupBy === "categoryGroup" || groupBy === "category"
        ? categoryGroupId ?? null
        : null;

    // Get household currency
    const currency = await this.getHouseholdCurrency(householdId);

    // SCP-321: fail closed BEFORE aggregating — the SQL rate expression
    // silently converts at 1 when a rate row is missing.
    await this.assertFxRatesAvailable(householdId, currency, {
      from,
      to,
      includePending,
      scope,
      userId,
    });

    const currencyExpr = sql`COALESCE(et.currency, a.currency, ${currency}::text)`;
    const fxRateExpr = this.buildFxRateExpr(
      currencyExpr,
      currency,
      sql`et.date`
    );

    const selectEntityId =
      groupBy === "categoryGroup"
        ? sql`COALESCE(cg.id::text, 'uncategorized')`
        : groupBy === "category"
        ? sql`COALESCE(c.id::text, 'uncategorized')`
        : groupBy === "merchantCategory"
        ? sql`COALESCE(m.category, 'Uncategorized')`
        : groupBy === "tag"
        ? sql`COALESCE(tg.id::text, 'untagged')`
        : sql`COALESCE(m.id::text, 'no-merchant')`;

    const selectLabel =
      groupBy === "categoryGroup"
        ? sql`COALESCE(cg.name, 'Uncategorized')`
        : groupBy === "category"
        ? sql`COALESCE(c.name, 'Uncategorized')`
        : groupBy === "merchantCategory"
        ? sql`COALESCE(m.category, 'Uncategorized')`
        : groupBy === "tag"
        ? sql`COALESCE(tg.name, 'Untagged')`
        : sql`COALESCE(m.name, 'No merchant')`;

    const selectColor =
      groupBy === "category"
        ? sql`c.color`
        : groupBy === "tag"
        ? sql`tg.color`
        : sql`NULL`;

    const joinClause =
      groupBy === "tag"
        ? sql`
            LEFT JOIN ${transactionTags} tt ON tt.transaction_id = et.id
            LEFT JOIN ${tags} tg ON tg.id = tt.tag_id
          `
        : groupBy === "merchant"
        ? sql`
            LEFT JOIN ${merchants} m ON m.id = et.merchant_id
          `
        : groupBy === "merchantCategory"
        ? sql`
            LEFT JOIN ${merchants} m ON m.id = et.merchant_id
          `
        : sql`
            LEFT JOIN ${categories} c ON c.id = et.category_id
            LEFT JOIN ${categoryGroups} cg ON cg.id = c.group_id
          `;

    const categoryGroupFilterClause =
      groupBy === "categoryGroup" || groupBy === "category"
        ? sql`AND (${categoryGroupFilterId}::uuid IS NULL OR cg.id = ${categoryGroupFilterId}::uuid)`
        : sql``;

    // Build the spending query with splits support
    const result = await db.execute<{
      entity_id: string;
      label: string;
      value: string;
      color: string | null;
    }>(sql`
      WITH effective_transactions AS (
        SELECT
          t.id,
          t.household_id,
          t.date,
          t.type,
          t.is_pending,
          t.is_excluded_from_reports,
          t.is_private,
          t.owner_user_id,
          t.account_id,
          t.currency,
          COALESCE(s.category_id, t.category_id) AS category_id,
          COALESCE(s.merchant_id, t.merchant_id) AS merchant_id,
          COALESCE(s.amount, t.amount)::numeric AS amount
        FROM ${transactions} t
        LEFT JOIN ${transactionSplits} s ON s.transaction_id = t.id
        WHERE t.deleted_at IS NULL
      )
      SELECT
        ${selectEntityId} AS entity_id,
        ${selectLabel} AS label,
        SUM(et.amount * ${fxRateExpr}) AS value,
        ${selectColor} AS color
      FROM effective_transactions et
      ${joinClause}
      JOIN ${accounts} a ON a.id = et.account_id
      WHERE et.household_id = ${householdId}::uuid
        AND et.type::text = ${type}::text
        AND et.is_excluded_from_reports = FALSE
        AND et.date >= ${from}::date
        AND et.date <= ${to}::date
        AND (${merchantFilterId}::uuid IS NULL OR et.merchant_id = ${merchantFilterId}::uuid)
        ${categoryGroupFilterClause}
        AND (${includePending}::boolean = TRUE OR et.is_pending = FALSE)
        AND (${includeTransfers}::boolean = TRUE OR et.type::text != 'transfer')
        AND (${scope}::text = 'household' OR et.owner_user_id = ${userId}::uuid)
        AND (a.is_private = FALSE OR a.owner_user_id = ${userId}::uuid)
        AND (et.is_private = FALSE OR et.owner_user_id = ${userId}::uuid)
        AND (a.hide_transactions = FALSE OR a.hide_transactions IS NULL)
      GROUP BY 1, 2, 4
      ORDER BY value DESC
      LIMIT ${limit}::integer
    `);

    const rows = result.rows || [];
    const totalTop = rows.reduce(
      (sum, r) => sum.add(moneyFromValue(r.value, currency)),
      Money.zero(currency)
    );

    const totalResult = await db.execute<{ total: string }>(sql`
      WITH effective_transactions AS (
        SELECT
          t.id,
          t.household_id,
          t.date,
          t.type,
          t.is_pending,
          t.is_excluded_from_reports,
          t.is_private,
          t.owner_user_id,
          t.account_id,
          t.currency,
          COALESCE(s.category_id, t.category_id) AS category_id,
          COALESCE(s.merchant_id, t.merchant_id) AS merchant_id,
          COALESCE(s.amount, t.amount)::numeric AS amount
        FROM ${transactions} t
        LEFT JOIN ${transactionSplits} s ON s.transaction_id = t.id
        WHERE t.deleted_at IS NULL
      )
      SELECT
        SUM(et.amount * ${fxRateExpr}) AS total
      FROM effective_transactions et
      ${joinClause}
      JOIN ${accounts} a ON a.id = et.account_id
      WHERE et.household_id = ${householdId}::uuid
        AND et.type::text = ${type}::text
        AND et.is_excluded_from_reports = FALSE
        AND et.date >= ${from}::date
        AND et.date <= ${to}::date
        AND (${merchantFilterId}::uuid IS NULL OR et.merchant_id = ${merchantFilterId}::uuid)
        ${categoryGroupFilterClause}
        AND (${includePending}::boolean = TRUE OR et.is_pending = FALSE)
        AND (${includeTransfers}::boolean = TRUE OR et.type::text != 'transfer')
        AND (${scope}::text = 'household' OR et.owner_user_id = ${userId}::uuid)
        AND (a.is_private = FALSE OR a.owner_user_id = ${userId}::uuid)
        AND (et.is_private = FALSE OR et.owner_user_id = ${userId}::uuid)
        AND (a.hide_transactions = FALSE OR a.hide_transactions IS NULL)
    `);

    const totalAll = moneyFromValue(
      totalResult.rows?.[0]?.total,
      currency
    );
    const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

    const items = rows.map((row) => {
      const rowValue = moneyFromValue(row.value, currency);
      return {
        id: row.entity_id,
        label: row.label || "Uncategorized",
        value: toMoneyValue(rowValue),
        percent: percentOf(rowValue, totalAll, 2),
        color: row.color || undefined,
        entityType: groupBy as
          | "categoryGroup"
          | "category"
          | "merchant"
          | "merchantCategory"
          | "tag",
        entityId: row.entity_id,
      };
    });

    if (includeOther && totalAll.gt(totalTop)) {
      const otherValue = totalAll.subtract(totalTop);
      items.push({
        id: "other",
        label: "Other",
        value: toMoneyValue(otherValue),
        percent: percentOf(otherValue, totalAll, 2),
        entityType: groupBy as
          | "categoryGroup"
          | "category"
          | "merchant"
          | "merchantCategory"
          | "tag",
        entityId: "other",
        color: undefined,
      });
    }

    return {
      range: { from, to, baseCurrency: currency },
      groupBy,
      total: toMoneyValue(totalAll),
      items,
    };
  }

  /**
   * Get spending trend with optional comparison window.
   *
   * Inputs:
   * - from/to: inclusive date range (YYYY-MM-DD).
   * - interval: day | week | month (default month).
   * - compare: none | previous_period | previous_year.
   * - scope: household | mine.
   *
   * Behavior:
   * - Uses CashflowReportRepository to compute expenses series.
   * - Derives previous period dates for comparison and returns changePct.
   *
   * Original: ReportRepository lines 901-1015.
   */
  async getSpendingTrend(
    householdId: string,
    query: QueryWithUser<ReportsSpendingTrendQuery>
  ): Promise<ReportsSpendingTrendResponse> {
    const {
      from,
      to,
      interval = "month",
      compare = "none",
      includePending = false,
      includeTransfers = false,
      merchantId,
      timezone,
      userId,
      scope = "household",
    } = query;

    const currency = await this.getHouseholdCurrency(householdId);

    // Get current period data
    const currentCashflow = await this.cashflowRepo.getCashflow(householdId, {
      from,
      to,
      interval,
      includePending,
      includeTransfers,
      merchantId,
      timezone,
      userId,
      scope,
    });
    const currentTotal = currentCashflow.totals.expenses;

    // Calculate previous period dates if comparison requested
    let previousTotal: MoneyDto | undefined;
    let previousCashflow: typeof currentCashflow | undefined;

    if (compare !== "none") {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const daysDiff = Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      let prevFrom: string;
      let prevTo: string;

      if (compare === "previous_year") {
        const prevFromDate = new Date(fromDate);
        prevFromDate.setFullYear(prevFromDate.getFullYear() - 1);
        const prevToDate = new Date(toDate);
        prevToDate.setFullYear(prevToDate.getFullYear() - 1);

        prevFrom = prevFromDate.toISOString().split("T")[0];
        prevTo = prevToDate.toISOString().split("T")[0];
      } else {
        const prevToDate = new Date(fromDate);
        prevToDate.setDate(prevToDate.getDate() - 1);
        const prevFromDate = new Date(prevToDate);
        prevFromDate.setDate(prevFromDate.getDate() - daysDiff);

        prevFrom = prevFromDate.toISOString().split("T")[0];
        prevTo = prevToDate.toISOString().split("T")[0];
      }

      previousCashflow = await this.cashflowRepo.getCashflow(householdId, {
        from: prevFrom,
        to: prevTo,
        interval,
        includePending,
        includeTransfers,
        merchantId,
        timezone,
        userId,
        scope,
      });
      previousTotal = previousCashflow.totals.expenses;
    }

    const previousByDate = new Map(
      previousCashflow?.series?.map((s) => [s.periodStart, s]) ?? []
    );

    const currentTotalMoney = moneyFromDto(currentTotal, currency);
    const previousTotalMoney = previousTotal
      ? moneyFromDto(previousTotal, currency)
      : Money.zero(currency);
    const changePct =
      previousTotal && !previousTotalMoney.amount.isZero()
        ? percentOf(
            currentTotalMoney.subtract(previousTotalMoney),
            previousTotalMoney,
            2
          )
        : undefined;

    return {
      range: { from, to, interval, baseCurrency: currency },
      compare,
      totals: {
        current: currentTotal,
        previous: previousTotal,
        changePct:
          changePct !== undefined
            ? changePct
            : undefined,
      },
      series: currentCashflow.series.map((s) => ({
        date: s.periodStart,
        current: s.expenses,
        previous: previousByDate.get(s.periodStart)?.expenses,
      })),
    };
  }

  /**
   * Get subcategory breakdown for a parent category or group.
   *
   * Inputs:
   * - from/to: inclusive date range (YYYY-MM-DD).
   * - categoryId/groupId: optional filter to narrow results.
   * - scope/userId: household or user-specific view.
   *
   * Behavior:
   * - Uses getSpendingBreakdown with groupBy=category.
   * - Filters results to requested category/group if provided.
   *
   * Original: ReportRepository lines 2641-2705.
   */
  async getSubcategoryBreakdown(
    householdId: string,
    query: {
      from: string;
      to: string;
      type?: string;
      categoryId?: string;
      scope?: string;
      userId?: string;
      confidenceLevel?: number;
      groupId?: string;
    }
  ) {
    const {
      from,
      to,
      type = "expense",
      scope = "household",
      userId,
      categoryId,
      groupId,
    } = query;

    const currency = await this.getHouseholdCurrency(householdId);

    // Get spending breakdown filtered by parent category or group if provided
    const breakdown = await this.getSpendingBreakdown(householdId, {
      from,
      to,
      groupBy: "category",
      type: (type === "income" ? "income" : "expense") as "income" | "expense",
      scope: scope as "household" | "mine",
      userId,
      categoryGroupId: groupId,
    });

    const items = breakdown.items
      .filter((item) => !categoryId || item.entityId === categoryId)
      .map((item) => ({
        id: item.entityId,
        label: item.label,
        parentCategory: { id: item.entityId, name: item.label },
        value: item.value,
        percent: item.percent,
        color: item.color,
      }));

    return {
      range: { from, to, currency },
      type: type as "income" | "expense" | "savingsContributions" | "debt",
      categoryId,
      total: breakdown.total,
      items,
    };
  }
}

// Singleton instance
export const spendingReportRepository = new SpendingReportRepository();
