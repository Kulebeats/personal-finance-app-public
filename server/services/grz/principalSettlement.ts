import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accounts, grzBondPayments, grzBonds, households, investmentTransactions, transactions, transactionSplits } from "@shared/schema";
import { grzPrincipalSettlements } from "@shared/grz-principal-settlement-schema";
import { db } from "../../db";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { Money } from "../../core/money";
import { EventTypes, outboxEventService } from "../../core/events";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { buildPostingReceipt, readPostingEffect } from "../../repositories/TransactionPostingEffect";
import { businessAuditService } from "../BusinessAuditService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import type { TransactionType } from "../../utils/withTransaction";
import { lockGrzSettlementAccounts, lockGrzWriter } from "./couponPaymentAccess";
import { principalSettlementInput, principalSettlementTerms, type PrincipalValuation } from "./principalSettlementTerms";
import { readLockedGrzPrincipalBasis } from "./principalBasis";
import { grzHouseholdBusinessDate } from "./householdBusinessDate";
import { getPostgresError } from "../../utils/postgresError";
import { lockPrincipalCouponSources } from "./principalCouponReconciliation";

export type PrincipalValuationReader = (tx: TransactionType, actor: HouseholdContext, bondId: string, asOfDate: string, receiptDate?: string) => Promise<PrincipalValuation | null>;

/** The authoritative resolver is an explicit dependency; callers cannot supply
 * a carrying amount in the HTTP body. Common schema 0025 is required to wire
 * this service into the principal handler. */
export async function settleGrzPrincipal(caller: HouseholdContext, paymentId: string, body: unknown,
  readValuation: PrincipalValuationReader, ipAddress?: string) {
  paymentId = paymentId.toLowerCase();
  const parsed = principalSettlementInput.safeParse(body);
  const destinationInput = principalSettlementInput.pick({ accountId: true }).passthrough().safeParse(body);
  if (!destinationInput.success) throw new ValidationError("A valid destination account is required", destinationInput.error.errors);
  const proposal = parsed.success ? parsed.data : null;
  const requestDigest = proposal && createHash("sha256").update(JSON.stringify({ version: 1, paymentId, accountId: proposal.accountId,
    date: proposal.date, receivedAmount: proposal.receivedAmount, fees: proposal.fees, receiptTransactionId: proposal.receiptTransactionId ?? null })).digest("hex");
  const result = await db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, caller.householdId)).for("share");
    if (!household) throw new NotFoundError("Payment not found");
    const actor = await lockGrzWriter(tx, caller);
    const [pointer] = await tx.select({ bondId: grzBondPayments.bondId }).from(grzBondPayments).where(eq(grzBondPayments.id, paymentId));
    if (!pointer) throw new NotFoundError("Payment not found");
    const [bond] = await tx.select().from(grzBonds).where(and(eq(grzBonds.id, pointer.bondId), eq(grzBonds.householdId, actor.householdId))).for("update");
    if (!bond) throw new NotFoundError("Payment not found");
    const [payment] = await tx.select().from(grzBondPayments).where(eq(grzBondPayments.id, paymentId)).for("update");
    if (!payment || payment.bondId !== bond.id) throw new ConflictError("Principal entitlement changed");
    const [operation] = proposal ? await tx.select().from(grzPrincipalSettlements).where(eq(grzPrincipalSettlements.operationId, proposal.operationId)).for("update") : [];
    const receiptId = operation?.cashTransactionId ?? proposal?.receiptTransactionId;
    const privateCouponInput = await lockPrincipalCouponSources(tx, actor, bond.id, bond.maturityDate, bond.accountId, destinationInput.data.accountId, receiptId);
    const [receipt] = receiptId ? await tx.select().from(transactions).where(and(eq(transactions.id, receiptId),
      visibleTransactionPredicate(actor))).for("update") : [];
    if (receiptId && !receipt) throw new NotFoundError("Receipt not found");
    const destination = await lockGrzSettlementAccounts(tx, actor, bond.accountId, destinationInput.data.accountId, "update");
    if (destination.currency !== "ZMW" || !destination.isAsset) throw new ValidationError("Principal receipt requires a compatible ZMW asset account");
    const [custody] = bond.accountId ? await tx.select({ private: accounts.isPrivate }).from(accounts).where(eq(accounts.id, bond.accountId)) : [];
    const auditHouseholdId = !bond.accountId || custody?.private || destination.isPrivate || receipt?.isPrivate || privateCouponInput ? null : actor.householdId;
    if (operation && (operation.householdId !== actor.householdId || operation.actorUserId !== actor.userId ||
      operation.paymentId !== paymentId || operation.bondId !== bond.id || operation.requestDigest !== requestDigest)) {
      throw new ConflictError("Operation ID belongs to another principal confirmation");
    }
    // An identical confirmed retry is a receipt lookup, not a new posting.
    if (operation?.status === "confirmed") {
      if (!receipt || receipt.accountId !== destination.id || String(receipt.type) !== "asset_settlement" ||
        receipt.deletedAt || receipt.amount !== operation.receivedAmount || receipt.currency !== operation.currency ||
        receipt.date !== operation.receiptDate || payment.status !== "paid" || bond.status !== "matured") {
        throw new ConflictError("Confirmed principal evidence requires reconciliation");
      }
      readPostingEffect(destination, receipt);
      return { payment, settlement: operation, pending: false, duplicate: true, pendingReason: null };
    }
    if (bond.status !== "active" || payment.status !== "scheduled") throw new ConflictError("Principal entitlement is no longer payable");
    if (!parsed.success) throw new ValidationError("Invalid principal receipt confirmation", parsed.error.errors);
    const input = parsed.data;
    if (!requestDigest) throw new ValidationError("A principal operation is required");
    if (payment.incomeTransactionId || payment.investmentTransactionId) throw new ConflictError("Principal already has financial linkage requiring reconciliation");
    if (receipt) {
      const [current] = await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, receipt.id), visibleTransactionPredicate(actor)));
      if (!current) throw new NotFoundError("Receipt not found");
      const reservation = await tx.execute<{ reserved: boolean }>(sql`select
        exists(select 1 from public.grz_bond_payments where income_transaction_id=${receipt.id}::uuid)
        or exists(select 1 from public.transaction_create_owner_intents where transaction_id=${receipt.id}::uuid and operation='grz_coupon') as reserved`);
      if (reservation.rows[0]?.reserved) throw new ConflictError("Existing receipt is already reserved for another financial payment");
      const effect = readPostingEffect(destination, receipt);
      const [split] = await tx.select({ id: transactionSplits.id }).from(transactionSplits).where(eq(transactionSplits.transactionId, receipt.id)).limit(1);
      const [linked] = await tx.select({ id: investmentTransactions.id }).from(investmentTransactions).where(eq(investmentTransactions.linkedTransactionId, receipt.id)).limit(1);
      if (receipt.type !== "income" || receipt.isPending || receipt.status === "pending" || receipt.deletedAt || split || linked ||
        effect.mode !== "posted" || receipt.amount !== new Money(input.receivedAmount.amount, "ZMW").toString() || receipt.date !== input.date) {
        throw new ConflictError("Existing receipt does not match the confirmed principal cash movement");
      }
    }
    const basis = input.receiptConfirmed ? await readLockedGrzPrincipalBasis(tx, actor, bond.id) : null;
    const valuation = input.receiptConfirmed ? await readValuation(tx, actor, bond.id, bond.maturityDate, input.date) : null;
    // Use the same transaction date as the coupon proof and deferred binding guard.
    const terms = principalSettlementTerms(bond, payment, input, valuation, basis, await grzHouseholdBusinessDate(tx, actor.householdId));
    if (receipt && terms.valuation?.couponReconciliation?.payments.some(coupon => coupon.receiptTransactionId === receipt.id)) {
      throw new ConflictError("Coupon cash cannot also be a principal receipt");
    }
    if (operation?.basisId && operation.basisId !== terms.base.basisEvidence?.sourceId) throw new ConflictError("Principal basis evidence changed; confirm a fresh operation");
    const pending = !input.receiptConfirmed || !terms.valuation;
    const { kind: _kind, ...amounts } = terms.base;
    const base = { householdId: actor.householdId, actorUserId: actor.userId, bondId: bond.id, paymentId,
      destinationAccountId: destination.id, requestedReceiptId: input.receiptTransactionId ?? null, receiptDate: input.date,
      requestDigest, ...amounts, basisId: terms.base.basisEvidence?.sourceId ?? null, valuationId: terms.valuation?.sourceId ?? null, valuation: terms.valuation };
    // Different pending proposals may coexist; only one confirmed instrument
    // and one confirmed cash receipt can pass the database uniqueness guards.
    if (pending) {
      const pendingReason = input.receiptConfirmed ? terms.unavailableReason : "receipt_unconfirmed";
      let saved = operation;
      if (!saved) {
        [saved] = await tx.insert(grzPrincipalSettlements).values({ operationId: input.operationId, ...base }).returning();
        await businessAuditService.logCreate({ tx, householdId: auditHouseholdId, userId: actor.userId,
          entityType: "grz_bond_payment", entityId: paymentId, newValue: { pendingOperationId: input.operationId,
            status: "pending", reason: pendingReason }, ipAddress });
      } else if (!saved.basisId && base.basisId) {
        [saved] = await tx.update(grzPrincipalSettlements).set({ basisId: base.basisId, basisEvidence: base.basisEvidence,
          costBasis: base.costBasis, realizedBasisDifference: base.realizedBasisDifference, purchasedInterest: base.purchasedInterest,
          acquisitionFees: base.acquisitionFees }).where(eq(grzPrincipalSettlements.operationId, input.operationId)).returning();
        await businessAuditService.logUpdate({ tx, householdId: auditHouseholdId, userId: actor.userId,
          entityType: "grz_bond_payment", entityId: paymentId, oldValue: { pendingOperationId: input.operationId, basisId: null },
          newValue: { pendingOperationId: input.operationId, basisId: base.basisId, status: "pending", reason: pendingReason }, ipAddress });
      }
      return { payment, settlement: saved, pending: true, duplicate: !!operation, pendingReason };
    }
    let cashId = receipt?.id;
    if (receipt) {
      // Reclassification preserves the original posting receipt and balance.
      // The original import/manual CREATE evidence is retained unchanged.
      await tx.execute(sql`update ${transactions} set type='asset_settlement'::transaction_type, updated_at=clock_timestamp()
        where id=${receipt.id}::uuid`);
      await businessAuditService.logUpdate({ tx, householdId: auditHouseholdId, userId: actor.userId,
        entityType: "transaction", entityId: receipt.id, oldValue: { type: receipt.type },
        newValue: { type: "asset_settlement" }, metadata: { principalSettlementOperationId: input.operationId,
          preservedPostingDelta: receipt.postedBalanceDelta }, ipAddress });
    } else {
      cashId = randomUUID();
      const posting = buildPostingReceipt(destination, { type: "asset_settlement", amount: terms.base.receivedAmount, currency: "ZMW" });
      const nextBalance = new Money(destination.balance, "ZMW").add(new Money(posting.postedBalanceDelta, "ZMW"));
      if (!nextBalance.amount.isFinite() || nextBalance.abs().gt(new Money("9999999999999.99", "ZMW"))) throw new ValidationError("Resulting account balance is outside the supported range");
      await tx.execute(sql`insert into ${transactions} (id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,
        posted_balance_delta,posted_account_is_asset,posting_mode) values (${cashId}::uuid,${actor.householdId}::uuid,${destination.id}::uuid,
        ${actor.userId}::uuid,'Asset settlement','asset_settlement'::transaction_type,${terms.base.receivedAmount}::numeric,'ZMW',${input.date}::date,
        'manual'::transaction_source,${posting.postedBalanceDelta}::numeric,${posting.postedAccountIsAsset},'posted')`);
      await tx.update(accounts).set({ balance: nextBalance.toString(), updatedAt: new Date() }).where(eq(accounts.id, destination.id));
      await businessAuditService.logCreate({ tx, householdId: auditHouseholdId, userId: actor.userId,
        entityType: "transaction", entityId: cashId, newValue: { accountId: destination.id, type: "asset_settlement",
          amount: terms.base.receivedAmount, date: input.date, ...posting },
        metadata: { principalSettlementOperationId: input.operationId }, ipAddress });
    }
    const [investment] = await tx.insert(investmentTransactions).values({ householdId: actor.householdId, accountId: destination.id,
      type: "maturity", amount: terms.base.principalAmount, currency: "ZMW", fees: terms.base.fees, withholdingTax: "0.00",
      linkedTransactionId: cashId!, transactionDate: input.date, notes: "Confirmed principal redemption; basis is recorded separately" }).returning();
    const [updatedPayment] = await tx.update(grzBondPayments).set({ status: "paid", actualPaymentDate: input.date,
      incomeTransactionId: null, investmentTransactionId: investment.id }).where(eq(grzBondPayments.id, paymentId)).returning();
    await tx.update(grzBonds).set({ status: "matured", updatedAt: new Date() }).where(eq(grzBonds.id, bond.id));
    const confirmed = { ...base, status: "confirmed", cashTransactionId: cashId!, investmentTransactionId: investment.id, confirmedAt: new Date() };
    const [saved] = operation
      ? await tx.update(grzPrincipalSettlements).set(confirmed).where(eq(grzPrincipalSettlements.operationId, input.operationId)).returning()
      : await tx.insert(grzPrincipalSettlements).values({ operationId: input.operationId, ...confirmed }).returning();
    await businessAuditService.log({ tx, householdId: auditHouseholdId, userId: actor.userId, action: "PROCESS",
      entityType: "grz_bond_payment", entityId: paymentId, details: { operationId: input.operationId,
        settlement: { ...terms.base, carryingValuation: terms.valuation }, cashTransactionId: cashId, investmentTransactionId: investment.id }, ipAddress });
    await outboxEventService.publish({ householdId: actor.householdId, eventType: receipt ? EventTypes.TRANSACTION_UPDATED : EventTypes.TRANSACTION_CREATED,
      aggregateId: cashId!, aggregateType: "transaction", payload: { transactionId: cashId!, principalSettlementOperationId: input.operationId } }, tx);
    return { payment: updatedPayment, settlement: saved, pending: false, duplicate: false, pendingReason: null };
  }).catch(error => {
    const failure = getPostgresError(error);
    if (failure?.code === "23505" && (failure.constraint === "grz_principal_settlements_pkey" || failure.constraint?.startsWith("uq_grz_principal_"))) {
      throw new ConflictError("Principal operation or receipt was already used; recheck the settlement");
    }
    throw error;
  });
  if (!result.pending && !result.duplicate) {
    await invalidateOnChangeAfterCommit("transaction", caller.householdId);
    await invalidateOnChangeAfterCommit("account", caller.householdId);
  }
  return result;
}
