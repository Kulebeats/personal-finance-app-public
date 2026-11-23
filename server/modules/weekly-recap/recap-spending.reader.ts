import { sql } from "drizzle-orm";
import { accounts, categories, categoryGroups, transactions, transactionSplits } from "@shared/schema";
import type { SpendingData } from "@shared/weekly-recap";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { CalculationError } from "../../core/calculations/errors";
import { Money, roundMoney } from "../../core/money";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { providerFlowRate } from "../../repositories/reports/providerFxQuote";

export type DigestSpendGroup = { current: boolean; id: string | null; label: string; amount: string; total: string; missing: boolean };

/** Both totals, ranked labels and rate checks use the same eligible split rows. */
export function digestSpendingQuery(actor: HouseholdContext, from: string, to: string, currency: string) {
  const rate = providerFlowRate(sql`COALESCE(${transactions.currency}, ${accounts.currency})`,
    currency, sql`${transactions.date}`);
  return sql`
    WITH expense AS (
      SELECT ${transactions.date} >= ${from}::date AS current,
        CASE WHEN ${categoryGroups.id} IS NOT NULL THEN ${categories.id} END AS id,
        CASE WHEN ${categoryGroups.id} IS NOT NULL THEN ${categories.name} ELSE 'Uncategorized' END AS label,
        COALESCE(${transactionSplits.amount}, ${transactions.amount}) AS raw_amount, ${rate} AS rate
      FROM ${transactions}
      INNER JOIN ${accounts} ON ${accounts.id} = ${transactions.accountId}
      LEFT JOIN ${transactionSplits} ON ${transactionSplits.transactionId} = ${transactions.id}
      LEFT JOIN ${categories} ON ${categories.id} = COALESCE(${transactionSplits.categoryId}, ${transactions.categoryId})
        AND ${categories.householdId} = ${actor.householdId} AND ${categories.deletedAt} IS NULL
      LEFT JOIN ${categoryGroups} ON ${categoryGroups.id} = ${categories.groupId} AND ${categoryGroups.householdId} = ${actor.householdId}
      WHERE ${visibleTransactionPredicate(actor)} AND ${transactions.date} BETWEEN (${from}::date - 7) AND ${to}::date
        AND ${transactions.type} = 'expense' AND ${transactions.isPending} = false
        AND ${transactions.isExcludedFromReports} = false AND ${accounts.hideTransactions} IS NOT TRUE
    ), grouped AS (
      SELECT current, id, label, SUM(raw_amount * rate) AS amount,
        bool_or(rate IS NULL OR rate <= 0 OR rate::text IN ('NaN', 'Infinity', '-Infinity')) AS missing
      FROM expense GROUP BY current, id, label
    ), ranked AS (
      SELECT current, id, label, amount, SUM(amount) OVER (PARTITION BY current) AS total,
        bool_or(missing) OVER (PARTITION BY current) AS missing,
        row_number() OVER (PARTITION BY current ORDER BY amount DESC, label, id) AS rank
      FROM grouped
    )
    SELECT current, id, label, amount::text, total::text, missing FROM ranked
    WHERE rank <= CASE WHEN current THEN 5 ELSE 1 END ORDER BY current DESC, rank
  `;
}

export function formatDigestSpending(groups: DigestSpendGroup[], currency: string): SpendingData {
  if (groups.some(row => row.missing)) throw new CalculationError("MISSING_FX_RATE");
  const rows = groups.filter(row => row.current);
  const precision = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const rounded = (amount: string) => new Money(roundMoney(amount, precision), currency);
  const total = rounded(rows[0]?.total ?? "0");
  const previous = rounded(groups.find(row => !row.current)?.total ?? "0");
  return {
    total: total.toNumber(), hasData: rows.length > 0, trend: [],
    changePercent: previous.amount.gt(0) ? total.amount.minus(previous.amount).div(previous.amount).times(100).toDecimalPlaces(2).toNumber() : 0,
    topCategories: rows.map(row => ({
      categoryId: row.id ?? "uncategorized", name: row.label, amount: rounded(row.amount).toNumber(),
      percent: total.isZero() ? 0 : rounded(row.amount).amount.div(total.amount).times(100).toDecimalPlaces(2).toNumber(),
    })),
  };
}
