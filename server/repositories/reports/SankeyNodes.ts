import { sql, and, eq, gte, lte, isNull, or } from "drizzle-orm";
import { transactions, accounts } from "@shared/schema";
import { Money } from "../../core/money";
import { moneyFromValue } from "./moneyUtils";
import { flowExpense, flowIncome } from "./flowClassification";

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
    // NEW-14: split transactions are read, not dropped; expense queries join
    // their split rows (splitAllocation.ts), income totals use the parent.
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

// NEW-06: the shared flow rule; a transfer touching a liability (a card
// repayment) is never income or expense, even with includeTransfers on.
const sankeyFlowCols = {
  type: sql`${transactions.type}`, isTransferIn: sql`${transactions.isTransferIn}`,
  accountId: sql`${transactions.accountId}`, transferAccountId: sql`${transactions.transferAccountId}`,
};

export function getIncomeTypeCondition(includeTransfers: boolean) {
  return flowIncome(sankeyFlowCols, includeTransfers);
}

export function getExpenseTypeCondition(includeTransfers: boolean) {
  return flowExpense(sankeyFlowCols, includeTransfers);
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
