import { uuidv5 } from "../../core/uuidv5";

/**
 * Fixed namespace for GRZ coupon-payment idempotency keys. Never change this
 * value: it is the seed for every already-persisted key, and changing it would
 * let an already-booked coupon be booked to the ledger a second time.
 */
const GRZ_COUPON_PAYMENT_NAMESPACE = "9f2b1c84-6d3a-4f57-8b0e-2c5d7a91e4f6";

/**
 * Deterministic idempotency key for the income transaction booked when a
 * scheduled GRZ bond coupon payment is marked paid.
 *
 * Scheme: uuidv5("grz-coupon:<paymentId>", NAMESPACE). A grz_bond_payments row
 * represents ONE scheduled coupon and can be paid exactly once, so its id is the
 * natural key for the ledger row it produces — no date component is needed to
 * disambiguate (unlike recurring occurrences, where one rule yields many).
 *
 * Because `transactions.idempotency_key` is a UNIQUE uuid column, two concurrent
 * or retried pay requests for the SAME payment derive the SAME key and collide:
 * the second createTransaction returns the first's transaction with
 * isDuplicate=true instead of inserting a second income row. That is what makes
 * the coupon proceeds impossible to double-book even though the ledger write
 * happens outside the payment-row lock.
 *
 * @param paymentId - The grz_bond_payments row id being marked paid.
 */
export function grzCouponPaymentKey(paymentId: string): string {
  return uuidv5(`grz-coupon:${paymentId}`, GRZ_COUPON_PAYMENT_NAMESPACE);
}
