/**
 * Account CSV sign rule (FIN-04), shared by the account transaction export
 * and the account transaction import.
 *
 * The CSV amount is the row's direction, the same on every account class:
 * positive brings money in (income, transfer in, asset settlement), negative
 * takes it out (expense, transfer out). A card purchase is negative although
 * it raises the balance owed; the posting core applies the account class
 * (accounts.is_asset) when the row is posted, so the CSV must not apply it
 * too. A balance adjustment is written as the ordinary row with the same
 * effect: on an asset an increase is positive, on a liability an increase
 * (more owed) is negative.
 *
 * Round trip: the export sign is the posted effect seen through the class,
 * and the import posts that sign back through the same class, so an exported
 * row re-imports with the same effect. Transfers, settlements and balance
 * adjustments come back as ordinary income or expense rows: the import never
 * creates the counter-leg or the adjustment.
 *
 * @module services/account/accountCsvSign
 */
import { Money } from "../../core/money";
import {
  calculateSignedAccountEffect,
  type PostingAccount,
  type PostingInput,
} from "../../repositories/TransactionPostingEffect";

export type ImportDirection = "income" | "expense";

/** The signed amount the account export writes for one stored row. */
export function accountCsvAmount(account: PostingAccount, row: PostingInput): Money {
  const effect = calculateSignedAccountEffect(account, row);
  return account.isAsset ? effect : effect.negated();
}

/** The ordinary row kind the account import creates for a signed CSV amount. */
export function importDirection(amount: Money): ImportDirection {
  return amount.gte(0) ? "income" : "expense";
}
