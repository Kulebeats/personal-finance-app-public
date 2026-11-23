import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { accounts, receiptConversionRecords, transactions } from "@shared/schema";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import { receiptRepository } from "../../repositories/ReceiptRepository";

export interface ReceiptConversionInput {
  accountId: string;
  amount: string;
  date: string;
  name: string;
  categoryId?: string;
  notes?: string;
}

export function receiptRequestHash(input: ReceiptConversionInput): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.amount);
  if (!match) throw new ValidationError("Receipt amount must be a positive decimal");
  const units = match[1].replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  if (units === "0" && cents === "00") throw new ValidationError("Receipt amount must be positive");
  const fields = [1, input.accountId.toLowerCase(), units + "." + cents, input.date, input.name,
    input.categoryId?.toLowerCase() ?? null, input.notes || null];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** Hold the receipt row through first posting or replay authorization. */
export async function lockedConversionResult(
  tx: TransactionType, receiptId: string, householdId: string, userId: string, hash: string,
): Promise<string | undefined> {
  const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
  if (!actor) throw new NotFoundError("Transaction");
  // R6-08: a receipt the caller cannot read is missing, before the linked checks.
  const locked = await receiptRepository.lockVisibleReceiptForWrite(tx, actor, receiptId);
  if (!locked) throw new NotFoundError("Receipt");
  const receipt = { status: locked.matchStatus, linked: locked.matchedTransactionId };

  const [record] = await tx.select().from(receiptConversionRecords).where(and(
    eq(receiptConversionRecords.receiptId, receiptId), eq(receiptConversionRecords.householdId, householdId),
  ));
  if (!record) {
    if (receipt.linked || receipt.status === "matched") throw new ConflictError("Receipt is already linked");
    return undefined;
  }
  await requireVisibleReceiptPosting(tx, actor, record.transactionId);
  if (record.requestVersion !== 1 || record.requestHash !== hash || receipt.linked !== record.transactionId || receipt.status !== "matched") {
    throw new ConflictError("Receipt conversion conflicts with the original request");
  }
  return record.transactionId;
}

export async function requireVisibleReceiptPosting(
  tx: TransactionType, actor: NonNullable<Awaited<ReturnType<typeof lockTransactionCreateGrant>>>, transactionId: string,
): Promise<void> {
  const [visible] = await tx.select({ id: transactions.id }).from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.id, transactionId), visibleTransactionPredicate(actor), visibleAccountPredicate(actor)))
    .for("share");
  if (!visible) throw new NotFoundError("Transaction");
}
