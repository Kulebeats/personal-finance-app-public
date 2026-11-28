import * as z from "zod";

export const tbillFormSchema = z.object({
  tbillName: z.string().min(1, "T-Bill Name is required"),
  isin: z.string().optional(),
  // A-42: the maturity run pays into this account, so it is required.
  accountId: z.string().min(1, "Choose the account this T-bill matures into"),
  tenorDays: z.coerce.number().min(1, "Tenor is required"),
  faceValue: z.coerce.number().min(0.01, "Face Value must be positive"),
  purchasePrice: z.coerce.number().min(0.01, "Purchase Price must be positive"),
  purchaseDate: z.string().min(1, "Purchase Date is required"),
  maturityDate: z.string().min(1, "Maturity Date is required"),
});
