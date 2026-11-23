import { strictBooleanSchema } from "../../core/validation/query-boolean";
import { z } from "zod";
import Decimal from "decimal.js";
import { Money } from "../../core/money";
import { isInvestmentIncome } from "../../core/money/investment-income";

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
function supportedDeclaredMoney(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
  const amount = new Money(value);
  return amount.amount.isFinite() && !amount.isNegative() && amount.lte("9999999999999.99");
}
const declaredWithholding = decimalSchema.refine(supportedDeclaredMoney,
  "Withholding must be a finite nonnegative currency amount");

const TradeDecimal = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
function reconcilesTradeConversion(amount: string, amountZmw: string, rate: string) {
  return new TradeDecimal(amount).times(rate).toDecimalPlaces(2).eq(amountZmw);
}
function positiveTradeNumber(value: string, integerDigits: number, scale: number) {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return false;
  const number = new TradeDecimal(value);
  return number.isFinite() && number.gt(0) && number.lt(`1e${integerDigits}`) && number.decimalPlaces() <= scale;
}

function exactSecurityPrice(value: string) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(e[+-]?\d+)?$/i.exec(value);
  if (!match || match[0] !== value) return null;

  const price = new TradeDecimal(value);
  if (!price.isFinite() || price.abs().gte("1e11") || price.decimalPlaces() > 4) return null;
  // A very small exponent can make Decimal represent a nonzero mantissa as zero.
  if (price.isZero() && /[1-9]/.test(match[1])) return null;

  const fractionalDigits = match[1].split(".")[1]?.length ?? 0;
  return match[2] || fractionalDigits > 4 ? price.toFixed() : value;
}

const securityPriceSchema = decimalSchema.transform((value, ctx) => {
  const price = exactSecurityPrice(value);
  if (price === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Security price must fit numeric(15,4) exactly" });
    return z.NEVER;
  }
  if (!new TradeDecimal(price).gt(0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Security price must be greater than zero" });
    return z.NEVER;
  }
  return price;
});

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
  currentPrice: z.never({ invalid_type_error: "Security creation accepts metadata only" }).optional(),
  withholdingTaxRate: decimalSchema.optional().nullable(),
});

const securityPriceDateSchema = dateSchema.refine(
  date => !date.startsWith("0000-"),
  "Price date must be in year 0001 or later",
);

export const updateSecurityPriceSchema = z.object({
  price: securityPriceSchema,
  date: securityPriceDateSchema,
  validThrough: securityPriceDateSchema,
}).refine(data => data.validThrough >= data.date, {
  message: "Validity end date must be on or after the effective date",
  path: ["validThrough"],
});

// ============================================================================
// Holdings
// ============================================================================

export const listHoldingsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  currency: z.string().optional(),
});

function supportedOpeningQuantity(value: string) {
  return /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    && (positiveTradeNumber(value, 10, 8) || new TradeDecimal(value).isZero());
}

/** An opening's declared rate is stored at the dated rate's scale (0047). */
const OPENING_RATE_SCALE = 8;

export const createHoldingRequestSchema = z.object({
  operationId: z.string().uuid().transform(value => value.toLowerCase()),
  expectedCurrency: z.string().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()),
  accountId: z.string().uuid(),
  securityId: z.string().uuid(),
  quantity: decimalSchema.refine(supportedOpeningQuantity, "Unsupported opening share quantity"),
  costBasis: decimalSchema.refine(supportedDeclaredMoney, "Unsupported opening cost").nullable(),
  costBasisZmw: decimalSchema.refine(supportedDeclaredMoney, "Unsupported opening base cost").nullable().optional(),
  acquiredDate: dateSchema,
  // Household rates carry 8 places; holdings.acquisition_fx_rate is NUMERIC(18,8) since 0047.
  acquisitionFxRate: decimalSchema.refine(value => positiveTradeNumber(value, 6, OPENING_RATE_SCALE), "Unsupported opening conversion rate").nullable().optional(),
});

export const createHoldingSchema = createHoldingRequestSchema.superRefine((data, ctx) => {
  if (supportedOpeningQuantity(data.quantity)) {
    const zero = new TradeDecimal(data.quantity).isZero();
    if (!zero && data.costBasis === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costBasis"], message: "Declare the original cost for positive opening shares" });
    if (zero && ((data.costBasis !== null && supportedDeclaredMoney(data.costBasis) && !new TradeDecimal(data.costBasis).isZero()) ||
      (data.costBasisZmw != null && supportedDeclaredMoney(data.costBasisZmw) && !new TradeDecimal(data.costBasisZmw).isZero()))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costBasis"], message: "A zero-share shell cannot carry opening cost" });
    }
  }
  if (data.costBasis !== null && supportedDeclaredMoney(data.costBasis) && new TradeDecimal(data.costBasis).isZero()
    && data.costBasisZmw != null && supportedDeclaredMoney(data.costBasisZmw) && !new TradeDecimal(data.costBasisZmw).isZero()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costBasisZmw"], message: "A zero opening cost requires zero or unknown base cost" });
  }
  if (data.costBasis !== null && supportedDeclaredMoney(data.costBasis) && data.costBasisZmw != null && supportedDeclaredMoney(data.costBasisZmw)
    && data.acquisitionFxRate != null && positiveTradeNumber(data.acquisitionFxRate, 6, OPENING_RATE_SCALE)
    && !reconcilesTradeConversion(data.costBasis, data.costBasisZmw, data.acquisitionFxRate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costBasisZmw"], message: "Opening base cost must reconcile to the declared cost and acquisition rate" });
  }
});

export const updateHoldingSchema = z.object({
  quantity: decimalSchema.refine(supportedOpeningQuantity, "Unsupported holding share quantity").optional(),
  costBasis: decimalSchema.refine(supportedDeclaredMoney, "Unsupported holding cost").nullable().optional(),
  costBasisZmw: decimalSchema.refine(supportedDeclaredMoney, "Unsupported holding base cost").nullable().optional(),
  acquiredDate: dateSchema.optional(),
  acquisitionFxRate: decimalSchema.refine(value => positiveTradeNumber(value, 6, OPENING_RATE_SCALE), "Unsupported holding conversion rate").nullable().optional(),
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
  includeDisposals: strictBooleanSchema.optional().default(false),
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
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    fees: decimalSchema.refine(supportedDeclaredMoney, "Invalid trade fee").optional(),
    withholdingTax: declaredWithholding.optional(),
    amountZmw: decimalSchema.optional(),
    fxRate: decimalSchema.optional(),
    transactionDate: dateSchema,
  })
  .superRefine((data, ctx) => {
    // H2 FIX: Conditional validation based on transaction type
    const { type, holdingId, securityId, quantity, price } = data;
    if (data.fees !== undefined && type !== "buy" && type !== "sell") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fees"], message: "Trade fees apply only to buys and sells" });
    }
    if (isInvestmentIncome(type) && !supportedDeclaredMoney(data.amount)) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["amount"], message: "Declared net income must be a finite nonnegative currency amount",
    });
    if (data.withholdingTax !== undefined && !isInvestmentIncome(type)) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["withholdingTax"], message: "Declared withholding requires an income transaction",
    });
    // A claimed conversion is checked for every type, never left to the writer
    // (NEW-21: a malformed rate on an income event was a 500). Rates carry up to
    // 8 places, like the household dated rates they must match.
    const validBase = data.amountZmw === undefined || supportedDeclaredMoney(data.amountZmw);
    const validRate = data.fxRate === undefined || positiveTradeNumber(data.fxRate, 6, 8);
    if (!validBase) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountZmw"], message: "Unsupported ZMW settlement amount" });
    if (!validRate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fxRate"], message: "Unsupported conversion rate" });

    // Buy/Sell transactions require holding, security, quantity, and price
    if (type === "buy" || type === "sell") {
      const validQuantity = !!quantity && positiveTradeNumber(quantity, 10, 8);
      const validPrice = !!price && positiveTradeNumber(price, 11, 4);
      if (validBase && data.amountZmw !== undefined && supportedDeclaredMoney(data.amount)
        && new TradeDecimal(data.amount).isZero() && !new TradeDecimal(data.amountZmw).isZero()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountZmw"], message: "A zero settlement must also have zero converted value" });
      }
      if (validBase && validRate && supportedDeclaredMoney(data.amount) && data.amountZmw !== undefined && data.fxRate !== undefined
        && !reconcilesTradeConversion(data.amount, data.amountZmw, data.fxRate)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountZmw"], message: "Converted amount does not reconcile to the settlement and rate" });
      }
      if (quantity && !validQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Unsupported share quantity" });
      if (price && !validPrice) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "Unsupported share price" });
      if (!supportedDeclaredMoney(data.amount)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Invalid trade settlement amount" });
      if (data.fees !== undefined && supportedDeclaredMoney(data.fees) && validQuantity && validPrice && supportedDeclaredMoney(data.amount)) {
        const gross = new TradeDecimal(quantity!).times(price!).toDecimalPlaces(2);
        const settlement = type === "buy" ? gross.plus(data.fees) : gross.minus(data.fees);
        if (!settlement.eq(data.amount)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Settlement amount must reconcile to price, quantity and fees" });
      }
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

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter code");
const HOUSEHOLD_FX_RATE_LIMIT = "100000000000";
function supportedHouseholdFxRate(value: string) {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) return false;
  const rate = new Decimal(value);
  return rate.isFinite() && rate.gt(0) && rate.lt(HOUSEHOLD_FX_RATE_LIMIT);
}

// R12: a household manual rate, valid from `date` through `validThrough` inclusive.
// The source is always "manual"; a caller-chosen label is never accepted.
export const createFxRateSchema = z.object({
  fromCurrency: currencyCodeSchema,
  toCurrency: currencyCodeSchema,
  rate: decimalSchema.refine(supportedHouseholdFxRate,
    "Exchange rate must be greater than zero, with at most 8 decimal places"),
  date: securityPriceDateSchema,
  validThrough: securityPriceDateSchema,
}).strict().refine(data => data.fromCurrency !== data.toCurrency, {
  message: "An exchange rate needs two different currencies",
  path: ["toCurrency"],
}).refine(data => data.validThrough >= data.date, {
  message: "Validity end date must be on or after the effective date",
  path: ["validThrough"],
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
