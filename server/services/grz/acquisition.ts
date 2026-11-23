import { z } from "zod";
import { insertGrzBondSchema, insertGrzTBillSchema } from "@shared/schema";
import { Money } from "../../core/money";
import { isValidDateString } from "../../utils/dateUtils";

const common = { accountId: true, isin: true, faceValue: true, purchasePrice: true, purchaseDate: true,
  maturityDate: true, csdAccountNumber: true, purchaseYield: true } as const;
const initialState = { status: z.literal("active").optional() };
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_AMOUNT = "9999999999999.99";

/** A positive ZMW amount written as a plain two-decimal string (NEW-23). */
export function isPositiveAmount(value: unknown): value is string {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return false;
  const amount = new Money(value, "ZMW");
  return amount.gt(0) && amount.lte(MAX_AMOUNT);
}

interface AcquisitionTerms { faceValue: string; purchasePrice: string; purchaseDate: string; maturityDate: string }

function refineAcquisition(value: AcquisitionTerms, ctx: z.RefinementCtx, tenor: { path: string; value: number }) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (!isPositiveAmount(value.faceValue)) issue("faceValue", "Face value must be a positive amount with at most two decimals");
  if (!isPositiveAmount(value.purchasePrice)) issue("purchasePrice", "Purchase price must be a positive amount with at most two decimals");
  if (!isValidDateString(value.purchaseDate)) issue("purchaseDate", "Purchase date must be a valid calendar date");
  if (!isValidDateString(value.maturityDate)) issue("maturityDate", "Maturity date must be a valid calendar date");
  else if (value.maturityDate <= value.purchaseDate) issue("maturityDate", "Maturity must fall after the purchase date");
  if (!Number.isInteger(tenor.value) || tenor.value <= 0) issue(tenor.path, "Tenor must be a positive whole number");
}

// Only acquisition evidence is writable here. Disposal, rollover, cash receipts
// and audit fields are assigned by their own transactions.
export const recordBondSchema = insertGrzBondSchema.pick({ ...common, bondName: true, tenorYears: true,
  acquisitionType: true, couponRate: true, couponFrequency: true, firstCouponDate: true, csdReference: true,
}).extend(initialState).strict()
  .superRefine((value, ctx) => refineAcquisition(value, ctx, { path: "tenorYears", value: value.tenorYears }));

// A bill bought at face is a valid zero-interest holding; above face is not.
// A-42: a bill must name the account its maturity pays into, or the maturity
// job can never settle it.
export const recordBillSchema = insertGrzTBillSchema.pick({ ...common, tbillName: true, tenorDays: true })
  .extend({ ...initialState, accountId: z.string().uuid("Choose the account this T-bill matures into") }).strict()
  .superRefine((value, ctx) => {
    refineAcquisition(value, ctx, { path: "tenorDays", value: value.tenorDays });
    if (isPositiveAmount(value.faceValue) && isPositiveAmount(value.purchasePrice) &&
        new Money(value.purchasePrice, "ZMW").gt(new Money(value.faceValue, "ZMW"))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePrice"], message: "A T-bill cannot be bought above its face value" });
    }
  });
