import { sql } from "drizzle-orm";
import { accounts, investmentTransactions, transactions } from "@shared/schema";
import type { HouseholdContext } from "../middleware/householdGuard";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { Money } from "../core/money";
import { HttpError } from "../core/errors";
import { isValidDateString } from "../utils/dateUtils";
import { grzCouponPaymentKey } from "../services/grz/couponPaymentKey";
import type { TaxActivity } from "./InvestmentTaxRead";

export class InvestmentTaxDataUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
  constructor() { super("Investment tax amounts require supported currency and original income evidence"); }
}

interface Original { userId: string | null; householdId: string | null; details: unknown }
export interface GrzTaxCouponSource {
  id: string; accountId: string; amount: string; currency: string | null; date: string; type: string;
  postingMode: string | null; postedBalanceDelta: string | null; postedAccountIsAsset: boolean | null; isPending: boolean;
  idempotencyKey: string | null; originKey: string | null; originActor: string | null; originConfirmed: boolean | null; operation: string | null;
  bondId: string | null; bondName: string | null; sourcePaymentId: string | null; linkedPaymentId: string | null; originals: Original[]; today: string;
}

/** Embedded in the same statement as membership and all other tax inputs.
 * A public cash account never expands the original custody's audience. */
export function grzTaxCouponSources(actor: HouseholdContext, today: string) {
  const visible = { ...actor, role: "member" as const };
  return sql`
    select ${transactions.id}::text as id,${transactions.accountId}::text as "accountId",${transactions.amount}::text as amount,
      ${transactions.currency} as currency,${transactions.date}::text as date,${transactions.type} as type,
      ${transactions.postingMode} as "postingMode",${transactions.postedBalanceDelta}::text as "postedBalanceDelta",
      ${transactions.postedAccountIsAsset} as "postedAccountIsAsset",${transactions.isPending} as "isPending",
      ${transactions.idempotencyKey}::text as "idempotencyKey",origin.idempotency_key::text as "originKey",
      origin.actor_user_id::text as "originActor",origin.posting_confirmed as "originConfirmed",origin.operation,
      bond.id::text as "bondId",bond.bond_name as "bondName",proof.originals,
      coalesce(linked_payment.id,booked_payment.id)::text as "sourcePaymentId",linked_payment.id::text as "linkedPaymentId",
      ${today}::text as today
    from ${transactions}
    left join public.transaction_create_owner_intents origin on origin.transaction_id=${transactions.id}
      and origin.household_id=${transactions.householdId}
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('userId',history.user_id,'householdId',history.household_id,'details',history.details) order by history.id),'[]'::jsonb) as originals
      from public.audit_logs history where history.entity_type='transaction' and history.action='CREATE' and history.entity_id=${transactions.id}
    ) proof on true
    left join public.grz_bond_payments booked_payment on booked_payment.payment_type='coupon'
      and booked_payment.id::text=proof.originals->0->'details'->'grzCoupon'->>'paymentId'
    left join public.grz_bond_payments linked_payment on linked_payment.payment_type='coupon' and linked_payment.income_transaction_id=${transactions.id}
    left join public.grz_bonds bond on bond.household_id=${actor.householdId}::uuid and bond.id=coalesce(linked_payment.bond_id,booked_payment.bond_id)
    where exists(select 1 from allowed_member) and ${visibleTransactionPredicate(visible)}
      and (origin.operation='grz_coupon' or exists(select 1 from public.grz_bond_payments payment join public.grz_bonds parent on parent.id=payment.bond_id
        where parent.household_id=${actor.householdId}::uuid and payment.payment_type='coupon' and payment.income_transaction_id=${transactions.id}))
      and ((bond.id is not null and (exists(select 1 from ${accounts} where ${accounts.id}=bond.account_id and ${visibleAccountPredicate(visible)})
          or (bond.account_id is null and origin.actor_user_id=${actor.userId}::uuid)))
        or (bond.id is null and origin.actor_user_id=${actor.userId}::uuid))`;
}

/** Only an explicit foreign key/source relation identifies a second
 * representation. Equal values, dates or UUIDs in different tables do not. */
export function distinctManualTaxIncome(actor: HouseholdContext) {
  return sql`(${investmentTransactions.type} not in ('interest','dividend','coupon') or (
    not exists(select 1 from public.transaction_create_owner_intents origin where origin.household_id=${actor.householdId}::uuid
      and origin.operation='grz_coupon' and origin.transaction_id=${investmentTransactions.linkedTransactionId})
    and not exists(select 1 from public.grz_bond_payments payment join public.grz_bonds bond on bond.id=payment.bond_id
      where bond.household_id=${actor.householdId}::uuid and payment.payment_type='coupon'
        and (payment.investment_transaction_id=${investmentTransactions.id} or payment.income_transaction_id=${investmentTransactions.linkedTransactionId}))))`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvestmentTaxDataUnavailable();
  return value as Record<string, unknown>;
}
function amount(value: unknown) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new InvestmentTaxDataUnavailable();
  const money = new Money(value, "ZMW");
  if (!money.amount.isFinite() || money.isNegative() || money.gt("9999999999999.99")) throw new InvestmentTaxDataUnavailable();
  return money;
}

/** Verify the actual booked breakdown, never today's coupon/tax rate. The
 * cash and its CREATE evidence committed together even if finalization failed. */
export function verifiedGrzTaxCoupons(rows: GrzTaxCouponSource[], actor: HouseholdContext): TaxActivity[] {
  const seen = new Set<string>();
  const result: TaxActivity[] = [];
  for (const row of rows) {
    // Before a peer can see any amount or error, prove that the selected
    // payment's real parent is bound to this sealed posting key. An altered
    // unfinalized audit cannot choose a different, shared source audience.
    const identified = row.sourcePaymentId && row.bondId && row.operation === "grz_coupon" && row.originConfirmed === true &&
      row.originKey === row.idempotencyKey && grzCouponPaymentKey(row.sourcePaymentId) === row.idempotencyKey;
    // A real finalized link selected through its current custody/cash audience
    // is already an entitled financial source, including pre-intent history.
    // Missing booking evidence makes its tax total unavailable, never zero.
    if (!identified && row.linkedPaymentId !== null) throw new InvestmentTaxDataUnavailable();
    if (!identified && row.originActor !== actor.userId) continue;
    if (!identified) throw new InvestmentTaxDataUnavailable();
    if (seen.has(row.id) || row.originals.length !== 1 || !row.bondId || !row.originActor || row.operation !== "grz_coupon" ||
      row.originConfirmed !== true || row.postingMode !== "posted" || row.isPending || row.type !== "income" || row.currency !== "ZMW") throw new InvestmentTaxDataUnavailable();
    seen.add(row.id);
    const original = row.originals[0], details = object(original.details), booked = object(details.newValue), coupon = object(details.grzCoupon);
    if (original.userId !== row.originActor || (original.householdId !== null && original.householdId !== actor.householdId) ||
      booked.accountId !== row.accountId || booked.amount !== row.amount || booked.currency !== row.currency || booked.date !== row.date || booked.type !== "income" ||
      booked.postingMode !== row.postingMode || booked.postedBalanceDelta !== row.postedBalanceDelta || booked.postedAccountIsAsset !== row.postedAccountIsAsset ||
      coupon.version !== 1 || coupon.paymentType !== "coupon" || coupon.bondId !== row.bondId || coupon.currency !== "ZMW" ||
      typeof coupon.paymentId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(coupon.paymentId) ||
      coupon.paymentId !== row.sourcePaymentId || (row.linkedPaymentId !== null && row.linkedPaymentId !== coupon.paymentId) ||
      typeof coupon.dueDate !== "string" || !isValidDateString(coupon.dueDate) || coupon.dueDate > row.date || row.date > row.today ||
      row.idempotencyKey !== grzCouponPaymentKey(coupon.paymentId) || row.originKey !== row.idempotencyKey) throw new InvestmentTaxDataUnavailable();
    const net = amount(coupon.netAmount), wht = amount(coupon.withholdingTax), gross = amount(coupon.grossAmount);
    if (net.isZero() || !net.equals(amount(row.amount)) || !gross.equals(net.add(wht)) || row.postedBalanceDelta === null ||
      row.postedAccountIsAsset === null || !new Money(row.postedBalanceDelta, "ZMW").equals(row.postedAccountIsAsset ? net : net.negated())) throw new InvestmentTaxDataUnavailable();
    result.push({ id: `grz_coupon:${row.id}`, type: "coupon", amount: net.toString(), withholdingTax: wht.toString(), date: row.date,
      currency: "ZMW", securityName: row.bondName, securitySymbol: null, securityCurrency: "ZMW", holdingCurrency: "ZMW",
      hasIncomeDeclaration: true, validIncomeDeclaration: true, amountZmw: null, fxRate: null, fxProven: false,
      tbillCount: 0, tbillName: null, tbillFaceValue: null, tbillPurchasePrice: null, tbillIncomeAmount: null, tbillIncomeCurrency: null });
  }
  return result;
}
