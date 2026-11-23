import { db } from "../db";
import { securities, securityPrices, fxRates, providerFxQuotes } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import Decimal from "decimal.js";
import { readProviderFxObservation } from "./providerFxObservation";
import { logger } from "../utils/logger";
import { businessAuditService } from "./BusinessAuditService";
import { withTransaction } from "../utils/withTransaction";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * The operator who triggered a manual refresh. Reference prices and rates are
 * global, so their audit rows never name a household (NEW-13): a household's
 * audit view, export and erasure must not carry them. A scheduled run has no
 * actor and is audited with a null user too.
 */
export interface MarketRefreshActor {
  userId: string;
}

export class MarketDataService {
  /**
   * Update all active security prices that have symbols. Each security's price
   * update, history row and audit row commit together (Rule 9).
   */
  async updateSecurityPrices(actor?: MarketRefreshActor): Promise<{ updated: number; failed: number }> {
    const activeSecurities = await db.query.securities.findMany({
      // NEW-13: a household's custom security is priced by that household only.
      where: sql`${securities.symbol} IS NOT NULL AND ${securities.ownerHouseholdId} IS NULL`,
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
          await withTransaction(async (tx) => {
            // Update security record
            await tx
              .update(securities)
              .set({
                currentPrice: price.toString(),
                lastPriceUpdate: new Date(),
              })
              .where(eq(securities.id, sec.id));

            // Log to historical prices
            await tx.insert(securityPrices).values({
              securityId: sec.id,
              price: price.toString(),
              date: new Date().toISOString().split("T")[0],
              source: "yahoo_finance",
            });

            await businessAuditService.logUpdate({
              tx,
              userId: actor?.userId ?? null,
              householdId: null,
              entityType: "security_price",
              entityId: sec.id,
              oldValue: { currentPrice: sec.currentPrice },
              newValue: { currentPrice: price.toString() },
              metadata: { symbol: sec.symbol, source: "yahoo_finance" },
            });
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
  async updateFXRates(actor?: MarketRefreshActor): Promise<{ success: boolean; rate: number | null }> {
    try {
      let quote: ReturnType<typeof readProviderFxObservation>;
      try {
        const payload = await yahooFinance.quote("USDZMW=X");
        quote = readProviderFxObservation("yahoo_finance", payload, new Date());
        if (quote.validThrough < new Date().toISOString().slice(0, 10)) throw new Error("Expired Yahoo FX quote");
      } catch {
        logger.warn("Yahoo Finance FX quote unavailable, trying fallback");
        const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
        if (!response.ok) throw new Error("Fallback FX request failed");
        quote = readProviderFxObservation("exchangerate_api", await response.json(), new Date());
        if (quote.validThrough < new Date().toISOString().slice(0, 10)) throw new Error("Expired fallback FX quote");
      }

      const rate = await db.transaction(async tx => {
        // Serialize both the observation and the compatibility write for this pair.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('provider-fx:USD:ZMW', 0))`);
        const [inserted] = await tx.insert(providerFxQuotes).values(quote).onConflictDoNothing().returning();
        if (!inserted) {
          const prior = await tx.query.providerFxQuotes.findFirst({ where: and(
            eq(providerFxQuotes.fromCurrency, quote.fromCurrency), eq(providerFxQuotes.toCurrency, quote.toCurrency),
            eq(providerFxQuotes.provider, quote.provider), eq(providerFxQuotes.quotedAt, quote.quotedAt),
          ) });
          if (!prior || !new Decimal(prior.rate).equals(quote.rate)) throw new Error("Conflicting provider FX observation");
        }
        const current = await tx.query.providerFxQuotes.findFirst({ where: and(
          eq(providerFxQuotes.fromCurrency, quote.fromCurrency), eq(providerFxQuotes.toCurrency, quote.toCurrency),
          eq(providerFxQuotes.effectiveDate, quote.effectiveDate),
        ), orderBy: [desc(providerFxQuotes.quotedAt), providerFxQuotes.provider] });
        if (!current) throw new Error("Missing provider FX observation");
        // A new observation is audited with the write; a retry of one already stored is not.
        if (inserted) {
          await businessAuditService.log({
            tx,
            userId: actor?.userId ?? null,
            householdId: null,
            action: "UPDATE",
            entityType: "fx_rate",
            entityId: current.id,
            details: {
              pair: `${quote.fromCurrency}/${quote.toCurrency}`,
              provider: current.provider,
              rate: current.rate,
              effectiveDate: quote.effectiveDate,
            },
          });
        }
        const matching = and(
          eq(fxRates.fromCurrency, quote.fromCurrency), eq(fxRates.toCurrency, quote.toCurrency),
          eq(fxRates.date, quote.effectiveDate),
        );
        // A legacy provider-looking label can come from a manual entry. Only a
        // mirror created with an observation's own ID is ours to update.
        const [owned] = await tx.select({ id: fxRates.id }).from(fxRates)
          .innerJoin(providerFxQuotes, eq(providerFxQuotes.id, fxRates.id)).where(matching).limit(1);
        const values = { rate: current.rate, source: current.provider };
        if (owned) await tx.update(fxRates).set(values).where(eq(fxRates.id, owned.id));
        else if (!await tx.query.fxRates.findFirst({ columns: { id: true }, where: matching })) {
          await tx.insert(fxRates).values({ ...values, id: current.id, fromCurrency: quote.fromCurrency,
            toCurrency: quote.toCurrency, date: quote.effectiveDate });
        }
        return Number(current.rate);
      });
      return { success: true, rate };
    } catch (err) {
      logger.error("Critical failure updating FX rates", {}, err as Error);
    }
    return { success: false, rate: null };
  }
}

export const marketDataService = new MarketDataService();
