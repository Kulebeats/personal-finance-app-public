import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, grzTBills, households, investmentTransactions, transactions } from "@shared/schema";
import { db } from "../../db";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { Money } from "../../core/money";
import { EventTypes, outboxEventService } from "../../core/events";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { buildPostingReceipt } from "../../repositories/TransactionPostingEffect";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { businessAuditService } from "../BusinessAuditService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import { householdToday } from "../householdCalendarToday";
import { tbillMaturityIncomeKey } from "../investment/investmentCronKeys";
import { getPostgresError } from "../../utils/postgresError";
import { lockGrzSettlementAccounts, lockGrzWriter } from "./couponPaymentAccess";
import { tbillReceiptDigest, tbillReceiptInput, tbillReceiptTerms } from "./tbillSettlementTerms";

const ZMW = "ZMW";
const NOT_FOUND = "T-bill not found";
const OPERATION_CONFLICT = "Operation ID belongs to another receipt confirmation";

/**
 * R1-07: a unique clash names what clashed. Only the operation id is a
 * confirmation conflict; nothing is posted in any case (the transaction rolls back).
 */
function receiptConflict(constraint: string | undefined): ConflictError {
  if (constraint === "uq_grz_tbills_settlement_operation") return new ConflictError(OPERATION_CONFLICT);
  if (constraint === "transactions_idempotency_key_unique") {
    return new ConflictError("This T-bill's interest is already recorded by another transaction. Nothing was posted.");
  }
  return new ConflictError("This receipt conflicts with an existing record. Nothing was posted.");
}
const MAX_BALANCE = new Money("9999999999999.99", ZMW);

/**
 * A-36: the member confirms the bank credit of a bill awaiting receipt. In one
 * transaction the principal (purchase price) returns to the settlement account
 * as asset_settlement cash, the net interest is booked as income, and the
 * maturity row records face less withholding, so principal + net interest =
 * face - withholding. The 0052 trigger binds the cash to this bill. A retry
 * with the same operation posts nothing; a second confirmation is refused.
 */
export async function confirmTBillReceipt(caller: HouseholdContext, billId: string, body: unknown, ipAddress?: string) {
  if (!z.string().uuid().safeParse(billId).success) throw new NotFoundError(NOT_FOUND);
  billId = billId.toLowerCase();
  const parsed = tbillReceiptInput.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid T-bill receipt confirmation", parsed.error.errors);
  const input = parsed.data;
  const digest = tbillReceiptDigest(billId, input);

  const result = await db.transaction(async tx => {
    // Audit FK lock order: the household row before any audit insert (AH-05).
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, caller.householdId)).for("share");
    if (!household) throw new NotFoundError(NOT_FOUND);
    const actor = await lockGrzWriter(tx, caller);
    const [bill] = await tx.select().from(grzTBills)
      .where(and(eq(grzTBills.id, billId), eq(grzTBills.householdId, actor.householdId))).for("update");
    if (!bill) throw new NotFoundError(NOT_FOUND);
    // Custody and destination must both be visible; a hidden bill is not found.
    const destination = await lockGrzSettlementAccounts(tx, actor, bill.accountId, input.accountId, "update", NOT_FOUND);

    if (bill.settlementOperationId) {
      if (bill.settlementOperationId === input.operationId && bill.settlementRequestDigest === digest) {
        return { bill, duplicate: true };
      }
      if (bill.settlementOperationId === input.operationId) throw new ConflictError(OPERATION_CONFLICT);
      throw new ConflictError("This T-bill's receipt is already confirmed");
    }
    const [reused] = await tx.select({ id: grzTBills.id }).from(grzTBills)
      .where(and(eq(grzTBills.settlementOperationId, input.operationId), ne(grzTBills.id, bill.id))).limit(1);
    if (reused) throw new ConflictError(OPERATION_CONFLICT);
    if (bill.status !== "awaiting_receipt") throw new ConflictError("This T-bill is not awaiting receipt");
    if (destination.currency !== ZMW || !destination.isAsset) throw new ValidationError("T-bill receipt requires a ZMW asset account");

    const terms = tbillReceiptTerms(bill, input, await householdToday(tx, actor.householdId));
    const [custody] = bill.accountId ? await tx.select({ private: accounts.isPrivate }).from(accounts).where(eq(accounts.id, bill.accountId)) : [];
    const isPrivate = !bill.accountId || !!custody?.private || destination.isPrivate;
    const auditHouseholdId = isPrivate ? null : actor.householdId;
    const label = custody?.private ? "T-Bill" : `T-Bill: ${bill.tbillName}`;

    const cashId = randomUUID();
    const posting = buildPostingReceipt(destination, { type: "asset_settlement", amount: terms.principal.toString(), currency: ZMW });
    const nextBalance = new Money(destination.balance, ZMW).add(new Money(posting.postedBalanceDelta, ZMW));
    if (!nextBalance.amount.isFinite() || nextBalance.abs().gt(MAX_BALANCE)) {
      throw new ValidationError("Resulting account balance is outside the supported range");
    }
    await tx.execute(sql`insert into ${transactions} (id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,
      posted_balance_delta,posted_account_is_asset,posting_mode) values (${cashId}::uuid,${actor.householdId}::uuid,${destination.id}::uuid,
      ${actor.userId}::uuid,'Asset settlement','asset_settlement'::transaction_type,${terms.principal.toString()}::numeric,${ZMW},
      ${input.date}::date,'manual'::transaction_source,${posting.postedBalanceDelta}::numeric,${posting.postedAccountIsAsset},'posted')`);
    await tx.update(accounts).set({ balance: nextBalance.toString(), updatedAt: new Date() }).where(eq(accounts.id, destination.id));
    await businessAuditService.logCreate({ tx, householdId: auditHouseholdId, userId: actor.userId, entityType: "transaction", entityId: cashId,
      newValue: { accountId: destination.id, type: "asset_settlement", amount: terms.principal.toString(), date: input.date, ...posting },
      metadata: { tbillReceiptOperationId: input.operationId }, ipAddress });

    let incomeId: string | null = null;
    if (terms.netInterest.isPositive()) {
      const idempotencyKey = tbillMaturityIncomeKey(bill.id);
      const { transaction: income } = await transactionRepository.createWithinTransaction(tx, {
        householdId: actor.householdId, accountId: destination.id, date: input.date, name: `${label} interest`,
        amount: terms.netInterest.toString(), currency: ZMW, type: "income", source: "manual", idempotencyKey,
        // R1-05: a privately held bill's terms stay off the cash row a peer may read.
        notes: custody?.private ? "T-bill maturity interest"
          : `T-bill maturity interest. Face ${terms.face.toString()}, purchase ${terms.principal.toString()}, WHT ${terms.withholding.toString()}`,
      }, { audit: { userId: actor.userId, householdId: auditHouseholdId, ipAddress,
        metadata: { reason: "tbill_maturity_interest", tbillId: bill.id, tbillReceiptOperationId: input.operationId } } });
      incomeId = income.id;
    }

    const [maturity] = await tx.insert(investmentTransactions).values({ householdId: actor.householdId, accountId: destination.id,
      type: "maturity", quantity: "1", price: terms.face.toString(), amount: terms.proceeds.toString(), currency: ZMW,
      withholdingTax: terms.withholding.toString(), linkedTransactionId: cashId,
      // The tax year is the maturity year, as before A-36; cash posts on the receipt date.
      transactionDate: bill.maturityDate, notes: `Maturity Payout: ${label}` }).returning();
    const [updated] = await tx.update(grzTBills).set({ status: "matured", settlementOperationId: input.operationId,
      settlementRequestDigest: digest, settlementCashTransactionId: cashId, settlementReceiptDate: input.date,
      maturityInvestmentTxId: maturity.id, maturityIncomeTxId: incomeId, updatedAt: new Date() })
      .where(eq(grzTBills.id, bill.id)).returning();
    await businessAuditService.log({ tx, householdId: auditHouseholdId, userId: actor.userId, action: "PROCESS",
      entityType: "grz_tbill", entityId: bill.id, details: { operationId: input.operationId, trigger: "tbill_receipt_confirmed",
        principal: terms.principal.toString(), netInterest: terms.netInterest.toString(), withholdingTax: terms.withholding.toString(),
        receiptDate: input.date, cashTransactionId: cashId, incomeTransactionId: incomeId, investmentTransactionId: maturity.id }, ipAddress });
    await outboxEventService.publish({ householdId: actor.householdId, eventType: EventTypes.TRANSACTION_CREATED,
      aggregateId: cashId, aggregateType: "transaction", payload: { transactionId: cashId, tbillReceiptOperationId: input.operationId } }, tx);
    return { bill: updated, duplicate: false };
  }).catch(error => {
    const failure = getPostgresError(error);
    if (failure?.code === "23505") throw receiptConflict(failure.constraint);
    throw error;
  });
  if (!result.duplicate) {
    await invalidateOnChangeAfterCommit("transaction", caller.householdId);
    await invalidateOnChangeAfterCommit("account", caller.householdId);
  }
  return result;
}
