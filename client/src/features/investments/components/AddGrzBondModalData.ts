import * as z from "zod";

export const grzBondFormSchema = z.object({
  bondName: z.string().min(1, "Bond Name is required"),
  isin: z.string().optional(),
  accountId: z.string().uuid().optional().nullable(),
  tenorYears: z.coerce.number().min(1, "Tenor is required"),
  faceValue: z.coerce.number().min(0.01, "Face Value must be positive"),
  purchasePrice: z.coerce.number().min(0.01, "Purchase Price must be positive"),
  purchaseDate: z.string().min(1, "Purchase Date is required"),
  couponRate: z.preprocess(value => value === "" ? undefined : value, z.coerce.number()
    .min(0, "Rate must be positive")
    .max(100, "Rate cannot exceed 100%")),
  firstCouponDate: z.string().date("Enter the contractual coupon date"),
  maturityDate: z.string().date("Enter the contractual maturity date"),
}).refine(terms => terms.firstCouponDate >= terms.purchaseDate && terms.firstCouponDate <= terms.maturityDate, {
  path: ["firstCouponDate"], message: "Enter a coupon date between purchase and maturity",
});
