import { z } from "zod";

/**
 * Investment Validation Schemas
 */

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (dateStr) => {
      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) return false;
      // Ensure parsed date matches input (catches Feb 30, etc.)
      const [year, month, day] = dateStr.split("-").map(Number);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      );
    },
    { message: "Invalid date - the date does not exist" }
  );
const decimalSchema = z
  .union([z.string(), z.number()])
  .transform((val) => String(val));

// Enum values matching database schema
const securityTypes = [
  "stock",
  "bond",
  "etf",
  "mutual_fund",
  "unit_trust",
  "term_deposit",
  "tbill",
  "forex",
  "crypto",
  "other",
] as const;

const securityExchanges = [
  "luse",
  "nyse",
  "nasdaq",
  "jse",
  "otc",
  "boz",
  "manual",
] as const;

// ============================================================================
// Securities
// ============================================================================

export const listSecuritiesQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(securityTypes).optional(),
  exchange: z.enum(securityExchanges).optional(),
  currency: z.string().optional(),
});

export const getSecurityPricesQuerySchema = z.object({
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createSecuritySchema = z.object({
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(255),
  type: z.enum(securityTypes),
  currency: z.string().length(3).default("ZMW"),
  exchange: z.enum(securityExchanges).optional().nullable(),
  isOffshore: z.boolean().optional().default(false),
  sector: z.string().max(100).optional().nullable(),
  cusipIsin: z.string().max(20).optional().nullable(),
  currentPrice: decimalSchema.optional().nullable(),
  withholdingTaxRate: decimalSchema.optional().nullable(),
});

export const updateSecurityPriceSchema = z.object({
  price: decimalSchema,
  date: dateSchema.optional(),
});

// ============================================================================
// Holdings
// ============================================================================

export const listHoldingsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  currency: z.string().optional(),
});

export const createHoldingSchema = z.object({
  accountId: z.string().uuid(),
  securityId: z.string().uuid(),
  quantity: decimalSchema,
  costBasis: decimalSchema,
  costBasisZmw: decimalSchema.optional(),
  acquiredDate: dateSchema,
  acquisitionFxRate: decimalSchema.optional(),
});

export const updateHoldingSchema = z.object({
  quantity: decimalSchema.optional(),
  costBasis: decimalSchema.optional(),
  costBasisZmw: decimalSchema.optional(),
  acquiredDate: dateSchema.optional(),
  acquisitionFxRate: decimalSchema.optional(),
});

// ============================================================================
// Portfolio
// ============================================================================

export const portfolioSummaryQuerySchema = z.object({
  currency: z.string().optional(),
});

export const performanceQuerySchema = z.object({
  timeframe: z.enum(["1M", "3M", "YTD", "1Y", "ALL"]).optional(),
});

// ============================================================================
// Transactions
// ============================================================================

// Match database enum: investmentTransactionTypeEnum
export const investmentTransactionTypes = [
  "buy",
  "sell",
  "dividend",
  "interest",
  "fee",
  "split",
  "transfer_in",
  "transfer_out",
  "coupon",
  "maturity",
] as const;

export const listInvestmentTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export const listTaxLotsQuerySchema = z.object({
  holdingId: z.string().uuid().optional(),
  includeDisposals: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export const createInvestmentTransactionSchema = z
  .object({
    accountId: z.string().uuid(),
    securityId: z.string().uuid().optional().nullable(),
    holdingId: z.string().uuid().optional().nullable(),
    type: z.enum(investmentTransactionTypes),
    quantity: decimalSchema.optional(),
    price: decimalSchema.optional(),
    amount: decimalSchema,
    currency: z.string().default("ZMW"),
    amountZmw: decimalSchema.optional(),
    fxRate: decimalSchema.optional(),
    transactionDate: dateSchema,
  })
  .superRefine((data, ctx) => {
    // H2 FIX: Conditional validation based on transaction type
    const { type, holdingId, securityId, quantity, price } = data;

    // Buy/Sell transactions require holding, security, quantity, and price
    if (type === "buy" || type === "sell") {
      if (!holdingId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["holdingId"],
          message: `holdingId is required for ${type} transactions`,
        });
      }
      if (!securityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["securityId"],
          message: `securityId is required for ${type} transactions`,
        });
      }
      if (!quantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: `quantity is required for ${type} transactions`,
        });
      }
      if (!price) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: `price is required for ${type} transactions`,
        });
      }
    }

    // Dividend/Interest/Coupon require holding and security
    if (
      type === "dividend" ||
      type === "interest" ||
      type === "coupon"
    ) {
      if (!holdingId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["holdingId"],
          message: `holdingId is required for ${type} transactions`,
        });
      }
      if (!securityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["securityId"],
          message: `securityId is required for ${type} transactions`,
        });
      }
    }

    // Split requires holding and quantity (ratio)
    if (type === "split") {
      if (!holdingId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["holdingId"],
          message: "holdingId is required for split transactions",
        });
      }
      if (!quantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "quantity is required for split transactions (split ratio)",
        });
      }
    }

    // Transfer in/out require security and quantity
    if (type === "transfer_in" || type === "transfer_out") {
      if (!securityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["securityId"],
          message: `securityId is required for ${type} transactions`,
        });
      }
      if (!quantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: `quantity is required for ${type} transactions`,
        });
      }
    }

    // Maturity requires holding
    if (type === "maturity") {
      if (!holdingId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["holdingId"],
          message: "holdingId is required for maturity transactions",
        });
      }
    }

    // Fee transactions only require amount (already in base schema)
  });

// ============================================================================
// FX Rates
// ============================================================================

export const listFxRatesQuerySchema = z.object({
  from: z.string().length(3).optional(),
  to: z.string().length(3).optional(),
});

export const createFxRateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: decimalSchema,
  date: dateSchema.optional(),
  source: z.string().max(50).optional().default("manual"),
});

export const fxHistoricalQuerySchema = z.object({
  from: z.string().length(3).default("USD"),
  to: z.string().length(3).default("ZMW"),
  limit: z.coerce.number().int().positive().max(365).optional().default(30),
});

// Type exports
export type ListSecuritiesQuery = z.infer<typeof listSecuritiesQuerySchema>;
export type GetSecurityPricesQuery = z.infer<
  typeof getSecurityPricesQuerySchema
>;
export type CreateSecurityInput = z.infer<typeof createSecuritySchema>;
export type UpdateSecurityPriceInput = z.infer<typeof updateSecurityPriceSchema>;
export type ListHoldingsQuery = z.infer<typeof listHoldingsQuerySchema>;
export type CreateHoldingInput = z.infer<typeof createHoldingSchema>;
export type UpdateHoldingInput = z.infer<typeof updateHoldingSchema>;
export type CreateInvestmentTransactionInput = z.infer<
  typeof createInvestmentTransactionSchema
>;
export type ListInvestmentTransactionsQuery = z.infer<
  typeof listInvestmentTransactionsQuerySchema
>;
export type ListTaxLotsQuery = z.infer<typeof listTaxLotsQuerySchema>;
export type ListFxRatesQuery = z.infer<typeof listFxRatesQuerySchema>;
export type CreateFxRateInput = z.infer<typeof createFxRateSchema>;
export type FxHistoricalQuery = z.infer<typeof fxHistoricalQuerySchema>;
