import Decimal from "decimal.js";
import { isValidDateString } from "../../utils/dateUtils";
import { householdToday } from "../householdCalendarToday";
import { accounts, auditLogs, grzBondPayments, grzBonds, householdMembers, transactionCreateOwnerIntents, transactions, type GrzBondPayment, type InsertTransaction } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import { grzCouponPaymentKey } from "./couponPaymentKey";
import { GRZ_COUPON_CASH_DESCRIPTION } from "./couponCashDescription";

export const GRZ_COUPON_CURRENCY = "ZMW";
/** Bond states whose already-posted coupon cash may still be recorded as paid. */
const RECOVERABLE_BOND_STATUSES = new Set<string | null>(["active", "matured"]);

/**
 * A sold bond still owes the coupons that fell due while it was held (on or
 * before the sale date); a sale without a date proves none. Other bonds keep
 * the active/matured rule.
 */
function couponStillOwed(bond: typeof grzBonds.$inferSelect, payment: GrzBondPayment): boolean {
  if (bond.status === "sold") return bond.soldDate !== null && payment.paymentDate <= bond.soldDate;
  return RECOVERABLE_BOND_STATUSES.has(bond.status);
}

async function lockCoupon(tx: TransactionType, actor: HouseholdContext, paymentId: string) {
  // A disposal locks the holding before its installments. Match that order
  // here, then recheck the link on the locked installment after any wait.
  const parent = tx.select({ id: grzBondPayments.bondId }).from(grzBondPayments).where(eq(grzBondPayments.id, paymentId));
  const [bond] = await tx.select().from(grzBonds)
    .where(and(inArray(grzBonds.id, parent), eq(grzBonds.householdId, actor.householdId))).for("share");
  if (!bond) throw new NotFoundError("Payment not found");
  const [payment] = await tx.select().from(grzBondPayments)
    .where(and(eq(grzBondPayments.id, paymentId), eq(grzBondPayments.bondId, bond.id))).for("update");
  if (!payment) throw new NotFoundError("Payment not found");
  return { payment, bond };
}

export async function lockGrzWriter(tx: TransactionType, caller: HouseholdContext) {
  const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, caller.householdId), eq(householdMembers.userId, caller.userId))).for("share");
  if (!grant || !can(grant.role, "financial.write")) throw new ForbiddenError("Financial write access required");
  return { ...caller, role: grant.role };
}

export async function lockGrzSettlementAccounts(tx: TransactionType, actor: HouseholdContext, sourceId: string | null,
  destinationId: string, lock: "update" | "share", notFoundMessage = "Payment not found") {
  const ids = Array.from(new Set([destinationId.toLowerCase(), ...(sourceId ? [sourceId] : [])]));
  const visible = await tx.select().from(accounts)
    .where(and(inArray(accounts.id, ids), visibleAccountPredicate(actor))).orderBy(accounts.id).for(lock);
  const destination = visible.find(row => row.id === destinationId.toLowerCase());
  if (visible.length !== ids.length || !destination) throw new NotFoundError(notFoundMessage);
  return destination;
}

function couponReceipt(payment: GrzBondPayment) {
  return { version: 1, paymentId: payment.id, bondId: payment.bondId, dueDate: payment.paymentDate,
    paymentType: payment.paymentType, grossAmount: payment.grossAmount, withholdingTax: payment.withholdingTax,
    netAmount: payment.netAmount, currency: GRZ_COUPON_CURRENCY };
}

/** Called in the financial transaction after the authenticated writer's membership is locked. */
export async function lockCouponPostingAccount(tx: TransactionType, actor: HouseholdContext | undefined,
  paymentId: string, input: InsertTransaction) {
  if (!actor || actor.householdId !== input.householdId) throw new ForbiddenError("Financial write access required");
  const { payment, bond } = await lockCoupon(tx, actor, paymentId);
  const destination = await lockGrzSettlementAccounts(tx, actor, bond.accountId, input.accountId, "update");
  if (payment.status === "paid") throw new ConflictError("Payment is already marked as paid");
  // The bond lock orders the first cash posting against disposal. Recovery
  // below finalizes an existing posting and must not create another one.
  if (bond.status !== "active" || payment.status !== "scheduled") {
    throw new ConflictError("This bond payment is no longer payable");
  }
  if (!isValidDateString(input.date) || input.date < payment.paymentDate || input.date > await householdToday(tx, actor.householdId) ||
      payment.paymentDate < bond.purchaseDate || payment.paymentDate > bond.maturityDate) {
    throw new ValidationError("Payment requires a due installment and a receipt date between its due date and today");
  }
  const gross = new Decimal(payment.grossAmount);
  if (payment.withholdingTax === null) throw new ValidationError("Scheduled withholding is unknown");
  const withheld = new Decimal(payment.withholdingTax);
  const net = new Decimal(payment.netAmount);
  if (!gross.isFinite() || !withheld.isFinite() || !net.isFinite() ||
      withheld.lt(0) || net.lte(0) || !gross.minus(withheld).equals(net)) {
    throw new ValidationError("Invalid scheduled payment amounts");
  }
  if (destination.currency !== GRZ_COUPON_CURRENCY || input.currency !== GRZ_COUPON_CURRENCY) {
    throw new ValidationError("GRZ coupon income requires a ZMW destination");
  }
  if (input.type !== "income" || input.amount !== payment.netAmount || input.idempotencyKey !== grzCouponPaymentKey(payment.id)) {
    throw new ConflictError("Coupon terms changed before posting");
  }
  const [custody] = bond.accountId ? await tx.select({ isPrivate: accounts.isPrivate }).from(accounts).where(eq(accounts.id, bond.accountId)) : [];
  const genericDescription = !bond.accountId || custody?.isPrivate !== false;
  return { account: destination, privateAudit: !bond.accountId || custody?.isPrivate !== false || destination.isPrivate || input.isPrivate === true, receipt: couponReceipt(payment),
    genericDescription, notes: genericDescription ? GRZ_COUPON_CASH_DESCRIPTION
      : `Coupon Payment for ${bond.bondName}. Gross: ${payment.grossAmount}, WHT: ${payment.withholdingTax}` };
}

export async function lockCouponPayment(tx: TransactionType, caller: HouseholdContext, paymentId: string,
  postingId: string, destinationId: string, requestedDate?: string) {
  const actor = await lockGrzWriter(tx, caller);
  const { payment, bond } = await lockCoupon(tx, actor, paymentId);
  const [posting] = await tx.select().from(transactions).where(and(
    eq(transactions.id, postingId), visibleTransactionPredicate(actor),
  )).for("share");
  if (!posting) throw new NotFoundError("Payment not found");
  const destination = await lockGrzSettlementAccounts(tx, actor, bond.accountId, destinationId, "share");
  if (payment.status === "paid") throw new ConflictError("Payment is already marked as paid");
  // A cancelled payment is no longer payable, even when its income posting
  // committed first (the sale race), and neither is one due after a sale.
  // A matured bond and a sold bond's pre-sale coupon stay recoverable: this
  // step never posts new cash, it records cash already received.
  if (payment.status !== "scheduled" || !couponStillOwed(bond, payment)) {
    throw new ConflictError("This bond payment is no longer payable");
  }
  if (posting.accountId !== destination.id || destination.currency !== GRZ_COUPON_CURRENCY ||
      posting.currency !== GRZ_COUPON_CURRENCY || posting.type !== "income" || posting.amount !== payment.netAmount ||
      (requestedDate !== undefined && requestedDate !== posting.date)) {
    throw new ConflictError("Coupon recovery conflicts with the committed income posting");
  }
  const [origin] = await tx.select().from(transactionCreateOwnerIntents)
    .where(eq(transactionCreateOwnerIntents.transactionId, posting.id)).for("share");
  if (!origin || origin.householdId !== actor.householdId || origin.operation !== "grz_coupon" || !origin.postingConfirmed ||
      origin.idempotencyKey !== grzCouponPaymentKey(payment.id) || posting.idempotencyKey !== origin.idempotencyKey) {
    throw new ConflictError("Original coupon posting operation cannot be established");
  }
  // The CREATE audit shares the ledger commit. Later edits to a posting or
  // schedule cannot establish what gross and withholding were booked. A new
  // signer may use confidential original proof only after the current grant,
  // cash and custody checks above; attribution binds to the sealed origin.
  const originalPosting = { accountId: posting.accountId, amount: posting.amount, currency: posting.currency,
    date: posting.date, type: posting.type };
  const audits = await tx.select({
    householdId: auditLogs.householdId, userId: auditLogs.userId,
    original: sql<boolean>`(${auditLogs.details}->'newValue') @> ${JSON.stringify(originalPosting)}::jsonb`,
    hasBreakdown: sql<boolean>`${auditLogs.details} ? 'grzCoupon'`,
    matches: sql<boolean>`(${auditLogs.details}->'grzCoupon') = ${JSON.stringify(couponReceipt(payment))}::jsonb`,
  }).from(auditLogs).where(and(eq(auditLogs.entityType, "transaction"),
    eq(auditLogs.entityId, posting.id), eq(auditLogs.action, "CREATE"))).limit(2).for("share");
  if (audits.length !== 1 || audits[0].userId !== origin.actorUserId ||
      (audits[0].householdId !== null && audits[0].householdId !== actor.householdId) ||
      !audits[0].original || (audits[0].hasBreakdown && !audits[0].matches)) {
    throw new ConflictError("Coupon recovery conflicts with the original posting terms");
  }
  const breakdown = audits[0].hasBreakdown
    ? { grossAmount: payment.grossAmount, withholdingTax: payment.withholdingTax, netAmount: posting.amount }
    : { netAmount: posting.amount, breakdownEvidence: "legacy_net_only" };
  return { payment, bond, posting, breakdown };
}
