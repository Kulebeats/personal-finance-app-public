import { sql } from "drizzle-orm";
import { accounts, budgets, budgetPeriods, categories, transactions, transactionSplits } from "@shared/schema";
import { db } from "../db";
import { readableMembershipPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { BudgetDenominationUnavailable } from "../core/money/budget-denomination";

type CategoryLimit = { categoryId: string; categoryName: string; amount: string; currency: string; spent: string; missingConversion: boolean };

/** Read limits and their visible posted allocations from one database snapshot. */
export async function readCurrentCategoryBudgetLimits(householdId: string, userId: string, currency: string, first: string, last: string) {
  const actor = { householdId, userId, role: "member" as const };
  const result = await db.execute<CategoryLimit>(sql`
    WITH limits AS (
      SELECT b.id, b.category_id, c.name, coalesce(p.budget_amount, b.amount) AS amount, coalesce(p.currency,b.currency) AS currency
      FROM ${budgets} b JOIN ${categories} c ON c.id=b.category_id AND c.household_id=b.household_id
      LEFT JOIN ${budgetPeriods} p ON p.budget_id=b.id AND p.start_date=${first} AND p.end_date=${last}
      WHERE b.household_id=${householdId} AND b.is_active AND coalesce(p.budget_amount,b.amount) IS NOT NULL
        AND ${readableMembershipPredicate(actor)}
    ), allocations AS (
      SELECT CASE WHEN s.id IS NULL THEN ${transactions.categoryId} ELSE s.category_id END AS category_id,
        coalesce(s.amount, ${transactions.amount}) AS amount, ${transactions.currency} AS currency
      FROM ${transactions}
      JOIN ${accounts} ON ${accounts.id}=${transactions.accountId}
      LEFT JOIN ${transactionSplits} s ON s.transaction_id=${transactions.id}
      WHERE ${visibleTransactionPredicate(actor)} AND ${transactions.date} BETWEEN ${first} AND ${last}
        AND ${transactions.type}='expense' AND ${transactions.isPending}=false
        AND ${transactions.status} IS DISTINCT FROM 'pending' AND ${transactions.isExcludedFromBudget}=false
        AND ${transactions.isExcludedFromReports}=false
        AND ${accounts.hideTransactions}=false AND ${accounts.isArchived}=false
    )
    SELECT l.category_id AS "categoryId", l.name AS "categoryName", l.amount::text, l.currency,
      coalesce(sum(a.amount) FILTER (WHERE a.currency=${currency}),0)::text AS spent,
      coalesce(bool_or(a.amount<>0 AND a.currency IS DISTINCT FROM ${currency}),false) AS "missingConversion"
    FROM limits l LEFT JOIN allocations a ON a.category_id=l.category_id
    GROUP BY l.id,l.category_id,l.name,l.amount,l.currency ORDER BY l.id
  `);
  if (result.rows.some(row => row.missingConversion)) throw new BudgetDenominationUnavailable();
  return result.rows;
}
