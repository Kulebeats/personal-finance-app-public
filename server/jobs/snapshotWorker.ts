import { db } from "../db";
import { eq, and, or, isNull } from "drizzle-orm";
import {
  accounts,
  netWorthSnapshots,
  accountBalanceSnapshots,
  households,
} from "@shared/schema";
import { redis } from "../config/redis";
import { logger } from "../utils/logger";
import { portfolioValuationService } from "../services/PortfolioValuationService";
import { CalculationError } from "../core/calculations/errors";
import Decimal from "decimal.js";

const LOCK_TTL = 300; // 5 minutes
const COMPLETION_TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Snapshot Worker
 *
 * Creates daily net worth and account balance snapshots.
 * Should be triggered by a cron job (e.g., daily at midnight).
 */
export class SnapshotWorker {
  /**
   * Process snapshots for all households
   */
  async processAll(): Promise<void> {
    const householdsList = await db
      .select({ id: households.id })
      .from(households);

    logger.info(`Processing snapshots for ${householdsList.length} households`);

    for (const household of householdsList) {
      try {
        await this.processHousehold(household.id);
      } catch (error) {
        logger.error("Snapshot processing failed for household", {
          householdId: household.id,
          error,
        });
      }
    }
  }

  /**
   * Process snapshot for a single household
   */
  async processHousehold(householdId: string): Promise<boolean> {
    const today = new Date().toISOString().split("T")[0];
    const lockKey = `snapshot:lock:${householdId}:${today}`;
    const completedKey = `snapshot:completed:${householdId}:${today}`;

    // Check if already completed
    if (redis) {
      const completed = await redis.get(completedKey);
      if (completed) {
        logger.debug("Snapshot already completed for today", {
          householdId,
          date: today,
        });
        return true;
      }

      // Try to acquire lock
      const acquired = await redis.set(lockKey, "1", "EX", LOCK_TTL, "NX");
      if (!acquired) {
        logger.debug("Could not acquire snapshot lock", { householdId });
        return false;
      }
    }

    try {
      // Get all visible accounts (non-deleted, non-excluded, non-archived)
      // TODO-007: Added excludeFromNetWorth and isArchived filtering
      const allAccounts = await db
        .select({
          id: accounts.id,
          type: accounts.type,
          balance: accounts.balance,
          estimatedValue: accounts.estimatedValue,
          isHidden: accounts.isHidden,
          currency: accounts.currency,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            eq(accounts.excludeFromNetWorth, false),
            eq(accounts.isArchived, false),
          ),
        );

      // Get household currency first
      const [household] = await db
        .select({ currency: households.currency })
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1);

      const baseCurrency = household?.currency || "ZMW";

      // TODO-006/007: Get FX rates for multi-currency accounts
      const currencies = Array.from(
        new Set(allAccounts.map((a) => a.currency).filter(Boolean)),
      );
      let fxRatesByCurrency = new Map<string, number>();
      if (currencies.length > 0) {
        try {
          const { getLatestFxRates } = await import("../core/calculations");
          fxRatesByCurrency = await getLatestFxRates(currencies, baseCurrency);
        } catch (err) {
          logger.warn("Failed to get FX rates for snapshot", {
            householdId,
            err,
          });
        }
      }

      // FIX DATA-SNAPSHOT-001: Calculate totals using Decimal.js for precision
      // Keep all values as Decimal/strings to avoid floating-point drift
      let totalAssets = new Decimal(0);
      let totalLiabilities = new Decimal(0);
      const assetsByType: Record<string, Decimal> = {};
      const liabilitiesByType: Record<string, Decimal> = {};
      const accountBalances: Array<{ accountId: string; balance: string }> = [];

      for (const acc of allAccounts) {
        const useEstimatedValue =
          (acc.type === "real_estate" || acc.type === "vehicle") &&
          acc.estimatedValue !== null;
        const rawBalance = useEstimatedValue ? acc.estimatedValue : acc.balance;

        let balance = new Decimal(String(rawBalance));

        // Convert to base currency if needed.
        // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1,
        // which corrupts the net-worth snapshot). Rate math stays on Decimal.
        if (acc.currency && acc.currency !== baseCurrency) {
          const fxRate = fxRatesByCurrency.get(acc.currency);
          if (fxRate === undefined) {
            logger.error("Missing FX rate for net-worth snapshot", {
              householdId,
              fromCurrency: acc.currency,
              toCurrency: baseCurrency,
              accountId: acc.id,
            });
            throw new CalculationError(
              "MISSING_FX_RATE",
              { from: acc.currency, to: baseCurrency, householdId },
              `Exchange rate unavailable for ${acc.currency} -> ${baseCurrency}`,
            );
          }
          balance = balance.times(fxRate);
        }

        // Skip hidden accounts from net worth calculations
        if (acc.isHidden) continue;

        // Store balance as string to preserve precision
        accountBalances.push({
          accountId: acc.id,
          balance: balance.toFixed(2),
        });

        const isLiability =
          acc.type === "credit" ||
          acc.type === "loan" ||
          acc.type === "mortgage" ||
          acc.type === "other_liability";

        if (isLiability) {
          const absBalance = balance.abs();
          totalLiabilities = totalLiabilities.plus(absBalance);
          // Store as Decimal to preserve precision
          liabilitiesByType[acc.type] = (liabilitiesByType[acc.type] || new Decimal(0)).plus(absBalance);
        } else {
          totalAssets = totalAssets.plus(balance);
          // Store as Decimal to preserve precision
          assetsByType[acc.type] = (assetsByType[acc.type] || new Decimal(0)).plus(balance);
        }
      }

      // ----------------------------------------------------------------------
      // [NEW] Investment Portfolio Valuation
      // ----------------------------------------------------------------------
      try {
        const investmentData =
          await portfolioValuationService.getHouseholdInvestmentValue(
            householdId,
            baseCurrency,
          );

        const tbillsValue = await portfolioValuationService.getTBillsValue(
          householdId,
          baseCurrency,
        );

        const pensionValue = await portfolioValuationService.getPensionValue(
          householdId,
          baseCurrency,
        );

        // Add to total assets using Decimal (TODO-007)
        totalAssets = totalAssets
          .plus(investmentData.totalValue)
          .plus(tbillsValue)
          .plus(pensionValue);

        // Update breakdown (convert to Decimal for precision)
        if (investmentData.totalValue > 0) {
          assetsByType["investment_holdings"] = new Decimal(investmentData.totalValue);

          // Optional: Add detailed breakdown if needed
          // for (const [type, value] of Object.entries(investmentData.byType)) {
          //   assetsByType[`investment_${type}`] = new Decimal(value);
          // }
        }

        if (tbillsValue > 0) {
          assetsByType["investment_tbills"] = new Decimal(tbillsValue);
        }

        if (pensionValue > 0) {
          assetsByType["investment_pension"] = new Decimal(pensionValue);
        }

        logger.info("Investment valuation added to snapshot", {
          householdId,
          holdings: investmentData.totalValue,
          tbills: tbillsValue,
          pension: pensionValue,
        });
      } catch (err) {
        logger.error("Failed to calculate investment value for snapshot", {
          householdId,
          error: err,
        });
        // Continue without investments rather than failing the whole snapshot
      }

      // Calculate net worth using Decimal
      const netWorth = totalAssets.minus(totalLiabilities);

      // FIX DATA-SNAPSHOT-001: Convert Decimal maps to string values for JSON storage
      const assetsByTypeStrings: Record<string, string> = {};
      for (const [type, value] of Object.entries(assetsByType)) {
        assetsByTypeStrings[type] = value.toFixed(2);
      }

      const liabilitiesByTypeStrings: Record<string, string> = {};
      for (const [type, value] of Object.entries(liabilitiesByType)) {
        liabilitiesByTypeStrings[type] = value.toFixed(2);
      }

      // Upsert net worth snapshot with proper 2-decimal precision
      await db
        .insert(netWorthSnapshots)
        .values({
          householdId,
          date: today,
          totalAssets: totalAssets.toFixed(2),
          totalLiabilities: totalLiabilities.toFixed(2),
          netWorth: netWorth.toFixed(2),
          assetsByType: assetsByTypeStrings,
          liabilitiesByType: liabilitiesByTypeStrings,
          accountBalances,
          currency: baseCurrency,
        })
        .onConflictDoUpdate({
          target: [netWorthSnapshots.householdId, netWorthSnapshots.date],
          set: {
            totalAssets: totalAssets.toFixed(2),
            totalLiabilities: totalLiabilities.toFixed(2),
            netWorth: netWorth.toFixed(2),
            assetsByType: assetsByTypeStrings,
            liabilitiesByType: liabilitiesByTypeStrings,
            accountBalances,
          },
        });

      // Upsert individual account snapshots
      for (const accBalance of accountBalances) {
        await db
          .insert(accountBalanceSnapshots)
          .values({
            accountId: accBalance.accountId,
            date: today,
            balance: String(accBalance.balance),
          })
          .onConflictDoUpdate({
            target: [
              accountBalanceSnapshots.accountId,
              accountBalanceSnapshots.date,
            ],
            set: {
              balance: String(accBalance.balance),
            },
          });
      }

      // Mark as completed
      if (redis) {
        await redis.setex(completedKey, COMPLETION_TTL, "1");
      }

      logger.info("Snapshot created", {
        householdId,
        date: today,
        netWorth,
        accountCount: accountBalances.length,
      });

      return true;
    } finally {
      // Release lock
      if (redis) {
        await redis.del(lockKey);
      }
    }
  }
}

export const snapshotWorker = new SnapshotWorker();

/**
 * Cron handler for daily snapshots
 * Call this from your cron job setup
 */
export async function runDailySnapshots(): Promise<void> {
  logger.info("Starting daily snapshot job");
  const startTime = Date.now();

  await snapshotWorker.processAll();

  const duration = Date.now() - startTime;
  logger.info("Daily snapshot job completed", { durationMs: duration });
}
