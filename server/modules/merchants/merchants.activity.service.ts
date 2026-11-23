/**
 * Merchant detail reads (ORG-006): spending analytics and the transaction list
 * behind GET /merchants/:id/analytics and GET /merchants/:id/transactions.
 *
 * - Household-scoped: an unknown or other-household merchant is 404. An
 *   archived (inactive) merchant still answers, because its history remains.
 * - Visibility: rows go through the shared transaction visibility predicate,
 *   so another member's private accounts and private transactions are never
 *   read (Rule 11), and deleted rows are excluded.
 * - Money: every amount is a MoneyDto in the household currency, converted
 *   per row with the household FX lookup used by reports (the household's own
 *   rate for the row's date, else the shared rate on or before it). Before any
 *   amount is converted, every non-base currency and date among the rows is
 *   checked; a missing rate is a 422 MISSING_FX_RATE, never rate 1.
 * - Splits: a split transaction is counted once, under the parent's merchant
 *   with the parent's amount. The split-row helper (#211) is not on this ref.
 * - Analytics counts what spending reports count: posted expenses that are
 *   not excluded from reports, on accounts that do not hide their
 *   transactions. The list shows every visible transaction of the merchant.
 *
 * @module modules/merchants/activity.service
 */

import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { accounts, households, merchants, transactions } from "@shared/schema";
import type { MoneyDto } from "@shared/money";
import { db } from "../../db";
import { NotFoundError } from "../../core/errors";
import { CalculationError } from "../../core/calculations/errors";
import { Money, toMoneyDto } from "../../core/money";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { couponCashDescriptionFields } from "../../services/grz/couponCashDescription";
import { buildFxRateExpr, resolvedFxRate } from "../../repositories/reports/fxRateExpr";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { logger } from "../../utils/logger";
import type { MerchantAnalyticsQuery, MerchantTransactionsQuery } from "./merchants.validation";

export interface MerchantAnalytics {
  totalSpent: MoneyDto;
  transactionCount: number;
  averageTransaction: MoneyDto;
  trend: Array<{ period: string; total: MoneyDto; count: number }>;
}

export interface MerchantTransactionRow {
  id: string;
  date: string;
  name: string;
  type: string;
  amount: MoneyDto;
  isPending: boolean;
  notes: string | null;
  accountId: string;
}

export interface MerchantTransactionsPage {
  transactions: MerchantTransactionRow[];
  /** `count` is the number of rows matching the filters, across all pages. */
  pagination: { limit: number; offset: number; count: number };
}

async function assertMerchantInHousehold(actor: HouseholdContext, merchantId: string): Promise<void> {
  const [row] = await db.select({ id: merchants.id }).from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.householdId, actor.householdId)))
    .limit(1);
  if (!row) throw new NotFoundError("Merchant not found");
}

async function householdCurrency(householdId: string): Promise<string> {
  const [row] = await db.select({ currency: households.currency }).from(households)
    .where(eq(households.id, householdId)).limit(1);
  if (!row?.currency) throw new NotFoundError("Household not found");
  return row.currency.toUpperCase();
}

const currencyOf = (base: string): SQL => sql`COALESCE(${transactions.currency}, ${accounts.currency}, ${base}::text)`;

/** A row's amount in the household currency (statement fails if a rate is missing). */
function convertedAmount(householdId: string, base: string): SQL {
  const rate = buildFxRateExpr(currencyOf(base), base, sql`${transactions.date}`, { householdId });
  return sql`(${transactions.amount}::numeric * ${rate})`;
}

function dateRange(query: { startDate?: string; endDate?: string }): SQL[] {
  const conditions: SQL[] = [];
  if (query.startDate) conditions.push(gte(transactions.date, query.startDate));
  if (query.endDate) conditions.push(lte(transactions.date, query.endDate));
  return conditions;
}

/** Fail closed: every non-base currency and date among the rows needs a rate. */
async function assertRatesAvailable(householdId: string, base: string, where: SQL): Promise<void> {
  const currency = currencyOf(base);
  const [missing] = await db
    .select({ currency: sql<string>`${currency}`, date: transactions.date })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(
      where,
      sql`${currency} <> ${base}::text`,
      sql`${resolvedFxRate(householdId, currency, base, sql`${transactions.date}`)} IS NULL`,
    ))
    .orderBy(asc(transactions.date))
    .limit(1);
  if (!missing) return;
  logger.error("Missing FX rate for merchant activity", {
    householdId, fromCurrency: missing.currency, toCurrency: base, date: missing.date,
  });
  throw new CalculationError(
    "MISSING_FX_RATE",
    { from: missing.currency, to: base, date: missing.date },
    `Exchange rate unavailable for ${missing.currency} -> ${base} on ${missing.date}`,
  );
}

export async function getMerchantAnalytics(
  actor: HouseholdContext,
  merchantId: string,
  query: MerchantAnalyticsQuery,
): Promise<MerchantAnalytics> {
  await assertMerchantInHousehold(actor, merchantId);
  const base = await householdCurrency(actor.householdId);
  const where = and(
    eq(transactions.merchantId, merchantId),
    visibleTransactionPredicate(actor),
    eq(transactions.type, "expense"),
    eq(transactions.isPending, false),
    eq(transactions.isExcludedFromReports, false),
    eq(accounts.hideTransactions, false),
    ...dateRange(query),
  )!;
  await assertRatesAvailable(actor.householdId, base, where);

  const period = query.groupBy === "day"
    ? sql<string>`to_char(${transactions.date}, 'YYYY-MM-DD')`
    : sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await db
    .select({
      period,
      total: sql<string>`sum(${convertedAmount(actor.householdId, base)})::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(where)
    .groupBy(period)
    .orderBy(period);

  const trend = rows.map((row) => ({ period: row.period, total: new Money(row.total, base), count: row.count }));
  const totalSpent = trend.reduce((sum, point) => sum.add(point.total), Money.zero(base));
  const transactionCount = trend.reduce((sum, point) => sum + point.count, 0);
  const average = transactionCount > 0 ? totalSpent.divide(transactionCount) : Money.zero(base);
  return {
    totalSpent: toMoneyDto(totalSpent, base),
    transactionCount,
    averageTransaction: toMoneyDto(average, base),
    trend: trend.map((point) => ({ period: point.period, total: toMoneyDto(point.total, base), count: point.count })),
  };
}

export async function listMerchantTransactions(
  actor: HouseholdContext,
  merchantId: string,
  query: MerchantTransactionsQuery,
): Promise<MerchantTransactionsPage> {
  await assertMerchantInHousehold(actor, merchantId);
  const base = await householdCurrency(actor.householdId);
  const candidates = and(
    eq(transactions.merchantId, merchantId),
    visibleTransactionPredicate(actor),
    ...dateRange(query),
    ...(query.categoryId ? [eq(transactions.categoryId, query.categoryId)] : []),
  )!;
  // The amount filters compare converted amounts, so check rates first.
  await assertRatesAvailable(actor.householdId, base, candidates);

  const amount = convertedAmount(actor.householdId, base);
  // R1-05: GRZ cash reads as the ledger does; a withheld coupon has no merchant there either.
  const cash = couponCashDescriptionFields();
  const where = and(
    candidates,
    sql`${cash.merchantId} is not null`,
    ...(query.minAmount !== undefined ? [sql`${amount} >= ${query.minAmount}::numeric`] : []),
    ...(query.maxAmount !== undefined ? [sql`${amount} <= ${query.maxAmount}::numeric`] : []),
  )!;
  const [rows, [total]] = await Promise.all([
    db.select({
      id: transactions.id,
      date: transactions.date,
      name: cash.name,
      type: transactions.type,
      amount: sql<string>`(${amount})::text`,
      isPending: transactions.isPending,
      notes: cash.notes,
      accountId: transactions.accountId,
    })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where),
  ]);

  return {
    transactions: rows.map((row) => ({ ...row, amount: toMoneyDto(row.amount, base) })),
    pagination: { limit: query.limit, offset: query.offset, count: total?.count ?? 0 },
  };
}
