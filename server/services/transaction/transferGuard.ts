/**
 * Transfer update guard
 *
 * A transfer is two linked legs kept in sync by updateTransfer, which changes
 * both atomically. The generic updateTransaction path must not break that: this
 * guard rejects both type changes to/from transfer and material single-leg
 * edits (amount/account/date/currency) that would desync the pair and its
 * balance reversals. Amount is compared with Decimal equality so an idempotent
 * full-object PUT with an unchanged amount still passes.
 *
 * @module services/transaction/transferGuard
 */

import Decimal from "decimal.js";
import { type Transaction } from "@shared/schema";
import { ValidationError } from "../../utils/errorHandler";

const TRANSFER_LEG_MESSAGE =
  "Use the transfer update endpoint so both legs stay in sync";

/**
 * Guard the generic updateTransaction path against edits that would break a
 * transfer pair: (1) changing a transaction's type to/from transfer, and
 * (2) materially editing a single leg (amount/account/date/currency). No-op
 * for ordinary transactions and for unchanged fields. Amount uses Decimal
 * equality so an idempotent full-object PUT with an unchanged amount passes.
 */
export function assertTransferUpdateAllowed(
  existing: Transaction,
  data: Partial<Transaction>,
): void {
  if (
    data.type &&
    (data.type === "transfer" || existing.type === "transfer")
  ) {
    throw new ValidationError("Cannot change transaction type to/from transfer", [
      { field: "type", message: "Delete and recreate the transaction instead" },
    ]);
  }

  if (existing.type !== "transfer") return;

  const materialChanges: Array<{ field: string; message: string }> = [];

  if (
    data.amount !== undefined &&
    !new Decimal(data.amount).eq(new Decimal(existing.amount))
  ) {
    materialChanges.push({ field: "amount", message: TRANSFER_LEG_MESSAGE });
  }
  if (data.accountId !== undefined && data.accountId !== existing.accountId) {
    materialChanges.push({ field: "accountId", message: TRANSFER_LEG_MESSAGE });
  }
  if (data.date !== undefined && data.date !== existing.date) {
    materialChanges.push({ field: "date", message: TRANSFER_LEG_MESSAGE });
  }
  if (data.currency !== undefined && data.currency !== existing.currency) {
    materialChanges.push({ field: "currency", message: TRANSFER_LEG_MESSAGE });
  }

  if (materialChanges.length > 0) {
    throw new ValidationError(
      "Transfer legs cannot be modified through the generic transaction update",
      materialChanges,
    );
  }
}
