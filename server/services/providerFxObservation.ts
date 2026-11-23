import { z } from "zod";
import Decimal from "decimal.js";

const yahoo = z.object({
  symbol: z.literal("USDZMW=X"),
  regularMarketPrice: z.number().finite().positive(),
  regularMarketTime: z.date(),
});
const exchangeRate = z.object({
  base: z.literal("USD"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_last_updated: z.number().int().positive(),
  rates: z.object({ ZMW: z.number().finite().positive() }),
});

export type FxProvider = "yahoo_finance" | "exchangerate_api";

/** The fetch instant cannot establish the age of a provider's observed price. */
export function readProviderFxObservation(provider: FxProvider, payload: unknown, now: Date) {
  let rate: number;
  let quotedAt: Date;
  if (provider === "yahoo_finance") {
    const quote = yahoo.parse(payload);
    rate = quote.regularMarketPrice;
    quotedAt = quote.regularMarketTime;
  } else {
    const quote = exchangeRate.parse(payload);
    rate = quote.rates.ZMW;
    quotedAt = new Date(quote.time_last_updated * 1000);
    if (quotedAt.toISOString().slice(0, 10) !== quote.date) throw new Error("Inconsistent provider FX quote date");
  }
  if (quotedAt > now) throw new Error("Future provider FX observation");
  const preciseRate = new Decimal(rate);
  const compatibilityRate = preciseRate.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (preciseRate.decimalPlaces() > 12 || !compatibilityRate.isPositive() ||
      compatibilityRate.isZero() || compatibilityRate.gte(1_000_000)) {
    throw new Error("Unrepresentable provider FX quote");
  }
  const effectiveDate = quotedAt.toISOString().slice(0, 10);
  const configuredDays = process.env.FX_FLOW_MAX_CARRY_DAYS ?? "3";
  if (!/^[0-3]$/.test(configuredDays)) throw new Error("Invalid FX_FLOW_MAX_CARRY_DAYS");
  const end = new Date(quotedAt);
  end.setUTCDate(end.getUTCDate() + Number(configuredDays));
  return { provider, fromCurrency: "USD", toCurrency: "ZMW", rate: preciseRate.toFixed(), quotedAt,
    effectiveDate, validThrough: end.toISOString().slice(0, 10) };
}
