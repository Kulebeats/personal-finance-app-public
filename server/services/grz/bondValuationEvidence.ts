import Decimal from "decimal.js";
import { sql, type SQLWrapper } from "drizzle-orm";
import type { GrzBondValuation } from "@shared/grz-bond-valuation-schema";
import { grzBondValuations } from "@shared/grz-bond-valuation-schema";
import { grzBondPayments, grzBonds, transactions, transactionCreateOwnerIntents, type GrzBond } from "@shared/schema";
import { grzCouponPaymentKey } from "./couponPaymentKey";
import { isDeepStrictEqual } from "node:util";
import { Money } from "../../core/money";

export const GRZ_VALUATION_POLICY = "grz_member_recorded_market_v1";
export type MarketEvidence = Omit<GrzBondValuation, "recordedAt">;
export const validQuote = (value: unknown): value is string => typeof value === "string" && /^\d{1,13}(?:\.\d{1,8})?$/.test(value);
const sourceKinds = ["custodian_statement", "same_issue_quote", "same_issue_trade"];
const Price = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

// Drizzle removes bare column qualifiers in single-table select projections.
// Here an unqualified id resolves to the inner installment or quote instead.
export const outerBondId = sql`${grzBonds}.id`;

type CouponState = { id: string; status: string; incomeId: string | null };

export function withCouponPostingKeys(state: CouponState[]) {
  return state.map(payment => ({ ...payment, postingKey: grzCouponPaymentKey(payment.id) }));
}

// The first ledger commit and the installment finalization may be separated by
// a crash. The ledger's stable payment key also covers old receipts without an audit breakdown.
export function hasUnreconciledCouponCash(state: SQLWrapper, householdId: SQLWrapper) {
  return sql<boolean>`exists (select 1 from jsonb_array_elements(${state}) coupon
    join ${transactions} cash on cash.idempotency_key=(coupon->>'postingKey')::uuid
    where cash.household_id=${householdId}
      and not exists (select 1 from ${transactionCreateOwnerIntents} origin where origin.transaction_id=cash.id
        and origin.household_id=cash.household_id and origin.idempotency_key=cash.idempotency_key
        and origin.posting_confirmed and origin.operation<>'grz_coupon')
      and (coupon->>'status' is distinct from 'paid'
      or coupon->>'incomeId' is distinct from cash.id::text))`;
}

/** Paid cash and unpaid accrued entitlement cannot silently share an old mark. */
export function bondCouponStateSql(bondId: SQLWrapper) {
  return sql<CouponState[]>`coalesce((select jsonb_agg(jsonb_build_object('id',p.id::text,'paymentDate',p.payment_date::text,
    'gross',p.gross_amount::text,'withheld',p.withholding_tax::text,'net',p.net_amount::text,'status',p.status,
    'actualDate',p.actual_payment_date::text,'incomeId',p.income_transaction_id::text,'investmentId',p.investment_transaction_id::text)
    order by p.id) from ${grzBondPayments} p where p.bond_id=${bondId} and p.payment_type='coupon'),'[]'::jsonb)`;
}

/** Use the same exact-date selection and decimal-string projection in both cuts. */
export function bondMarketEvidenceRowSql() {
  return sql<MarketEvidence>`jsonb_build_object('id',v.id::text,'sequence',v.sequence,'householdId',v.household_id::text,
    'bondId',v.bond_id::text,'accountId',v.account_id::text,'operationId',v.operation_id::text,'intentHash',v.intent_hash,
    'recordedBy',v.recorded_by::text,'authority',v.authority,'isin',v.isin,'nominalAmount',v.nominal_amount::text,'currency',v.currency,
    'valuationDate',v.valuation_date::text,'sourceDate',v.source_date::text,'sourceKind',v.source_kind,'sourceReference',v.source_reference,
    'quoteBasis',v.quote_basis,'quoteUnits',v.quote_units,'quotedAmount',v.quoted_amount::text,'accruedQuote',v.accrued_quote::text,
    'cleanValue',v.clean_value::text,'dirtyValue',v.dirty_value::text,'accruedValue',v.accrued_value::text,
    'couponState',v.coupon_state,'policyVersion',v.policy_version)`;
}

export function bondMarketEvidenceSql(bondId: SQLWrapper, asOfDate: string) {
  return sql<MarketEvidence | null>`(select case when ${hasUnreconciledCouponCash(sql`v.coupon_state`, sql`v.household_id`)}
    then null else ${bondMarketEvidenceRowSql()} end
    from ${grzBondValuations} v where v.bond_id=${bondId} and v.valuation_date=${asOfDate}::date order by v.sequence desc limit 1)`;
}

export function deriveGrzMarketValue(nominal: string, basis: string, units: string, quote: string, accrued: string | null) {
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(nominal) || !validQuote(quote) || (accrued !== null && !validQuote(accrued)) ||
      !["clean", "dirty"].includes(basis) || !["holding_amount", "per_100_nominal"].includes(units) || (basis === "clean" && accrued === null)) throw new Error("Invalid market evidence");
  const face = new Price(nominal), price = new Price(quote);
  if (!face.gt(0) || !price.gt(0)) throw new Error("Invalid market evidence");
  const factor = units === "per_100_nominal" ? face.div(100) : 1;
  const holding = price.times(factor);
  const interest = accrued === null ? null : new Price(accrued).times(factor);
  const full = basis === "clean" ? holding.plus(interest!) : holding;
  const clean = interest === null ? null : basis === "clean" ? holding : full.minus(interest);
  if (clean?.isNegative()) throw new Error("Invalid market evidence");
  const dirtyValue = full.toDecimalPlaces(2), cleanValue = clean?.toDecimalPlaces(2) ?? null;
  // Round total and clean once; assign any cent residual to accrued so the
  // displayed components foot. Original same-unit quotes remain in evidence.
  const accruedValue = cleanValue === null ? null : dirtyValue.minus(cleanValue);
  if ([dirtyValue, cleanValue, accruedValue].some(value => value !== null && value.gt("9999999999999.99"))) throw new Error("Invalid market evidence");
  return { dirtyValue: dirtyValue.toFixed(2), cleanValue: cleanValue?.toFixed(2) ?? null, accruedValue: accruedValue?.toFixed(2) ?? null };
}

/** Absence, changed issue/account/nominal, stale coupons and unproven sources stay unvalued. */
export function verifiedBondMarketValue(bond: Pick<GrzBond, "id" | "householdId" | "accountId" | "isin" | "faceValue" | "status" | "purchaseDate" | "maturityDate">,
  evidence: MarketEvidence | null, couponState: CouponState[], asOfDate: string) {
  if (!evidence || bond.status !== "active" || evidence.householdId !== bond.householdId || evidence.bondId !== bond.id ||
    evidence.accountId !== bond.accountId || evidence.isin !== bond.isin || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(evidence.isin) ||
    evidence.nominalAmount !== bond.faceValue || evidence.currency !== "ZMW" || evidence.valuationDate !== asOfDate || evidence.sourceDate !== asOfDate ||
    asOfDate < bond.purchaseDate || asOfDate > bond.maturityDate || evidence.authority !== "member_recorded" ||
    evidence.policyVersion !== GRZ_VALUATION_POLICY || !sourceKinds.includes(evidence.sourceKind) || !evidence.sourceReference.trim() ||
    !isDeepStrictEqual(evidence.couponState, withCouponPostingKeys(couponState))) return null;
  try {
    const amounts = deriveGrzMarketValue(bond.faceValue, evidence.quoteBasis, evidence.quoteUnits, evidence.quotedAmount, evidence.accruedQuote);
    if (amounts.dirtyValue !== evidence.dirtyValue || amounts.cleanValue !== evidence.cleanValue || amounts.accruedValue !== evidence.accruedValue) return null;
    return { dirty: new Money(amounts.dirtyValue, "ZMW"), clean: amounts.cleanValue === null ? null : new Money(amounts.cleanValue, "ZMW") };
  } catch { return null; }
}
