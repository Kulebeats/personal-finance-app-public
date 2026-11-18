import { uuidv5 } from "../../core/uuidv5";

/**
 * Fixed namespace for investment-automation-cron idempotency keys (R6). Never
 * change this value: it is the seed for every already-persisted key, and
 * changing it would let a previously processed maturity/execution be
 * processed a second time.
 */
const INVESTMENT_CRON_NAMESPACE = "1d1b39d6-641e-461e-9f83-304ddd10485f";

/**
 * Deterministic idempotency key for the ledger (transactions) income row
 * created when a GRZ T-Bill matures.
 *
 * Scheme: uuidv5("tbill-maturity:<billId>", NAMESPACE). Because
 * `transactions.idempotency_key` is a UNIQUE uuid column, two overlapping or
 * retried cron runs that both try to create the maturity interest income
 * transaction for the SAME bill collide on this key — the second insert fails
 * with a unique violation and is treated as an idempotent skip, never a
 * double-payout. This is a defense-in-depth backstop; the primary guard is
 * the `FOR UPDATE` lock + conditional re-check on the bill row itself (see
 * processTBillMaturities.ts).
 */
export function tbillMaturityIncomeKey(billId: string): string {
  return uuidv5(`tbill-maturity:${billId}`, INVESTMENT_CRON_NAMESPACE);
}

/**
 * Deterministic identifier for a SIP/rollover recurring-investment execution
 * on a given due date.
 *
 * Scheme: uuidv5("sip:<planId>:<dueDate>", NAMESPACE).
 *
 * NOTE: unlike the T-Bill maturity leg, a SIP execution does not write to the
 * `transactions` ledger table (buys only ever touch `investment_transactions`
 * and `holdings` — no cash is debited by this cron, consistent with the
 * manual buy/sell flow in investments.service.ts, which never touches
 * `transactions` either). There is therefore no unique DB column to enforce
 * this key against, so it is NOT a `23505`-catchable backstop the way the
 * T-Bill key is. It is embedded in the created investment-transaction's
 * `notes` for traceability. The actual exactly-once guarantee for SIP
 * execution comes from the `FOR UPDATE` lock + conditional due-date re-check
 * on the `recurring_investments` row (see processDueInvestments.ts).
 */
export function sipExecutionKey(planId: string, dueDate: string): string {
  return uuidv5(`sip:${planId}:${dueDate}`, INVESTMENT_CRON_NAMESPACE);
}
