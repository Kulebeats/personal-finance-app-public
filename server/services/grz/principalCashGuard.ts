import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { grzTBills, type Transaction } from "@shared/schema";
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

const settlementFields = ["amount", "type", "currency", "date", "accountId", "source", "splits", "categoryId", "merchantId",
  "transferAccountId", "transferTransactionId", "isTransferIn", "isBalanceAdjustmentIncrease", "isPending", "status",
  "isExcludedFromReports", "isExcludedFromBudget", "postingMode", "postedBalanceDelta", "postedAccountIsAsset"];

/** Privacy/review/notes may change. Economic corrections need a distinct
 * reviewed settlement adjustment so cash cannot diverge from retired assets. */
type CashRow = Pick<Transaction, "id" | "type">;

async function assertNoConfirmedTBillInterest(tx: TransactionType, householdId: string, rows: readonly CashRow[]) {
  const incomeIds = rows.filter(row => row.type === "income").map(row => row.id);
  if (incomeIds.length === 0) return;
  const [linked] = await tx.select({ id: grzTBills.id }).from(grzTBills)
    .where(and(eq(grzTBills.householdId, householdId), inArray(grzTBills.maturityIncomeTxId, incomeIds),
      isNotNull(grzTBills.settlementOperationId))).limit(1);
  if (linked) throw new ConflictError("Confirmed T-bill interest is locked");
}

export async function assertPrincipalCashUpdate(tx: TransactionType, before: CashRow & { householdId: string }, changes: object) {
  if (!settlementFields.some(field => Object.hasOwn(changes, field))) return;
  if (before.type === "asset_settlement") {
    throw new ConflictError("Principal settlement cash requires a settlement adjustment");
  }
  await assertNoConfirmedTBillInterest(tx, before.householdId, [before]);
}

export async function assertPrincipalCashDelete(tx: TransactionType, householdId: string, rows: readonly CashRow[]) {
  if (rows.some(row => row.type === "asset_settlement")) throw new ConflictError("Principal settlement cash requires a settlement adjustment");
  await assertNoConfirmedTBillInterest(tx, householdId, rows);
}
