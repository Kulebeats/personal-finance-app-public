import { db } from "../db";
import { securities, securityPrices, fxRates } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export class MarketDataService {
  /**
   * Update all active security prices that have symbols
   */
  async updateSecurityPrices(): Promise<{ updated: number; failed: number }> {
    const activeSecurities = await db.query.securities.findMany({
      where: sql`${securities.symbol} IS NOT NULL`,
    });

    let updated = 0;
    let failed = 0;

    for (const sec of activeSecurities) {
      try {
        if (!sec.symbol) continue;

        // Fetch quote
        const quote = await yahooFinance.quote(sec.symbol);
        const price = quote.regularMarketPrice;

        if (price !== undefined) {
          // Update security record
          await db
            .update(securities)
            .set({
              currentPrice: price.toString(),
              lastPriceUpdate: new Date(),
            })
            .where(eq(securities.id, sec.id));

          // Log to historical prices
          await db.insert(securityPrices).values({
            securityId: sec.id,
            price: price.toString(),
            date: new Date().toISOString().split("T")[0],
            source: "yahoo_finance",
          });

          updated++;
        }
      } catch (err) {
        logger.error(
          "Failed to update security price",
          { symbol: sec.symbol },
          err as Error
        );
        failed++;
      }
    }

    return { updated, failed };
  }

  /**
   * Update USD/ZMW FX rate using multiple sources for reliability
   */
  async updateFXRates(): Promise<{ success: boolean; rate: number | null }> {
    try {
      let rate: number | undefined;
      let source = "yahoo_finance";

      // 1. Try Yahoo Finance (Best for historical continuity)
      try {
        const quote = await yahooFinance.quote("USDZMW=X");
        rate = quote.regularMarketPrice;
      } catch (e) {
        logger.warn("Yahoo Finance FX fetch failed, trying fallback...");
      }

      // 2. Fallback to ExchangeRate-API (Very reliable for ZMW)
      if (!rate) {
        try {
          const response = await fetch(
            "https://api.exchangerate-api.com/v4/latest/USD"
          );
          const data = await response.json();
          rate = data.rates["ZMW"];
          source = "exchangerate_api";
        } catch (e) {
          logger.error("Fallback FX API failed", {}, e as Error);
        }
      }

      if (rate) {
        const today = new Date().toISOString().split("T")[0];

        // Check if we already have a rate for today to avoid duplicates
        const existing = await db.query.fxRates.findFirst({
          where: sql`${fxRates.fromCurrency} = 'USD' AND ${fxRates.toCurrency} = 'ZMW' AND ${fxRates.date} = ${today}`,
        });

        if (!existing) {
          await db.insert(fxRates).values({
            fromCurrency: "USD",
            toCurrency: "ZMW",
            rate: rate.toString(),
            date: today,
            source: source,
          });
        } else {
          // Update existing for today
          await db
            .update(fxRates)
            .set({
              rate: rate.toString(),
              source: source,
            })
            .where(eq(fxRates.id, existing.id));
        }

        return { success: true, rate };
      }
    } catch (err) {
      logger.error("Critical failure updating FX rates", {}, err as Error);
    }
    return { success: false, rate: null };
  }
}

export const marketDataService = new MarketDataService();
