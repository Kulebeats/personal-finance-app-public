/** Trusted transaction-date valuation for Thandi's four financial-flow tools. */
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { accounts, categories, merchants, transactions } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { db } from "../../db";
import { Money } from "../../core/money";
import { providerFlowRate } from "../../repositories/reports/providerFxQuote";
import { requireFinancialReadActor, transactionPrivacyFilters } from "./ai.privacy-filters";
import type { CategoryTrendResult, MonthlyTrendResult, QueryContext, SpendingByCategoryResult, TopMerchantResult } from "./ai.types";

type FlowRange = { from: string; to: string };
type FlowGrouping =
  | { by: "category"; categoryId?: string }
  | { by: "merchant" }
  | { by: "type" };

/** Sum native flows by date, captured unit and the dimension the tool requested. */
async function readFlowGroups(context: QueryContext, { from, to }: FlowRange, grouping: FlowGrouping) {
  const actor = requireFinancialReadActor(context);
  const labels = grouping.by === "category" ? categories : grouping.by === "merchant" ? merchants : undefined;
  const groupId = labels ? sql<string | null>`${labels.id}` : sql<string | null>`NULL`;
  const groupName = labels ? sql<string | null>`${labels.name}` : sql<string | null>`NULL`;
  const rate = providerFlowRate(
    sql`${transactions.currency}`,
    context.currency,
    sql`${transactions.date}`,
    sql`transaction_timestamp()`,
  );
  const query = db.select({
    groupId,
    groupName,
    date: transactions.date,
    sourceCurrency: transactions.currency,
    type: transactions.type,
    total: sql<string>`SUM(${transactions.amount})`,
    count: sql<number>`COUNT(*)::int`,
    rate: sql<string | null>`(${rate})::text`,
  }).from(transactions).innerJoin(accounts, eq(transactions.accountId, accounts.id));

  // The transaction FK permits historical cross-household references. Only a
  // label and key from the signed household can identify a returned group.
  const joined = labels ? query.leftJoin(labels, and(
    eq(labels.id, grouping.by === "category" ? transactions.categoryId : transactions.merchantId),
    eq(labels.householdId, actor.householdId),
  )) : query;

  return joined.where(and(
    ...transactionPrivacyFilters(actor),
    grouping.by === "type"
      ? or(eq(transactions.type, "income"), eq(transactions.type, "expense"))
      : eq(transactions.type, "expense"),
    gte(transactions.date, from),
    lte(transactions.date, to),
    grouping.by === "merchant" ? isNotNull(merchants.id) : undefined,
    grouping.by === "category" && grouping.categoryId ? eq(categories.id, grouping.categoryId) : undefined,
  )).groupBy(transactions.date, transactions.currency, transactions.type, ...(labels ? [groupId, groupName] : []));
}

type FlowGroup = Awaited<ReturnType<typeof readFlowGroups>>[number];

function converted(row: FlowGroup, currency: string): Money | null {
  // No account/household-unit guess for uncaptured legacy denomination.
  if (!isCurrencyCode(row.sourceCurrency) || row.rate === null) return null;
  const rate = new Money(row.rate);
  const native = new Money(row.total, row.sourceCurrency);
  if (!rate.amount.isFinite() || !rate.isPositive() || !native.amount.isFinite()) return null;
  return new Money(native.multiply(rate.amount).amount, currency);
}

function add(total: Money | null, value: Money | null): Money | null {
  return total && value ? total.add(value) : null;
}

/** Unknown values come first so a display limit cannot hide every missing group. */
function compareAmounts(a: Money | null, b: Money | null): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  return a.gt(b) ? -1 : a.lt(b) ? 1 : 0;
}

export async function readCategorySpending(context: QueryContext, range: FlowRange): Promise<SpendingByCategoryResult[]> {
  const groups = new Map<string | null, SpendingByCategoryResult>();
  for (const row of await readFlowGroups(context, range, { by: "category" })) {
    const current = groups.get(row.groupId) ?? {
      category: row.groupName || "Uncategorized",
      amount: Money.zero(context.currency),
      transactionCount: 0,
      percentOfTotal: 0,
    };
    current.amount = add(current.amount, converted(row, context.currency));
    current.transactionCount += row.count;
    groups.set(row.groupId, current);
  }
  const results = Array.from(groups).sort(([aId, a], [bId, b]) => compareAmounts(a.amount, b.amount)
    || a.category.localeCompare(b.category)
    || (aId ?? "").localeCompare(bId ?? ""));
  const total = results.reduce<Money | null>((sum, [, row]) => add(sum, row.amount), Money.zero(context.currency));
  return results.map(([, row]) => ({
    ...row,
    percentOfTotal: row.amount && total ? percent(row.amount, total) : null,
  }));
}

export async function readMerchantSpending(context: QueryContext, range: FlowRange, limit: number): Promise<TopMerchantResult[]> {
  const groups = new Map<string, TopMerchantResult>();
  for (const row of await readFlowGroups(context, range, { by: "merchant" })) {
    if (!row.groupId) continue;
    const current = groups.get(row.groupId) ?? {
      merchantId: row.groupId,
      merchantName: row.groupName || "Unknown Merchant",
      totalSpent: Money.zero(context.currency),
      transactionCount: 0,
      avgTransactionAmount: null,
    };
    current.totalSpent = add(current.totalSpent, converted(row, context.currency));
    current.transactionCount += row.count;
    groups.set(row.groupId, current);
  }
  const results = Array.from(groups.values());
  const missing = results.some(row => row.totalSpent === null);
  return results
    .sort((a, b) => compareAmounts(a.totalSpent, b.totalSpent)
      || a.merchantName.localeCompare(b.merchantName)
      || a.merchantId.localeCompare(b.merchantId))
    .slice(0, limit)
    .map(row => ({
      ...row,
      avgTransactionAmount: row.totalSpent?.divide(row.transactionCount.toString()) ?? null,
      ...(missing ? { rankingAvailability: "unavailable" as const } : {}),
    }));
}

function percent(value: Money, total: Money): number {
  return total.isPositive() ? value.divide(total.amount).multiply("100").toNumber() : 0;
}

function direction(points: CategoryTrendResult["points"], currency: string): CategoryTrendResult["trendDirection"] {
  const values = points.map(point => point.amount);
  if (values.some(value => value === null)) return "unavailable";
  const known = values.filter((value): value is Money => value !== null);
  if (known.length < 2) return "flat";
  const middle = Math.floor(known.length / 2);
  const average = (items: Money[]) => items.reduce((sum, value) => sum.add(value), Money.zero(currency)).divide(items.length.toString());
  const firstAvg = average(known.slice(0, middle));
  const secondAvg = average(known.slice(middle));
  const change = percent(secondAvg.subtract(firstAvg), firstAvg);
  if (change > 10 || (firstAvg.isZero() && secondAvg.isPositive())) return "up";
  if (change < -10 || (firstAvg.isZero() && secondAvg.isNegative())) return "down";
  return "flat";
}

export async function readCategoryTrends(context: QueryContext, range: FlowRange, categoryId?: string): Promise<CategoryTrendResult[]> {
  const categoriesById = new Map<string, { name: string; months: Map<string, Money | null> }>();
  for (const row of await readFlowGroups(context, range, { by: "category", categoryId })) {
    if (!row.groupId) continue;
    const current = categoriesById.get(row.groupId) ?? {
      name: row.groupName || "Uncategorized",
      months: new Map<string, Money | null>(),
    };
    const month = row.date.slice(0, 7);
    const previous = current.months.get(month);
    const total = previous === undefined ? Money.zero(context.currency) : previous;
    current.months.set(month, add(total, converted(row, context.currency)));
    categoriesById.set(row.groupId, current);
  }
  return Array.from(categoriesById, ([id, value]) => {
    const points = Array.from(value.months, ([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month));
    return { categoryId: id, categoryName: value.name, points, trendDirection: direction(points, context.currency) };
  }).sort((a, b) => {
    const aUnavailable = a.trendDirection === "unavailable";
    const bUnavailable = b.trendDirection === "unavailable";
    if (aUnavailable !== bUnavailable) return aUnavailable ? -1 : 1;
    return a.categoryName.localeCompare(b.categoryName) || a.categoryId.localeCompare(b.categoryId);
  });
}

export async function readMonthlySummary(context: QueryContext, month: string, range: FlowRange): Promise<MonthlyTrendResult> {
  const rows = await readFlowGroups(context, range, { by: "type" });
  const total = (type: "income" | "expense") => rows.filter(row => row.type === type)
    .reduce<Money | null>((sum, row) => add(sum, converted(row, context.currency)), Money.zero(context.currency));
  const income = total("income");
  const expenses = total("expense");
  const netSavings = income && expenses ? income.subtract(expenses) : null;
  const savingsRate = income && netSavings ? percent(netSavings, income) : null;
  return { month, income, expenses, netSavings, savingsRate };
}
