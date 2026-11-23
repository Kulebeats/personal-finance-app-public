import { eq } from "drizzle-orm";
import { households, householdPreferences } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { HttpError } from "../core/errors";
import { db } from "../db";
import { readAccountActor } from "./AccountReadAudience";
import { transactionQueryRepository } from "./TransactionQueryRepository";

import { validateTagIds } from "../services/transaction/tags";

export class SummaryDataUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
}

export interface TransactionSummaryOptions {
  ownerUserId?: string | null;
  accountId?: string;
  categoryId?: string;
  merchantId?: string;
  type?: string;
  search?: string;
  amountMin?: number;
  amountMax?: number;
  reviewed?: "reviewed" | "unreviewed";
  tagIds?: string[];
  includePending?: boolean;
}

export async function readTransactionSummaryInputs(householdId: string, userId: string, startDate: string,
  endDate: string, options?: TransactionSummaryOptions) {
  return db.transaction(async tx => {
    await readAccountActor(tx, householdId, userId, "financial.read");
    if (options?.tagIds?.length) await validateTagIds(options.tagIds, householdId, tx);
    const [household] = await tx.select({ currency: households.currency, pending: householdPreferences.showPendingTransactions })
      .from(households).leftJoin(householdPreferences, eq(householdPreferences.householdId, households.id))
      .where(eq(households.id, householdId));
    if (!isCurrencyCode(household?.currency)) throw new SummaryDataUnavailable("The household reporting currency is unavailable.");
    const rows = await transactionQueryRepository.findByHouseholdWithVisibility(householdId, userId, {
      ...options, startDate, endDate, summaryCurrency: household.currency,
      amountMin: options?.amountMin?.toString(), amountMax: options?.amountMax?.toString(),
      includePending: options?.includePending ?? household.pending ?? true,
    }, tx);
    return { rows, currency: household.currency };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
