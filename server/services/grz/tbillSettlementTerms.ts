import { createHash } from "node:crypto";
import { z } from "zod";
import type { GrzTBill } from "@shared/schema";
import { Money } from "../../core/money";
import { ValidationError } from "../../core/errors";
import { isValidDateString } from "../../utils/dateUtils";

const ZMW = "ZMW";
/** Withholding tax on T-bill maturity interest (GRZ sovereign debt, 15%). */
export const TBILL_WITHHOLDING_TAX_RATE = "0.15";
const MAX_AMOUNT = new Money("9999999999999.99", ZMW);
const decimal = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

/** A-36: the member's confirmation of the bank credit, in the bond principal shape. */
export const tbillReceiptInput = z.object({
  operationId: z.string().uuid().transform(value => value.toLowerCase()),
  accountId: z.string().uuid().transform(value => value.toLowerCase()),
  date: z.string().refine(isValidDateString, "A valid receipt date is required"),
  receiptConfirmed: z.literal(true, { errorMap: () => ({ message: "Confirm that the bank credited this amount" }) }),
  receivedAmount: z.object({ amount: decimal, currency: z.literal(ZMW) }).strict(),
}).strict();
export type TBillReceiptInput = z.infer<typeof tbillReceiptInput>;

function money(value: string | null, allowZero = false): Money {
  if (value === null) throw new ValidationError("T-bill terms require reconciliation");
  let result: Money;
  try { result = new Money(value, ZMW); } catch { throw new ValidationError("T-bill terms require reconciliation"); }
  if (!result.amount.isFinite() || result.isNegative() || (!allowZero && result.isZero()) || result.gt(MAX_AMOUNT)) {
    throw new ValidationError("T-bill terms require reconciliation");
  }
  return result;
}

/**
 * The withholding booked when a bill falls due, rounded once to the ngwee
 * (A-41), and the proceeds derived from it, so proceeds = face - withholding
 * always holds. A bill bought above face (never accepted since NEW-23) earns no
 * interest and so bears no withholding.
 */
export function tbillMaturityTerms(bill: Pick<GrzTBill, "faceValue" | "purchasePrice">) {
  const face = new Money(bill.faceValue, ZMW), price = new Money(bill.purchasePrice, ZMW);
  const interest = face.subtract(price);
  const gross = interest.isNegative() ? Money.zero(ZMW) : interest;
  const withholding = new Money(gross.multiply(TBILL_WITHHOLDING_TAX_RATE).toString(), ZMW);
  return { withholding, netProceeds: face.subtract(withholding) };
}

export function tbillReceiptDigest(billId: string, input: TBillReceiptInput): string {
  return createHash("sha256").update(JSON.stringify({ version: 1, billId, accountId: input.accountId,
    date: input.date, receivedAmount: input.receivedAmount.amount })).digest("hex");
}

/**
 * The confirmed split: the principal (purchase price) returns as cash and the
 * net interest is income, together exactly the booked proceeds (face less
 * withholding). As for bond principal, an actual receipt that does not equal
 * the entitlement is refused, never booked as a difference.
 */
export function tbillReceiptTerms(bill: GrzTBill, input: TBillReceiptInput, today: string) {
  if (input.date < bill.maturityDate || input.date > today) {
    throw new ValidationError("The receipt date must be on or after maturity and not in the future");
  }
  const face = money(bill.faceValue), principal = money(bill.purchasePrice);
  const withholding = money(bill.maturityWithholdingTax, true), proceeds = money(bill.maturityNetProceeds);
  const netInterest = proceeds.subtract(principal);
  if (!proceeds.equals(face.subtract(withholding)) || netInterest.isNegative()) {
    throw new ValidationError("T-bill terms require reconciliation");
  }
  let received: Money;
  try { received = new Money(input.receivedAmount.amount, ZMW); } catch { throw new ValidationError("Invalid receipt amount"); }
  if (!received.equals(proceeds)) {
    throw new ValidationError("Actual receipt must equal the face value less withholding tax");
  }
  return { principal, netInterest, withholding, proceeds, face };
}
