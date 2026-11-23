import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import {
  accounts,
  netWorthSnapshots,
  accountBalanceSnapshots,
  households,
  fxRates,
} from "@shared/schema";
import { productionRedis, redis } from "../config/redis";
import { logger } from "../utils/logger";
import { portfolioValuationService } from "../services/PortfolioValuationService";
import { CalculationError } from "../core/calculations/errors";
import Decimal from "decimal.js";
import { isPostgresError } from "../utils/postgresError";
import { createSnapshotProvenance, readScheduledSnapshotReceipt, readSnapshotInventory, scheduledSnapshotReceipt, type SnapshotContribution } from "./snapshotProvenance";
import { createFXRateRepository, createFXRateService } from "../core/calculations/currency/fxRates";
import { isCurrencyCode } from "@shared/denomination";
import { assertSnapshotPortfolioCoverage } from "./snapshotPortfolioCoverage";
import { expectedSnapshotFinancialFailure, persistNativeAccountCapture, readNativeAccountCapture, SnapshotFinancialUnavailable } from "./accountCapture";

const LOCK_TTL = 300; // 5 minutes

function assertSnapshotLockAvailable(): void {
  if (!productionRedis) return;
  productionRedis.assertCurrent();
  throw new Error("REDIS_PROFILE_SNAPSHOT_LOCK_UNAVAILABLE");
}

/**
 * Per-run household outcomes. `busy`: another worker held the household's
 * lock, so this run cannot say its day was captured.
 */
export type SnapshotRunTotals = { readonly processed: number; readonly failed: number; readonly busy: number };

/**
 * Snapshot Worker
 *
 * Creates daily net worth and account balance snapshots.
 * Should be triggered by a cron job (e.g., daily at midnight).
 */
export class SnapshotWorker {
  /**
   * Process snapshots for all households. One household's failure does not
   * stop the others. The scheduled caller counts failed and lock-busy
   * households, leaving the current day open for a recovery tick.
   */
  async processAll(scheduledDate?: string): Promise<SnapshotRunTotals> {
    assertSnapshotLockAvailable();
    const householdsList = await db
      .select({ id: households.id })
      .from(households);

    logger.info(`Processing snapshots for ${householdsList.length} households`);

    let processed = 0;
    let failed = 0;
    let busy = 0;
    for (const household of householdsList) {
      try {
        if (await this.processHousehold(household.id, scheduledDate)) processed++;
        else busy++;
      } catch (error) {
        failed++;
        logger.error("Snapshot processing failed for household", {
          householdId: household.id,
          error,
        });
      }
    }
    return { processed, failed, busy };
  }

  /**
   * A scheduled capture uses the slot's UTC date. A manual capture always
   * takes a new observation, even when a household already has one today.
   */
  async processHousehold(householdId: string, scheduledDate?: string): Promise<boolean> {
    assertSnapshotLockAvailable();
    // Lease bookkeeping also uses the DB day. The actual receipt's date/instant
    // are read again inside its serializable transaction and cannot be faked.
    const leaseClock = await db.execute<{ date: string }>(sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as date`);
    const today = leaseClock.rows[0].date;
    if (scheduledDate !== undefined && today !== scheduledDate) throw new Error("Scheduled snapshot date is no longer current");
    const lockKey = `snapshot:lock:${householdId}:${today}`;

    if (redis) {
      // Try to acquire lock
      const acquired = await redis.set(lockKey, "1", "EX", LOCK_TTL, "NX");
      if (!acquired) {
        logger.debug("Could not acquire snapshot lock", { householdId });
        return false;
      }
    }

    try {
      let committed: { date: string; netWorth: string; accountCount: number }
        | { alreadyCaptured: true } | { failure: CalculationError } | undefined;
      for (let attempt = 1; !committed; attempt++) {
        try {
          committed = await db.transaction(async tx => {
            // A waiter may have established an older snapshot while acquiring this
            // lock. SERIALIZABLE retries the whole capture if the aggregate advanced.
            const lock = await tx.execute<{ date: string }>(sql`select
              to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as date,
              pg_advisory_xact_lock(hashtextextended('snapshot:' || ${householdId}::text || ':' ||
                to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD'), 0))`);
            if (scheduledDate !== undefined) {
              if (lock.rows[0]?.date !== scheduledDate) throw new Error("Scheduled snapshot date is no longer current");
              if (await readScheduledSnapshotReceipt(tx, householdId, scheduledDate)) return { alreadyCaptured: true as const };
            }
            const accountCapture = await readNativeAccountCapture(tx, householdId);
            const today = accountCapture.date;
            try {
            // Assess economic omissions without erasing independently imported
            // account history, whose writer ownership is not recorded.
            const allAccounts = await tx
              .select({
                id: accounts.id,
                type: accounts.type,
                balance: accounts.balance,
                estimatedValue: accounts.estimatedValue,
                isHidden: accounts.isHidden,
                isArchived: accounts.isArchived,
                deletedAt: accounts.deletedAt,
                excluded: accounts.excludeFromNetWorth,
                currency: accounts.currency,
              })
              .from(accounts)
              .where(eq(accounts.householdId, householdId));

            // Get household currency first
            const [household] = await tx
              .select({ currency: households.currency })
              .from(households)
              .where(eq(households.id, householdId))
              .limit(1);

            const baseCurrency = household?.currency;
            if (!isCurrencyCode(baseCurrency)) throw new SnapshotFinancialUnavailable("INVALID_CURRENCY");
            const inventory = await readSnapshotInventory(tx, householdId);
            const contributions: SnapshotContribution[] = [];
            let omittedEligibleAccounts = 0;
            const fxService = createFXRateService(createFXRateRepository(tx, fxRates));
            const valuationContext = { database: tx, currentValueOnly: true, getLatestFxRates: (currencies: string[], to: string, household: string) => fxService.getLatestRatesMap(currencies, to, household) };

            // TODO-006/007: Get FX rates for multi-currency accounts
            const currencies = Array.from(
              new Set(allAccounts.filter(account => !account.deletedAt && !account.excluded && !account.isArchived && !account.isHidden).map((a) => a.currency).filter(Boolean)),
            );
            // Preserve SQLSTATE for the outer transaction retry. An actual
            // successful lookup with an absent rate is handled separately below.
            const fxRatesByCurrency = currencies.length > 0
              ? await valuationContext.getLatestFxRates(currencies, baseCurrency, householdId)
              : new Map<string, number>();

            // FIX DATA-SNAPSHOT-001: Calculate totals using Decimal.js for precision
            // Keep all values as Decimal/strings to avoid floating-point drift
            let totalAssets = new Decimal(0);
            let totalLiabilities = new Decimal(0);
            const assetsByType: Record<string, Decimal> = {};
            const liabilitiesByType: Record<string, Decimal> = {};
            const accountBalances: Array<{ accountId: string; balance: string }> = [];

            for (const acc of allAccounts) {
              if (acc.deletedAt) continue;
              if (acc.excluded !== false) {
                if (acc.excluded === null) omittedEligibleAccounts++;
                continue;
              }
              const useEstimatedValue =
                (acc.type === "real_estate" || acc.type === "vehicle") &&
                acc.estimatedValue !== null;
              const rawBalance = useEstimatedValue ? acc.estimatedValue : acc.balance;

              let balance: Decimal;
              try { balance = new Decimal(String(rawBalance)); }
              catch { omittedEligibleAccounts++; continue; }
              if (!balance.isFinite()) { omittedEligibleAccounts++; continue; }
              if (acc.isHidden || acc.isArchived !== false) {
                if (!balance.isZero()) omittedEligibleAccounts++;
                continue;
              }

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
              contributions.push({ accountId: acc.id, kind: isLiability ? "liability" : "asset", accountType: acc.type,
                baseAmount: balance.toFixed(2), sourceCurrency: acc.currency, baseCurrency,
                fx: acc.currency === baseCurrency ? "same_currency" : "unproven" });

              if (isLiability) {
                // NEW-05: signed debt (core/money/wealth-totals): an overpaid card
                // (negative balance) lowers liabilities; never abs().
                totalLiabilities = totalLiabilities.plus(balance);
                // Store as Decimal to preserve precision
                liabilitiesByType[acc.type] = (liabilitiesByType[acc.type] || new Decimal(0)).plus(balance);
              } else {
                totalAssets = totalAssets.plus(balance);
                // Store as Decimal to preserve precision
                assetsByType[acc.type] = (assetsByType[acc.type] || new Decimal(0)).plus(balance);
              }
            }

            // ----------------------------------------------------------------------
            // [NEW] Investment Portfolio Valuation
            // ----------------------------------------------------------------------
            if (!Object.values(inventory).every(count => count === 0)) {
              try {
                await assertSnapshotPortfolioCoverage(tx, householdId);
                const investmentData =
                  await portfolioValuationService.getHouseholdInvestmentValue(
                    householdId,
                    baseCurrency,
                    valuationContext,
                  );

                const tbillsValue = await portfolioValuationService.getTBillsValue(
                  householdId,
                  baseCurrency,
                  valuationContext,
                );

                const pensionValue = await portfolioValuationService.getPensionValue(
                  householdId,
                  baseCurrency,
                  valuationContext,
                );

                // Add to total assets using Decimal (TODO-007)
                totalAssets = totalAssets
                  .plus(investmentData.totalValue.amount)
                  .plus(tbillsValue.amount)
                  .plus(pensionValue.amount);

                // Update breakdown (exact Decimal from the valuation Money)
                if (investmentData.totalValue.isPositive()) {
                  assetsByType["investment_holdings"] = investmentData.totalValue.amount;

                  // Optional: Add detailed breakdown if needed
                  // for (const [type, value] of Object.entries(investmentData.byType)) {
                  //   assetsByType[`investment_${type}`] = new Decimal(value);
                  // }
                }

                if (tbillsValue.isPositive()) {
                  assetsByType["investment_tbills"] = tbillsValue.amount;
                }

                if (pensionValue.isPositive()) {
                  assetsByType["investment_pension"] = pensionValue.amount;
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
                // A partial investment sum must not replace a coherent legacy
                // aggregate, even though recap would withhold that capture.
                throw err;
              }
            }

            // Calculate net worth using Decimal
            if (!totalAssets.isFinite() || !totalLiabilities.isFinite()) throw new SnapshotFinancialUnavailable("INVALID_MONEY");
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

            // The aggregate and guarded native receipt commit together. Manual
            // recapture carries forward only a previously verified slot receipt.
            const receipt = scheduledDate === undefined
              ? await readScheduledSnapshotReceipt(tx, householdId, today)
              : scheduledSnapshotReceipt(householdId, scheduledDate, accountCapture.captureId);
            const provenance = {
              ...createSnapshotProvenance(householdId, today, baseCurrency, inventory, contributions, omittedEligibleAccounts, accountCapture.captureId),
              ...(receipt && { scheduledCapture: receipt }),
            };
            const aggregate = tx
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
                provenance,
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
                  currency: baseCurrency,
                  provenance,
                },
              });
            if (receipt) {
              const [stored] = await aggregate.returning({ captureId: sql<string | null>`${netWorthSnapshots.provenance}->>'captureId'`,
                verified: sql<boolean | null>`${netWorthSnapshots.provenance}->'scheduledCapture' = ${JSON.stringify(receipt)}::jsonb` });
              if (stored?.captureId !== accountCapture.captureId || stored.verified !== true) {
                throw new Error("Scheduled snapshot aggregate was not attested");
              }
            } else {
              await aggregate;
            }

            // Upsert individual account snapshots
            // Preserve row identity, available balance, timestamps and omitted
            // imported history; only replace this worker's balance value.
            for (const accBalance of accountBalances) {
              await tx
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

            await persistNativeAccountCapture(tx, accountCapture);
            return { date: today, netWorth: netWorth.toFixed(2), accountCount: accountBalances.length };
            } catch (error) {
              // Only an ordinary unavailable financial input permits an
              // independently verified native receipt to survive. Aborted SQL,
              // infrastructure and programming failures roll back the entire tx.
              if (!expectedSnapshotFinancialFailure(error)) throw error;
              // A failed refresh cannot alter the last genuine household
              // receipt. The independent native generation records only what
              // this observation can prove, without borrowing its prior total.
              await persistNativeAccountCapture(tx, accountCapture);
              return { failure: error };
            }
          }, { isolationLevel: "serializable" });
        } catch (error) {
          if (attempt >= 3 || (!isPostgresError(error, "40001") && !isPostgresError(error, "40P01"))) throw error;
        }
      }
      if ("failure" in committed) throw committed.failure;
      if ("alreadyCaptured" in committed) return true;

      logger.info("Snapshot created", {
        householdId,
        date: committed.date,
        netWorth: committed.netWorth,
        accountCount: committed.accountCount,
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
export async function runDailySnapshots(scheduledDate?: string): Promise<SnapshotRunTotals> {
  logger.info("Starting daily snapshot job");
  const startTime = Date.now();

  const totals = await snapshotWorker.processAll(scheduledDate);

  const duration = Date.now() - startTime;
  logger.info("Daily snapshot job finished", { durationMs: duration, ...totals });
  return totals;
}
