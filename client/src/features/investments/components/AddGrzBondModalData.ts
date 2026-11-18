import * as z from "zod";

export const RECENT_AUCTION_RATES: Record<number, number> = {
  2: 15.0,
  3: 16.0,
  5: 16.49,
  7: 17.0,
  10: 17.5,
  15: 18.99,
};

export const grzBondFormSchema = z.object({
  bondName: z.string().min(1, "Bond Name is required"),
  isin: z.string().optional(),
  tenorYears: z.coerce.number().min(1, "Tenor is required"),
  faceValue: z.coerce.number().min(0.01, "Face Value must be positive"),
  purchasePrice: z.coerce.number().min(0.01, "Purchase Price must be positive"),
  purchaseDate: z.string().min(1, "Purchase Date is required"),
  couponRate: z.coerce
    .number()
    .min(0, "Rate must be positive")
    .max(100, "Rate cannot exceed 100%"),
  maturityDate: z.string().min(1, "Maturity Date is required"),
});
