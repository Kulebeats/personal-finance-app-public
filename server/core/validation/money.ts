/**
 * Money DTO validation helpers
 *
 * @module core/validation/money
 */

import { z } from "zod";

const amountStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Invalid amount format");

// BUDGET-VAL-001: Currency validation - must be uppercase 3-letter ISO 4217 code
const currencyCodeSchema = z
  .string()
  .length(3, "Currency code must be exactly 3 characters")
  .regex(/^[A-Z]{3}$/, "Currency code must be uppercase ISO 4217 format (e.g., USD, ZMW, EUR)")
  .refine(
    (code) => {
      // Common currency codes validation - extensible list
      const validCurrencies = [
        "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
        "ZMW", "ZAR", "KES", "UGX", "TZS", "NGN", "GHS", "RWF",
        "MWK", "BWP", "ZWL", "NAD", "LSL", "SZL", "MUR", "SCR",
        "CNY", "INR", "BRL", "MXN", "ARS", "CLP", "COP", "PEN"
      ];
      return validCurrencies.includes(code);
    },
    { message: "Unsupported currency code" }
  );

export const moneyDtoSchema = z.object({
  amount: amountStringSchema,
  currency: currencyCodeSchema,
});

// DECIMAL(15,2) max value
const MAX_MONEY_AMOUNT = 9999999999999.99;

export const positiveMoneyDtoSchema = moneyDtoSchema.superRefine(
  (value, ctx) => {
    const amount = Number.parseFloat(value.amount);
    if (amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amount must be positive",
        path: ["amount"],
      });
    }
    if (amount > MAX_MONEY_AMOUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amount exceeds maximum allowed value",
        path: ["amount"],
      });
    }
  }
);

export const nonNegativeMoneyDtoSchema = moneyDtoSchema.superRefine(
  (value, ctx) => {
    const amount = Number.parseFloat(value.amount);
    if (amount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amount must be non-negative",
        path: ["amount"],
      });
    }
    if (amount > MAX_MONEY_AMOUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amount exceeds maximum allowed value",
        path: ["amount"],
      });
    }
  }
);

export const moneyAmountStringSchema = amountStringSchema;
