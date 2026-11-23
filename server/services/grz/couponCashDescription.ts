import { and, eq, sql } from "drizzle-orm";
import { transactions } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { qualified } from "./instrumentIdentity";

export const GRZ_COUPON_CASH_DESCRIPTION = "GRZ coupon income";
export const GRZ_TBILL_INTEREST_DESCRIPTION = "T-Bill interest";

/** Descriptions are a read projection; booked cash and original proof stay intact.
 * A sealed producer or actual coupon receipt link identifies coupon cash. Only
 * one exact original CREATE plus its sealed actor and current shared custody
 * can authorize detailed descriptions. Unknown/legacy evidence stays generic.
 * Ordinary notes are never parsed to invent a holding relationship.
 */
export function identifiedCouponCash() {
  return sql<boolean>`(exists (select 1 from transaction_create_owner_intents coupon_origin
      where coupon_origin.transaction_id = ${transactions.id} and coupon_origin.operation = 'grz_coupon')
    or exists (select 1 from grz_bond_payments coupon_link join grz_bonds coupon_bond on coupon_bond.id = coupon_link.bond_id
      where coupon_link.income_transaction_id = ${transactions.id} and coupon_link.payment_type = 'coupon'
        and coupon_bond.household_id = ${transactions.householdId}))`;
}

/** Raw diffs can contain formerly private descriptors even after custody is shared.
 * Read under the caller's existing cash row locks without acquiring custody in
 * an order opposite to the financial coupon writer.
 */
export async function identifiedCouponCashForAudit(tx: TransactionType, id: string) {
  const [row] = await tx.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.id, id), identifiedCouponCash())).limit(1);
  return row !== undefined;
}

export function protectedCouponCashDescription() {
  return sql<boolean>`(${identifiedCouponCash()}
    and not exists (
      select 1 from grz_bond_payments coupon_payment
      join grz_bonds coupon_bond on coupon_bond.id = coupon_payment.bond_id
      join accounts coupon_custody on coupon_custody.id = coupon_bond.account_id
      join transaction_create_owner_intents coupon_origin on coupon_origin.transaction_id = ${transactions.id}
      where coupon_payment.income_transaction_id = ${transactions.id} and coupon_payment.payment_type = 'coupon'
        and coupon_payment.status = 'paid' and coupon_payment.actual_payment_date = ${transactions.date}
        and coupon_bond.household_id = ${transactions.householdId}
        and coupon_custody.household_id = ${transactions.householdId} and coupon_custody.deleted_at is null and coupon_custody.is_private = false
        and coupon_origin.household_id = ${transactions.householdId} and coupon_origin.operation = 'grz_coupon'
        and coupon_origin.posting_confirmed = true and coupon_origin.idempotency_key = ${transactions.idempotencyKey}
        and ${transactions.type} = 'income' and ${transactions.currency} = 'ZMW' and ${transactions.amount} = coupon_payment.net_amount
        and (select count(*) from audit_logs coupon_count where coupon_count.entity_type = 'transaction'
          and coupon_count.entity_id = ${transactions.id} and coupon_count.action = 'CREATE') = 1
        and exists (select 1 from audit_logs coupon_audit where coupon_audit.entity_type = 'transaction'
          and coupon_audit.entity_id = ${transactions.id} and coupon_audit.action = 'CREATE'
          and coupon_audit.user_id = coupon_origin.actor_user_id
          and (coupon_audit.household_id is null or coupon_audit.household_id = ${transactions.householdId})
          and coupon_audit.details->'newValue' @> jsonb_build_object('accountId', ${transactions.accountId},
            'amount', ${transactions.amount}::text, 'currency', ${transactions.currency}, 'date', ${transactions.date}::text, 'type', ${transactions.type}::text)
          and coupon_audit.details->'grzCoupon' = jsonb_build_object('version', 1, 'paymentId', coupon_payment.id,
            'bondId', coupon_payment.bond_id, 'dueDate', coupon_payment.payment_date::text, 'paymentType', coupon_payment.payment_type::text,
            'grossAmount', coupon_payment.gross_amount::text, 'withholdingTax', coupon_payment.withholding_tax::text,
            'netAmount', coupon_payment.net_amount::text, 'currency', 'ZMW'))
    ))`;
}

/** R1-05: a T-bill's interest names the bill only while its custody is shared, as for coupons. */
export function protectedTBillInterestName() {
  return sql<boolean>`exists (select 1 from grz_tbills interest_bill
    where interest_bill.maturity_income_tx_id = ${qualified(transactions.id)} and interest_bill.household_id = ${qualified(transactions.householdId)}
      and not exists (select 1 from accounts interest_custody where interest_custody.id = interest_bill.account_id
        and interest_custody.household_id = ${qualified(transactions.householdId)} and interest_custody.deleted_at is null
        and interest_custody.is_private = false))`;
}

/** Interest notes carry the bill's face, purchase price and WHT; they follow the name. */
export function couponCashDescriptionFields() {
  const protect = protectedCouponCashDescription();
  const tbill = protectedTBillInterestName();
  return {
    name: sql<string>`case when ${protect} then ${GRZ_COUPON_CASH_DESCRIPTION}
      when ${tbill} then ${GRZ_TBILL_INTEREST_DESCRIPTION} else ${transactions.name} end`,
    notes: sql<string | null>`case when ${protect} or ${tbill} then null else ${transactions.notes} end`,
    originalName: sql<string | null>`case when ${protect} or ${tbill} then null else ${transactions.originalName} end`,
    merchantId: sql<string | null>`case when ${protect} then null else ${transactions.merchantId} end`,
  };
}
