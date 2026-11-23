/**
 * Transaction Report Repository
 *
 * Handles transaction drilldown queries:
 * - getTransactions: paginated transactions with cursor
 *
 * MIGRATION STATUS: Full implementation
 *
 * @module repositories/reports/TransactionReportRepository
 */

import { db } from "../../db";
import {
  sql,
  and,
  eq,
  gte,
  lte,
  isNull,
  desc,
  asc,
  or,
  ilike,
  inArray,
} from "drizzle-orm";
import {
  transactions,
  transactionTags,
  tags,
  categories,
  merchants,
  accounts,
  transactionSplits,
} from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import {
  parseCursor,
  encodeCursor,
} from "../../modules/reports/reports.validation";
import type { ReportsTransactionsResponse } from "@shared/reports";
import { toMoneyDto } from "../../core/money";
import type { ReportsTransactionsQuery } from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import { moneyFromValue } from "./moneyUtils";
import { allocationAmount, allocationCategoryId, allocationKey, splitAllocationJoin } from "./splitAllocation";
import Decimal from "decimal.js";
import { couponCashDescriptionFields } from "../../services/grz/couponCashDescription";
import type { TransactionType as DatabaseTransaction } from "../../utils/withTransaction";

// ISSUE-RPT-005 FIX: Define proper type for transaction type filter
type TransactionType = "income" | "expense" | "transfer";

/**
 * Repository for transaction drilldown.
 */
export class TransactionReportRepository extends BaseReportRepository {
  /**
   * Get paginated transactions with cursor
   * Original: ReportRepository lines 1823-2098
   */
  async getTransactions(
    householdId: string,
    query: QueryWithUser<ReportsTransactionsQuery>, tx?: DatabaseTransaction
  ): Promise<ReportsTransactionsResponse> {
    const cashDescription = couponCashDescriptionFields();
    const cashMerchantName = sql<string | null>`case when ${cashDescription.merchantId} is null then null else ${merchants.name} end`;
    const {
      from,
      to,
      categoryId,
      categoryGroupId,
      merchantId,
      accountId,
      tagId,
      type,
      search,
      sort = "date_desc",
      limit = 50,
      cursor,
      scope = "household",
      includePending = false,
      includeTransfers = false,
      userId,
    } = query;

    const cursorData = parseCursor(cursor);
    const baseCurrency = await this.getHouseholdCurrency(householdId, tx);

    // SCP-321: fail closed before converting — amountBase (returned per row
    // and used for amount-sorted cursors) silently converts at 1 when a rate
    // row is missing.
    await this.assertFxRatesAvailable(householdId, baseCurrency, {
      from,
      to,
      includePending,
      scope,
      userId,
    }, tx);
    const isAmountSort = sort.startsWith("amount");
    const isAsc = sort.endsWith("asc");
    // REPORTS-MONEY-001 FIX: Use Decimal for precise cursor amount comparison
    const cursorAmount =
      cursorData?.amount !== undefined
        ? new Decimal(cursorData.amount).toString()
        : undefined;

    // Build conditions
    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isExcludedFromReports, false),
      gte(transactions.date, from),
      lte(transactions.date, to),
      // NEW-14: a split transaction is listed once per split (splitAllocation.ts).
    ];

    if (categoryId) conditions.push(sql`${allocationCategoryId} = ${categoryId}::uuid`);
    if (categoryGroupId)
      conditions.push(eq(categories.groupId, categoryGroupId));
    if (merchantId) conditions.push(eq(cashDescription.merchantId, merchantId));
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (type) conditions.push(eq(transactions.type, type as TransactionType));
    if (!type && !includeTransfers) {
      conditions.push(
        sql`${transactions.type} NOT IN ('transfer', 'balance_adjustment')`
      );
    }

    if (search && search.trim().length > 0) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(cashDescription.name, pattern),
          ilike(cashDescription.notes, pattern),
          ilike(cashMerchantName, pattern)
        )!
      );
    }

    if (!includePending) {
      conditions.push(eq(transactions.isPending, false));
    }

    if (scope === "mine" && userId) {
      conditions.push(eq(transactions.ownerUserId, userId));
    }

    if (tagId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${transactionTags} tt
          WHERE tt.transaction_id = ${transactions.id}
            AND tt.tag_id = ${tagId}
        )`
      );
    }

    // Privacy filtering
    if (userId) {
      conditions.push(
        or(
          eq(transactions.isPrivate, false),
          eq(transactions.ownerUserId, userId)
        )!
      );
      conditions.push(
        or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId))!
      );
      conditions.push(
        or(
          eq(accounts.hideTransactions, false),
          isNull(accounts.hideTransactions)
        )!
      );
    }

    const currencyExpr = sql`COALESCE(${transactions.currency}, ${accounts.currency}, ${baseCurrency}::text)`;
    const fxRateExpr = this.buildFxRateExpr(
      currencyExpr,
      baseCurrency,
      sql`${transactions.date}`, { householdId }
    );
    const amountBaseExpr = sql<string | number | null>`${allocationAmount}::numeric * ${fxRateExpr}`;

    // Cursor-based pagination
    if (cursorData) {
      if (isAmountSort && cursorAmount !== undefined) {
        const amountExpr = amountBaseExpr;
        const amountCompare = isAsc
          ? sql`${amountExpr} > ${cursorAmount}::numeric`
          : sql`${amountExpr} < ${cursorAmount}::numeric`;
        const dateCompare = isAsc
          ? sql`${transactions.date} > ${cursorData.date}`
          : sql`${transactions.date} < ${cursorData.date}`;
        const idCompare = isAsc
          ? sql`${allocationKey} > ${cursorData.id}::uuid`
          : sql`${allocationKey} < ${cursorData.id}::uuid`;

        conditions.push(
          or(
            amountCompare,
            and(
              sql`${amountExpr} = ${cursorAmount}::numeric`,
              or(
                dateCompare,
                and(eq(transactions.date, cursorData.date), idCompare)
              )
            )
          )!
        );
      } else {
        const dateCompare = isAsc
          ? sql`${transactions.date} > ${cursorData.date}`
          : sql`${transactions.date} < ${cursorData.date}`;
        const idCompare = isAsc
          ? sql`${allocationKey} > ${cursorData.id}::uuid`
          : sql`${allocationKey} < ${cursorData.id}::uuid`;

        conditions.push(
          or(
            dateCompare,
            and(eq(transactions.date, cursorData.date), idCompare)
          )!
        );
      }
    }

    const fetchLimit = limit + 1;

    const rows = await (tx ?? db)
      .select({
        id: transactions.id,
        date: transactions.date,
        name: cashDescription.name,
        type: transactions.type,
        splitId: transactionSplits.id,
        amount: allocationAmount,
        amountBase: amountBaseExpr,
        transactionCurrency: transactions.currency,
        isPending: transactions.isPending,
        notes: cashDescription.notes,
        merchantId: cashDescription.merchantId,
        merchantName: cashMerchantName,
        categoryId: allocationCategoryId,
        categoryName: categories.name,
        categoryGroupId: categories.groupId,
        accountId: transactions.accountId,
        accountName: accounts.name,
        accountCurrency: accounts.currency,
        reviewedAt: transactions.reviewedAt,
        isTransferIn: transactions.isTransferIn,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .leftJoin(transactionSplits, splitAllocationJoin)
      .leftJoin(categories, sql`${categories.id} = ${allocationCategoryId}`)
      .where(and(...conditions))
      .orderBy(
        ...(isAmountSort
          ? [
              isAsc ? asc(amountBaseExpr) : desc(amountBaseExpr),
              isAsc ? asc(transactions.date) : desc(transactions.date),
              isAsc ? asc(allocationKey) : desc(allocationKey),
            ]
          : [
              isAsc ? asc(transactions.date) : desc(transactions.date),
              isAsc ? asc(allocationKey) : desc(allocationKey),
            ])
      )
      .limit(fetchLimit);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? encodeCursor(
            lastItem.date,
            lastItem.splitId ?? lastItem.id,
            isAmountSort ? (lastItem.amountBase ?? undefined) : undefined
          )
        : null;

    const transactionIds = items.map((row) => row.id);
    const tagsByTransaction = new Map<
      string,
      Array<{ id: string; name: string }>
    >();

    if (transactionIds.length > 0) {
      const tagRows = await (tx ?? db)
        .select({
          transactionId: transactionTags.transactionId,
          tagId: tags.id,
          tagName: tags.name,
        })
        .from(transactionTags)
        .leftJoin(tags, eq(tags.id, transactionTags.tagId))
        .where(inArray(transactionTags.transactionId, transactionIds));

      for (const row of tagRows) {
        if (!row.tagId || !row.tagName) continue;
        const existing = tagsByTransaction.get(row.transactionId) || [];
        existing.push({ id: row.tagId, name: row.tagName });
        tagsByTransaction.set(row.transactionId, existing);
      }
    }

    return {
      page: { limit, nextCursor },
      items: items.map((row) => {
        const rowCurrency = this.getEffectiveCurrency(
          row.transactionCurrency,
          row.accountCurrency,
          baseCurrency
        );
        const amount = moneyFromValue(row.amount, rowCurrency);
        const baseAmount = moneyFromValue(row.amountBase, baseCurrency);
        const isNegative =
          row.type === "expense" ||
          (row.type === "transfer" && row.isTransferIn === false);

        return {
          id: row.id,
          splitId: row.splitId ?? null,
          date: row.date,
          name: row.name,
          type: row.type as "income" | "expense" | "transfer",
          amount: toMoneyDto(amount, rowCurrency),
          signedAmount: toMoneyDto(
            isNegative ? amount.negated() : amount,
            rowCurrency
          ),
          currency: rowCurrency,
          baseCurrency,
          amountBase: toMoneyDto(baseAmount, baseCurrency),
          signedAmountBase: toMoneyDto(
            isNegative ? baseAmount.negated() : baseAmount,
            baseCurrency
          ),
          isPending: row.isPending,
          notes: row.notes,
          reviewedAt:
            row.reviewedAt instanceof Date
              ? row.reviewedAt.toISOString()
              : typeof row.reviewedAt === "string"
                ? row.reviewedAt
                : null,
          merchant: row.merchantId
            ? { id: row.merchantId, name: row.merchantName || "Unknown" }
            : null,
          category: row.categoryId
            ? {
                id: row.categoryId,
                name: row.categoryName || "Uncategorized",
                groupId: row.categoryGroupId || "",
              }
            : null,
          account: row.accountId
            ? { id: row.accountId, name: row.accountName || "Unknown" }
            : null,
          tags: tagsByTransaction.get(row.id) || null,
        };
      }),
    };
  }
}

// Singleton instance
export const transactionReportRepository = new TransactionReportRepository();
