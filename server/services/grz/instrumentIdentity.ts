import { getTableName, sql, type Column, type SQL, type SQLWrapper } from "drizzle-orm";
import { accounts, grzBonds, grzTBills, investmentTransactions } from "@shared/schema";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";

/** Labels a row carries when its custody was private when it was written (bondSale.ts, tbillSettlement.ts). */
export const GENERIC_BOND_SALE_NOTE = "GRZ Bond Sale";
export const GENERIC_TBILL_MATURITY_NOTE = "Maturity Payout: T-Bill";
export const GENERIC_TBILL_TAX_NAME = "GRZ T-Bill";

/**
 * R1-05: a GRZ instrument's name and ISIN reach a reader only while that reader
 * can see the instrument's custody account. A bill or bond with no custody
 * account is never visible here. Read-time only: stored text is never rewritten.
 */
export function custodyVisible(custodyAccountId: SQLWrapper, actor: HouseholdContext): SQL {
  return sql`exists (select 1 from ${accounts} where ${qualified(accounts.id)} = ${custodyAccountId} and ${visibleAccountPredicate(actor)})`;
}

/**
 * A column written as "table"."column" in every context. Drizzle leaves columns
 * unqualified in a single-table select list, where an outer `"id"` inside a
 * correlated subquery would rebind to the inner table's own `id`.
 */
export function qualified(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * Investment activity notes as this viewer may read them. A bond sale or T-bill
 * maturity whose custody the viewer cannot see reads its generic label; every
 * other row keeps its stored notes.
 */
export function investmentNotesProjection(actor: HouseholdContext): SQL<string | null> {
  const outer = { id: qualified(investmentTransactions.id), householdId: qualified(investmentTransactions.householdId),
    linkedTransactionId: qualified(investmentTransactions.linkedTransactionId) };
  return sql<string | null>`case
    when exists (select 1 from ${grzBonds} where ${qualified(grzBonds.saleCashTransactionId)} = ${outer.linkedTransactionId}
      and ${qualified(grzBonds.householdId)} = ${outer.householdId} and not ${custodyVisible(qualified(grzBonds.accountId), actor)})
      then ${GENERIC_BOND_SALE_NOTE}
    when exists (select 1 from ${grzTBills} where ${qualified(grzTBills.maturityInvestmentTxId)} = ${outer.id}
      and ${qualified(grzTBills.householdId)} = ${outer.householdId} and not ${custodyVisible(qualified(grzTBills.accountId), actor)})
      then ${GENERIC_TBILL_MATURITY_NOTE}
    else ${qualified(investmentTransactions.notes)} end`;
}
