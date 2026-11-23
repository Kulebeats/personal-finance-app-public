import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { accounts, grzBondPayments, grzBonds, households, investmentTransactions, transactions } from "@shared/schema";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { Money, toMoneyDto } from "../../core/money";
import { uuidv5 } from "../../core/uuidv5";
import { EventTypes, outboxEventService } from "../../core/events";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { buildPostingReceipt } from "../../repositories/TransactionPostingEffect";
import { isValidDateString } from "../../utils/dateUtils";
import { householdToday } from "../householdCalendarToday";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import { GRZ_COUPON_CURRENCY as ZMW, lockGrzSettlementAccounts, lockGrzWriter } from "./couponPaymentAccess";
import { grzCouponPaymentKey } from "./couponPaymentKey";

const AMOUNT = /^\d+(?:\.\d{1,2})?$/;
const MAX_AMOUNT = "9999999999999.99";
/** Fixed seed for sale-cash idempotency keys. Never change it: a new value
 * would let an already-settled sale post its cash a second time. */
const GRZ_BOND_SALE_NAMESPACE = "4c7e2a91-0b5d-4e38-9f16-a83d5c0e7b42";

// Zod runs refinements on values that already failed the pattern, so each
// check re-tests the pattern before Money parses the string.
const inRange = (value: string, positive: boolean) => AMOUNT.test(value) &&
  new Money(value, ZMW).lte(MAX_AMOUNT) && (!positive || new Money(value, ZMW).gt(0));
const amount = (positive: boolean) => z.string().regex(AMOUNT, "Use a plain amount with at most two decimal places")
  .refine(value => inRange(value, positive), positive ? "Amount must be positive and within the supported range" : "Amount is outside the supported range");
export const sellBondInput = z.object({
  soldDate: z.string().refine(isValidDateString, "Sale date must be a valid calendar date").optional(),
  soldPrice: amount(true),
  fees: amount(false).optional(),
  soldYield: z.coerce.number().nonnegative().optional(),
  accountId: z.string().uuid().optional(),
}).strict();

/** Deterministic key on the sale cash row; `transactions.idempotency_key` is
 * unique, so the database refuses a second cash posting for the same bond. */
export function grzBondSaleKey(bondId: string): string {
  return uuidv5(`grz-bond-sale:${bondId.toLowerCase()}`, GRZ_BOND_SALE_NAMESPACE);
}

/**
 * Confirmed sale = asset-to-cash settlement (spec D10, R13.2). In one
 * transaction: lock grant -> bond -> its payments -> accounts (the coupon and
 * principal order), cancel every scheduled entitlement dated after the sale,
 * post the net proceeds once as `asset_settlement` (never income), record
 * fees, basis and the realised difference on the holding, and audit it.
 * No withholding is applied to a sale; see the PR's owner questions.
 */
export async function sellGrzBond(caller: HouseholdContext, bondId: string, body: unknown, ipAddress?: string) {
  const parsed = sellBondInput.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid sell data", parsed.error.errors);
  const input = parsed.data;
  const proceeds = new Money(input.soldPrice, ZMW);
  const fees = new Money(input.fees ?? "0.00", ZMW);
  const cash = proceeds.subtract(fees);
  if (!cash.gt(0)) throw new ValidationError("Sale fees must be less than the sale price");
  const soldYield = input.soldYield === undefined ? null
    : new Decimal(input.soldYield).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();

  const result = await withTransaction(async tx => {
    // Erasure takes household -> membership; take its shared fence first.
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, caller.householdId)).for("share");
    if (!household) throw new NotFoundError("Bond");
    const actor = await lockGrzWriter(tx, caller);
    // NEW-22: the default and the future bound are the household's calendar date, not UTC's.
    const today = await householdToday(tx, actor.householdId);
    const soldDate = input.soldDate ?? today;
    const [bond] = await tx.select().from(grzBonds)
      .where(and(eq(grzBonds.id, bondId), eq(grzBonds.householdId, actor.householdId))).for("update").limit(1);
    if (!bond) throw new NotFoundError("Bond");
    const destinationId = input.accountId ?? bond.accountId;
    if (!destinationId) throw new ValidationError("Account ID is required");
    const schedule = await tx.select().from(grzBondPayments).where(eq(grzBondPayments.bondId, bond.id))
      .orderBy(asc(grzBondPayments.id)).for("update");
    const destination = await lockGrzSettlementAccounts(tx, actor, bond.accountId, destinationId, "update", "Bond");
    // Re-read under the lock, so a sale committed a moment ago is seen here.
    if (bond.status === "sold" || bond.saleCashTransactionId) throw new ConflictError("Bond is already sold");
    if (bond.status !== "active") throw new ConflictError("Only an active bond can be sold");
    if (destination.currency !== ZMW) throw new ValidationError("GRZ sale proceeds require a ZMW destination");
    if (!destination.isAsset) throw new ValidationError("GRZ sale proceeds require a ZMW asset account");
    if (soldDate < bond.purchaseDate || soldDate > bond.maturityDate || soldDate > today) {
      throw new ValidationError("Sale date must fall within the holding period and cannot be in the future");
    }
    const later = schedule.filter(payment => payment.paymentDate > soldDate);
    if (later.some(payment => payment.status === "paid")) {
      throw new ConflictError("A payment due after the sale date was already received; reconcile it before recording the sale");
    }
    // Coupon income posts in its own transaction before the payment is marked
    // paid, so a "scheduled" payment may already have committed cash (the
    // payment-keyed posting). Its bond FOR SHARE ordered it before this sale's
    // FOR UPDATE, so the row is visible here. Cancelling a later one would
    // strand that cash. An earlier one is reconciled first too, while the
    // bond is active, so a sale never starts from a half-recorded coupon.
    const scheduledKeys = schedule.filter(payment => payment.status === "scheduled").map(payment => grzCouponPaymentKey(payment.id));
    if (scheduledKeys.length) {
      const [posted] = await tx.select({ id: transactions.id }).from(transactions)
        .where(and(eq(transactions.householdId, actor.householdId), inArray(transactions.idempotencyKey, scheduledKeys))).limit(1);
      if (posted) {
        throw new ConflictError("A payment of this bond was already received; reconcile it before recording the sale");
      }
    }
    const cancelled = later.filter(payment => payment.status === "scheduled").map(payment => payment.id);

    const costBasis = new Money(bond.purchasePrice, ZMW);
    if (!costBasis.gt(0)) throw new ValidationError("Holding purchase price requires reconciliation before a sale");
    const realizedGain = cash.subtract(costBasis);
    const posting = buildPostingReceipt(destination, { type: "asset_settlement", amount: cash.toString(), currency: ZMW });
    const nextBalance = new Money(destination.balance, ZMW).add(new Money(posting.postedBalanceDelta, ZMW));
    if (!nextBalance.amount.isFinite() || nextBalance.abs().gt(MAX_AMOUNT)) {
      throw new ValidationError("Resulting account balance is outside the supported range");
    }
    const [custody] = bond.accountId ? await tx.select({ private: accounts.isPrivate }).from(accounts).where(eq(accounts.id, bond.accountId)) : [];
    const auditHouseholdId = !bond.accountId || custody?.private || destination.isPrivate ? null : actor.householdId;

    const cashId = randomUUID();
    await tx.execute(sql`insert into ${transactions} (id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,
      idempotency_key,posted_balance_delta,posted_account_is_asset,posting_mode) values (${cashId}::uuid,${actor.householdId}::uuid,
      ${destination.id}::uuid,${actor.userId}::uuid,'Asset settlement','asset_settlement'::transaction_type,${cash.toString()}::numeric,
      ${ZMW},${soldDate}::date,'manual'::transaction_source,${grzBondSaleKey(bond.id)}::uuid,${posting.postedBalanceDelta}::numeric,
      ${posting.postedAccountIsAsset},'posted')`);
    await tx.update(accounts).set({ balance: nextBalance.toString(), updatedAt: new Date() }).where(eq(accounts.id, destination.id));
    await businessAuditService.logCreate({ tx, householdId: auditHouseholdId, userId: actor.userId, entityType: "transaction", entityId: cashId,
      newValue: { accountId: destination.id, type: "asset_settlement", amount: cash.toString(), date: soldDate, ...posting },
      metadata: { grzBondSaleId: bond.id }, ipAddress });

    // A-03: this row lives on the destination account. When the bond's custody
    // account is private, members who can see that destination cannot see the
    // bond, so the row must not name it or carry its ISIN.
    const saleNotes = custody?.private ? "GRZ Bond Sale" : `GRZ Bond Sale: ${bond.bondName}${bond.isin ? ` (${bond.isin})` : ""}`;
    const [investmentTx] = await tx.insert(investmentTransactions).values({ householdId: actor.householdId, accountId: destination.id,
      type: "sell", amount: proceeds.toString(), currency: ZMW, fees: fees.toString(), withholdingTax: "0.00", linkedTransactionId: cashId,
      transactionDate: soldDate, notes: saleNotes }).returning();
    if (cancelled.length) {
      await tx.update(grzBondPayments).set({ status: "cancelled" }).where(inArray(grzBondPayments.id, cancelled));
    }
    const [updated] = await tx.update(grzBonds).set({ status: "sold", soldDate, soldPrice: proceeds.toString(), soldYield,
      saleCashTransactionId: cashId, saleFees: fees.toString(), saleCostBasis: costBasis.toString(),
      saleRealizedGain: realizedGain.toString(), updatedAt: new Date() }).where(eq(grzBonds.id, bond.id)).returning();

    await businessAuditService.logUpdate({ tx, householdId: auditHouseholdId, userId: actor.userId, entityType: "grz_bond", entityId: bond.id,
      oldValue: { status: bond.status },
      newValue: { status: "sold", soldDate, soldPrice: proceeds.toString(), fees: fees.toString(), cashReceived: cash.toString(),
        costBasis: costBasis.toString(), realizedGain: realizedGain.toString(), withholdingTax: "0.00", cancelledPaymentIds: [...cancelled].sort() },
      metadata: { action: "sell", investmentTransactionId: investmentTx.id, cashTransactionId: cashId, costBasisSource: "recorded_purchase_price" },
      ipAddress });
    await outboxEventService.publish({ householdId: actor.householdId, eventType: EventTypes.TRANSACTION_CREATED, aggregateId: cashId,
      aggregateType: "transaction", payload: { transactionId: cashId, grzBondSaleId: bond.id } }, tx);

    const settlement = { cashTransactionId: cashId, grossProceeds: toMoneyDto(proceeds), fees: toMoneyDto(fees), cashReceived: toMoneyDto(cash),
      costBasis: toMoneyDto(costBasis), realizedGain: toMoneyDto(realizedGain), withholdingTax: toMoneyDto(Money.zero(ZMW)),
      cancelledPaymentIds: [...cancelled].sort() };
    return { updated, investmentTx, settlement };
  });
  await invalidateOnChangeAfterCommit("transaction", caller.householdId);
  await invalidateOnChangeAfterCommit("account", caller.householdId);
  return result;
}
