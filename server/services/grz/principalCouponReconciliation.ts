import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { accounts, grzBondPayments, transactions } from "@shared/schema";
import { grzBondValuations } from "@shared/grz-bond-valuation-schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { grzCouponPaymentKey } from "./couponPaymentKey";

export interface PrincipalCouponProof {
  policyVersion: "grz_principal_coupon_reconciled_v1";
  payments: Array<{ paymentId: string; dueDate: string; grossAmount: string; withholdingTax: string;
    netAmount: string; actualPaymentDate: string | null; receiptTransactionId: string | null;
    schedulePolicyVersion: "grz_app_schedule_15pct_v1" }>;
}

/** The caller holds the household/grant and bond first. Freeze coupon cash
 * before accounts, matching the ordinary ledger's transaction -> account order.
 * Invisible coupon inputs never become a public receipt or an inferred amount. */
export async function lockPrincipalCouponSources(tx: TransactionType, actor: HouseholdContext, bondId: string,
  maturityDate: string, custodyId: string | null, destinationId: string, principalReceiptId?: string | null) {
  const coupons = await tx.select().from(grzBondPayments).where(and(eq(grzBondPayments.bondId, bondId),
    eq(grzBondPayments.paymentType, "coupon"))).orderBy(grzBondPayments.id).for("share");
  const [mark] = await tx.select({ state: grzBondValuations.couponState }).from(grzBondValuations)
    .where(and(eq(grzBondValuations.bondId, bondId), eq(grzBondValuations.valuationDate, maturityDate)))
    .orderBy(desc(grzBondValuations.sequence)).limit(1).for("share");
  const ids = new Set<string>(principalReceiptId ? [principalReceiptId] : []);
  // A later or legacy schedule revision may no longer contain an installment.
  // Its original atomic booking still belongs to this bond and must be frozen
  // before account locks, including when its cash has since been withdrawn.
  const booked = await tx.execute<{ id: string }>(sql`select distinct history.entity_id as id from public.audit_logs history
    where history.entity_type='transaction' and history.action='CREATE' and history.details ? 'grzCoupon'
      and history.details->'grzCoupon'->>'bondId'=${bondId} and history.details->'newValue'->>'type'='income'`);
  for (const receipt of booked.rows) ids.add(receipt.id);
  const keys = new Set(coupons.map(coupon => grzCouponPaymentKey(coupon.id)));
  for (const coupon of coupons) if (coupon.incomeTransactionId) ids.add(coupon.incomeTransactionId);
  for (const item of mark?.state ?? []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id)) keys.add(grzCouponPaymentKey(row.id));
    if (typeof row.incomeId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.incomeId)) ids.add(row.incomeId);
  }
  const cash = ids.size || keys.size ? await tx.select({ accountId: transactions.accountId, private: transactions.isPrivate }).from(transactions)
    .where(and(eq(transactions.householdId, actor.householdId), or(
      ids.size ? inArray(transactions.id, Array.from(ids)) : sql`false`,
      keys.size ? inArray(transactions.idempotencyKey, Array.from(keys)) : sql`false`)))
    .orderBy(transactions.id).for("update") : [];
  const accountIds = Array.from(new Set([destinationId, ...(custodyId ? [custodyId] : []), ...cash.map(row => row.accountId)])).sort();
  const lockedAccounts = await tx.select({ id: accounts.id, private: accounts.isPrivate }).from(accounts).where(and(eq(accounts.householdId, actor.householdId),
    inArray(accounts.id, accountIds))).orderBy(accounts.id).for("update");
  return cash.some(row => row.private) || lockedAccounts.some(row => row.private);
}

/** The same database proof is enforced by the deferred settlement guard. */
export async function readPrincipalCouponProof(tx: TransactionType, actor: HouseholdContext, bondId: string, valuationId: string,
  receiptDate: string): Promise<PrincipalCouponProof | null> {
  const result = await tx.execute<{ proof: PrincipalCouponProof | null }>(sql`select public.grz_principal_coupon_proof(
    ${bondId}::uuid,${valuationId}::uuid,${receiptDate}::date,${actor.userId}::uuid) as proof`);
  return result.rows[0]?.proof ?? null;
}
