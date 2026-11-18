import { sql, and, eq, gte, lte, isNull, or } from "drizzle-orm";
import { transactions, accounts } from "@shared/schema";
import { Money } from "../../core/money";
import { moneyFromValue } from "./moneyUtils";

export interface SankeyFilters {
  householdId: string;
  from: string;
  to: string;
  baseCurrency: string;
  scope: "household" | "mine";
  userId?: string;
  includePending: boolean;
  includeTransfers: boolean;
}

export interface SankeyNode {
  id: string;
  label?: string;
  nodeColor?: string;
  entityType?:
    | "categoryGroup"
    | "category"
    | "merchant"
    | "account"
    | "synthetic";
  entityId?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: Money;
  meta?: { entityType?: string; entityId?: string };
}

export interface TransactionRow {
  amountBase: string | number | null;
}

export interface GroupTotal {
  name: string;
  color: string | null;
  total: Money;
}

export interface CategoryTotal {
  name: string;
  color: string | null;
  groupId: string;
  groupName: string;
  total: Money;
}

export function buildSankeyBaseConditions(filters: SankeyFilters) {
  const conditions = [
    eq(transactions.householdId, filters.householdId),
    eq(transactions.isExcludedFromReports, false),
    isNull(transactions.deletedAt),
    gte(transactions.date, filters.from),
    lte(transactions.date, filters.to),
    or(eq(accounts.hideTransactions, false), isNull(accounts.hideTransactions)),
    sql`NOT EXISTS (
      SELECT 1 FROM transaction_splits
      WHERE transaction_splits.transaction_id = ${transactions.id}
    )`,
  ];

  if (filters.scope === "mine" && filters.userId) {
    conditions.push(eq(transactions.ownerUserId, filters.userId));
  }

  if (!filters.includePending) {
    conditions.push(eq(transactions.isPending, false));
  }

  if (filters.userId) {
    conditions.push(
      or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, filters.userId))
    );
    conditions.push(
      or(
        eq(transactions.isPrivate, false),
        eq(transactions.ownerUserId, filters.userId)
      )
    );
  }

  return conditions;
}

export function getIncomeTypeCondition(includeTransfers: boolean) {
  return includeTransfers
    ? or(
        eq(transactions.type, "income"),
        and(
          eq(transactions.type, "transfer"),
          eq(transactions.isTransferIn, true)
        )
      )
    : eq(transactions.type, "income");
}

export function getExpenseTypeCondition(includeTransfers: boolean) {
  return includeTransfers
    ? or(
        eq(transactions.type, "expense"),
        and(
          eq(transactions.type, "transfer"),
          eq(transactions.isTransferIn, false)
        )
      )
    : eq(transactions.type, "expense");
}

export function calculateTotalIncome(
  rows: TransactionRow[],
  baseCurrency: string
): Money {
  return rows.reduce(
    (sum, row) => sum.add(moneyFromValue(row.amountBase, baseCurrency)),
    Money.zero(baseCurrency)
  );
}
