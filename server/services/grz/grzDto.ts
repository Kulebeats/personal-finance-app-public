import type { MoneyDto } from "@shared/money";
import { grzBondPayments, grzBonds, grzTBills } from "@shared/schema";
import { toMoneyDto } from "../../core/money";
import { GRZ_COUPON_CURRENCY } from "./couponPaymentAccess";

type BondRow = typeof grzBonds.$inferSelect;
type PaymentRow = typeof grzBondPayments.$inferSelect;
type TBillRow = typeof grzTBills.$inferSelect;

/**
 * NEW-35: GRZ securities answer amounts as MoneyDto `{ amount, currency }`,
 * never a bare string or number. GRZ instruments are ZMW-denominated, so every
 * amount carries GRZ_COUPON_CURRENCY. Rates and yields are ratios, not money,
 * and stay decimal strings. A redacted or unset amount stays null.
 */
const money = (value: string): MoneyDto => toMoneyDto(value, GRZ_COUPON_CURRENCY);
const optionalMoney = (value: string | null): MoneyDto | null => value === null ? null : money(value);

export function grzPaymentDto<T extends PaymentRow>(payment: T) {
  return { ...payment, grossAmount: money(payment.grossAmount),
    withholdingTax: optionalMoney(payment.withholdingTax), netAmount: money(payment.netAmount) };
}

export function grzBondDto<T extends BondRow & { payments?: PaymentRow[] }>(bond: T) {
  return {
    ...bond,
    faceValue: money(bond.faceValue),
    purchasePrice: money(bond.purchasePrice),
    soldPrice: optionalMoney(bond.soldPrice),
    saleFees: optionalMoney(bond.saleFees),
    saleCostBasis: optionalMoney(bond.saleCostBasis),
    saleRealizedGain: optionalMoney(bond.saleRealizedGain),
    ...(bond.payments && { payments: bond.payments.map(grzPaymentDto) }),
  };
}

export function grzTBillDto<T extends TBillRow>(bill: T) {
  return { ...bill, faceValue: money(bill.faceValue), purchasePrice: money(bill.purchasePrice),
    discountAmount: optionalMoney(bill.discountAmount),
    // A-36: booked when the bill falls due; null on an active or legacy matured bill.
    maturityWithholdingTax: optionalMoney(bill.maturityWithholdingTax), maturityNetProceeds: optionalMoney(bill.maturityNetProceeds) };
}
