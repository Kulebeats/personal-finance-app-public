import { z } from "zod";
import Decimal from "decimal.js";
import { apiCall, type MoneyDto } from "@/lib/api";
import type { OperationLifetime } from "@/lib/operation-lifetime";

export interface ReconciliationDraft {
  targetBalance: MoneyDto;
  expectedUpdatedAt: string;
  reason: string;
  idempotencyKey: string;
}

export const statementAmount = /^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;
const money = z.object({ amount: z.string().regex(/^-?\d+\.\d{2}$/), currency: z.string().regex(/^[A-Z]{3}$/) });
const quote = z.object({
  currentBalance: money, targetBalance: money, adjustment: money,
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const preview = quote.extend({ previewToken: z.string().regex(/^[0-9a-f]{64}$/) });
const receipt = quote.extend({ transactionId: z.string().uuid() });
export type Review = { draft: ReconciliationDraft; quote: z.infer<typeof preview> };

async function post(accountId: string, body: object, operation: OperationLifetime | null) {
  return apiCall<unknown>(`/accounts/${accountId}/reconcile`,
    { method: "POST", body: JSON.stringify(body) }, true, false, operation);
}

export async function previewBalance(accountId: string, draft: ReconciliationDraft, operation: OperationLifetime | null): Promise<Review> {
  const { data } = z.object({ success: z.literal(true), data: preview }).parse(
    await post(accountId, { ...draft, mode: "preview" }, operation)
  );
  if (!new Decimal(data.targetBalance.amount).eq(draft.targetBalance.amount) ||
      !new Decimal(data.targetBalance.amount).minus(data.currentBalance.amount).eq(data.adjustment.amount) ||
      [data.currentBalance, data.targetBalance, data.adjustment].some(value => value.currency !== draft.targetBalance.currency)) {
    throw new Error("The preview did not match the statement balance and currency.");
  }
  return { draft, quote: data };
}

export async function applyBalance(accountId: string, review: Review, operation: OperationLifetime | null) {
  const { data } = z.object({ success: z.literal(true), data: receipt }).parse(await post(accountId, {
    ...review.draft, mode: "apply", previewToken: review.quote.previewToken,
  }, operation));
  for (const field of ["currentBalance", "targetBalance", "adjustment"] as const) {
    if (data[field].amount !== review.quote[field].amount || data[field].currency !== review.quote[field].currency) {
      throw new Error("The receipt does not match the preview.");
    }
  }
  if (data.postingDate !== review.quote.postingDate) throw new Error("The receipt has a different posting date.");
  return data;
}
