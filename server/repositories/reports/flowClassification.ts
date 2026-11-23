/**
 * How one transaction row counts in cash-flow readers (NEW-06, spec R12.2).
 *
 *  - An income or expense row counts as income or expense on ANY account. A
 *    purchase on a credit card is an expense in its category, the same as a
 *    purchase from a bank account.
 *  - A transfer with a liability account on either side is a debt movement (a
 *    repayment, or a cash advance). It is never income or expense, even with
 *    "include transfers" on, so a repayment never counts the purchase twice.
 *  - The repayment leg (the liability account receiving money) is reported on
 *    its own as debt paid.
 *  - Any other transfer counts only when the reader's includeTransfers is on.
 *
 * Callers pass their own column references, so this works for raw SQL with
 * aliases (`t.type`) and for Drizzle column objects alike.
 */
import { sql, type SQL } from "drizzle-orm";
import { accounts } from "@shared/schema";

export interface FlowColumns {
  readonly type: SQL;
  readonly isTransferIn: SQL;
  readonly accountId: SQL;
  readonly transferAccountId: SQL;
}

const isLiabilityAccount = (accountId: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${accounts} fla WHERE fla.id = ${accountId} AND fla.is_asset = FALSE)`;

/** True when either side of a transfer is a liability account. */
function isDebtMovement(c: FlowColumns): SQL {
  return sql`(${c.type} = 'transfer' AND (${isLiabilityAccount(c.accountId)} OR ${isLiabilityAccount(c.transferAccountId)}))`;
}

function isPlainTransfer(c: FlowColumns, isIn: boolean): SQL {
  return sql`(${c.type} = 'transfer' AND ${c.isTransferIn} = ${isIn} AND NOT ${isDebtMovement(c)})`;
}

/** Rows that count as income. */
export function flowIncome(c: FlowColumns, includeTransfers: boolean): SQL {
  return includeTransfers ? sql`(${c.type} = 'income' OR ${isPlainTransfer(c, true)})` : sql`(${c.type} = 'income')`;
}

/** Rows that count as expense: card purchases included. */
export function flowExpense(c: FlowColumns, includeTransfers: boolean): SQL {
  return includeTransfers ? sql`(${c.type} = 'expense' OR ${isPlainTransfer(c, false)})` : sql`(${c.type} = 'expense')`;
}

/** The repayment leg: money arriving on a liability account by transfer. */
export function flowDebtRepayment(c: FlowColumns): SQL {
  return sql`(${c.type} = 'transfer' AND ${c.isTransferIn} = TRUE AND ${isLiabilityAccount(c.accountId)})`;
}

/** Rows a cash-flow reader must read: anything one of the buckets above can count. */
export function flowRowFilter(c: FlowColumns, includeTransfers: boolean): SQL {
  return includeTransfers
    ? sql`(${c.type} IN ('income', 'expense', 'transfer'))`
    : sql`(${c.type} IN ('income', 'expense') OR ${flowDebtRepayment(c)})`;
}
