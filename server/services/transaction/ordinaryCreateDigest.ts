import { createHash } from "node:crypto";
import type { InsertTransaction } from "@shared/schema";

type SplitInput = {
  amount: string;
  categoryId?: string | null;
  merchantId?: string | null;
  notes?: string | null;
};

// The posting boundary accepts at most two fractional digits. Preserve malformed
// service inputs literally so rounding cannot turn them into an identical retry.
function amountTerm(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  return match ? match[1].replace(/^0+(?=\d)/, "") + "." + (match[2] ?? "").padEnd(2, "0") : value;
}

/** Hash the validated ordinary create request before merchant matching or rule processing. */
export function ordinaryCreateDigest(data: Omit<InsertTransaction, "householdId"> & {
  tags?: string[];
  splits?: SplitInput[];
}): string {
  // Household, key and owner selection are already bound by the same receipt.
  // Requiring every remaining insert field also covers direct service callers.
  type PostingField = Exclude<keyof InsertTransaction, "householdId" | "ownerUserId" | "idempotencyKey">;
  const fields = {
    id: data.id?.toLowerCase() ?? null,
    accountId: data.accountId.toLowerCase(),
    type: data.type,
    date: data.date,
    amount: amountTerm(data.amount),
    currency: data.currency ?? null,
    name: data.name,
    originalName: data.originalName ?? null,
    categoryId: data.categoryId?.toLowerCase() ?? null,
    merchantId: data.merchantId?.toLowerCase() ?? null,
    notes: data.notes ?? null,
    tags: data.tags ?? [],
    isRecurring: Boolean(data.recurringTransactionId || data.isRecurring),
    recurringTransactionId: data.recurringTransactionId?.toLowerCase() ?? null,
    isBalanceAdjustmentIncrease: data.isBalanceAdjustmentIncrease === undefined ? true : data.isBalanceAdjustmentIncrease,
    isPending: data.isPending ?? false,
    status: data.status === undefined ? "cleared" : data.status,
    source: data.source === undefined ? "manual" : data.source,
    isPrivate: data.isPrivate ?? false,
    isExcludedFromReports: data.isExcludedFromReports ?? false,
    isExcludedFromBudget: data.isExcludedFromBudget ?? false,
    transferAccountId: data.transferAccountId?.toLowerCase() ?? null,
    transferTransactionId: data.transferTransactionId?.toLowerCase() ?? null,
    isTransferIn: data.isTransferIn === undefined ? false : data.isTransferIn,
    fxRate: data.fxRate ?? null,
    fxBaseCurrency: data.fxBaseCurrency ?? null,
    fxQuoteCurrency: data.fxQuoteCurrency ?? null,
    fxTimestamp: data.fxTimestamp ?? null,
    fxSource: data.fxSource ?? null,
    convertedAmount: data.convertedAmount == null ? null : amountTerm(data.convertedAmount),
    reviewedAt: data.reviewedAt ?? null,
    reviewedBy: data.reviewedBy?.toLowerCase() ?? null,
    externalId: data.externalId ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    deletedAt: data.deletedAt ?? null,
    splits: (data.splits ?? []).map(split => [
      amountTerm(split.amount), split.categoryId?.toLowerCase() ?? null,
      split.merchantId?.toLowerCase() ?? null, split.notes ?? null,
    ]),
  } satisfies Record<PostingField | "tags" | "splits", unknown>;
  return "v1:" + createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
