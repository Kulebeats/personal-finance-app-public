import { z } from "zod";
import type { GrzBond, GrzBondPayment } from "@shared/schema";
import { Money } from "../../core/money";
import { ValidationError } from "../../core/errors";
import { isValidDateString } from "../../utils/dateUtils";
import type { PrincipalBasis } from "./principalBasis";
import type { PrincipalCouponProof } from "./principalCouponReconciliation";

const currency = "ZMW";
const decimal = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const amount = z.object({ amount: decimal, currency: z.literal(currency) }).strict();
export const principalSettlementInput = z.object({
  operationId: z.string().uuid().transform(value => value.toLowerCase()),
  accountId: z.string().uuid().transform(value => value.toLowerCase()),
  date: z.string().refine(isValidDateString, "A valid receipt date is required"),
  receiptConfirmed: z.boolean(),
  receivedAmount: amount,
  fees: amount,
  receiptTransactionId: z.string().uuid().transform(value => value.toLowerCase()).optional(),
}).strict();
export type PrincipalSettlementInput = z.infer<typeof principalSettlementInput>;
/** Only the authoritative resolver may supply this proof. HTTP input cannot. */
export interface PrincipalValuation {
  amount: Money;
  includedCouponAmount: Money;
  asOfDate: string;
  sourceKind: string;
  sourceId: string;
  policyVersion: string;
  component: "ex_coupon_principal";
  couponReconciliation: PrincipalCouponProof | null;
}
function money(value: string, allowZero = false) {
  let result: Money;
  try { result = new Money(value, currency); } catch { throw new ValidationError("Invalid principal settlement amount"); }
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !result.amount.isFinite() || result.isNegative() ||
      (!allowZero && result.isZero()) || result.gt(new Money("9999999999999.99", currency))) {
    throw new ValidationError("Principal settlement amount is outside the supported range");
  }
  return result;
}

/** Face redemption, acquisition basis, prior valuation and actual cash are
 * separate amounts. No rate, tax, carrying value or receipt is inferred. */
export function principalSettlementTerms(bond: GrzBond, payment: GrzBondPayment, input: PrincipalSettlementInput,
  valuation: PrincipalValuation | null, basis: PrincipalBasis | null, today: string) {
  if (payment.bondId !== bond.id || payment.paymentType !== "principal" || payment.paymentDate !== bond.maturityDate ||
      input.date < payment.paymentDate || input.date > today || payment.paymentDate < bond.purchaseDate) {
    throw new ValidationError("Principal requires a matured entitlement and an actual receipt date");
  }
  const principal = money(payment.grossAmount), face = money(bond.faceValue);
  if (payment.withholdingTax === null || !money(payment.withholdingTax, true).isZero() ||
      !principal.equals(face) || !principal.equals(money(payment.netAmount))) {
    throw new ValidationError("Principal entitlement requires reconciled face redemption and separate withholding");
  }
  const received = money(input.receivedAmount.amount), fees = money(input.fees.amount, true);
  if (!received.add(fees).equals(principal)) throw new ValidationError("Actual receipt plus fees must equal principal redemption");
  const cost = basis ? money(basis.costBasis.toString()) : null;
  const purchasedInterest = basis ? money(basis.purchasedInterest.toString(), true) : null;
  const acquisitionFees = basis ? money(basis.acquisitionFees.toString(), true) : null;
  if (basis && (basis.costBasis.currency !== currency || basis.purchasedInterest.currency !== currency || basis.acquisitionFees.currency !== currency ||
      basis.purchaseCashAmount.currency !== currency || !cost!.add(purchasedInterest!).add(acquisitionFees!).equals(money(bond.purchasePrice)) ||
      !basis.purchaseCashAmount.equals(money(bond.purchasePrice)) || basis.acquisitionDate !== bond.purchaseDate ||
      !isValidDateString(basis.sourceDate) || basis.sourceDate < basis.acquisitionDate || !basis.sourceKind || !basis.sourceId || !basis.policyVersion)) {
    throw new ValidationError("Principal acquisition breakdown requires reconciliation");
  }
  const basisEvidence = basis ? { sourceId: basis.sourceId, sourceKind: basis.sourceKind, sourceDate: basis.sourceDate,
    acquisitionDate: basis.acquisitionDate, purchaseCashAmount: basis.purchaseCashAmount.toString(), policyVersion: basis.policyVersion } : null;
  const base = { kind: "principal" as const, principalAmount: principal.toString(), receivedAmount: received.toString(),
    costBasis: cost?.toString() ?? null, realizedBasisDifference: cost ? principal.subtract(cost).toString() : null,
    purchasedInterest: purchasedInterest?.toString() ?? null, acquisitionFees: acquisitionFees?.toString() ?? null,
    basisEvidence, fees: fees.toString(), currency };
  if (!basis) return { base, valuation: null, unavailableReason: "basis_unavailable" };
  if (valuation && !valuation.couponReconciliation) {
    return { base, valuation: null, unavailableReason: "coupon_component_unresolved" };
  }
  if (!valuation || valuation.component !== "ex_coupon_principal" || valuation.amount.currency !== currency ||
      valuation.includedCouponAmount?.currency !== currency || !valuation.includedCouponAmount.amount.isFinite() || valuation.includedCouponAmount.isNegative() ||
      !isValidDateString(valuation.asOfDate) || valuation.asOfDate !== bond.maturityDate ||
      !valuation.sourceKind || !valuation.sourceId || !valuation.policyVersion) return { base, valuation: null, unavailableReason: "valuation_unavailable" };
  const carrying = money(valuation.amount.toString(), true);
  return { base, valuation: { amount: carrying.toString(), currency, asOfDate: valuation.asOfDate,
    sourceKind: valuation.sourceKind, sourceId: valuation.sourceId, policyVersion: valuation.policyVersion,
    component: valuation.component, includedCouponAmount: valuation.includedCouponAmount.toString(),
    couponReconciliation: valuation.couponReconciliation,
    settlementValueDifference: received.subtract(carrying).toString() }, unavailableReason: null };
}
