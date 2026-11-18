import type { Account } from "@shared/schema";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { accountSnapshotRepository } from "../../repositories/AccountSnapshotRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  withTransaction,
  type TransactionType,
} from "../../utils/withTransaction";
import { AccountCoreService } from "./AccountCoreService";
import { getLatestFxRates } from "../../core/calculations";
import { CalculationError } from "../../core/calculations/errors";
import { portfolioValuationService } from "../PortfolioValuationService";
import {
  exportSummary as exportSummaryFn,
  exportBalanceHistory as exportBalanceHistoryFn,
  importBalanceHistory as importBalanceHistoryFn,
  getStartDateFromRange,
} from "./AccountExportService";

export class AccountReportingService extends AccountCoreService {
  /**
   * Get net worth summary with multi-currency conversion
   * TODO-006: Now converts all accounts to household base currency
   * TODO-031: Now includes investment valuations for parity with snapshotWorker
   */
  async getNetWorthSummary(
    householdId: string,
    userId: string,
  ): Promise<{
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    currency: string;
  }> {
    // Get household base currency
    const household = await householdRepository.findById(householdId);
    const baseCurrency = household?.currency || "ZMW";

    const balances = await accountRepository.getBalancesForNetWorth(
      householdId,
      userId,
    );

    // Collect unique currencies for FX lookup
    const currencies = Array.from(
      new Set(balances.map((a) => a.currency).filter(Boolean)),
    );

    // Get FX rates for conversion (TODO-006)
    const fxRatesByCurrency =
      currencies.length > 0
        ? await getLatestFxRates(currencies, baseCurrency)
        : new Map<string, number>();

    let totalAssets = Money.zero(baseCurrency);
    let totalLiabilities = Money.zero(baseCurrency);

    for (const account of balances) {
      let amount = new Money(account.balance, account.currency || baseCurrency);

      // Convert to base currency if needed (TODO-006).
      // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1,
      // which corrupts the net-worth total). Rate math stays on Money.
      if (account.currency && account.currency !== baseCurrency) {
        const fxRate = fxRatesByCurrency.get(account.currency);
        if (fxRate === undefined) {
          logger.error("Missing FX rate for net-worth summary", {
            householdId,
            fromCurrency: account.currency,
            toCurrency: baseCurrency,
          });
          throw new CalculationError(
            "MISSING_FX_RATE",
            { from: account.currency, to: baseCurrency, householdId },
            `Exchange rate unavailable for ${account.currency} -> ${baseCurrency}`,
          );
        }
        amount = amount.multiply(fxRate);
      }

      if (account.isAsset) {
        totalAssets = totalAssets.add(amount);
      } else {
        totalLiabilities = totalLiabilities.add(amount.abs());
      }
    }

    // TODO-031: Add investment valuations for parity with snapshotWorker
    try {
      const investmentValue =
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

      totalAssets = totalAssets
        .add(new Money(investmentValue.totalValue || 0, baseCurrency))
        .add(new Money(tbillsValue || 0, baseCurrency))
        .add(new Money(pensionValue || 0, baseCurrency));
    } catch (err) {
      // If portfolio valuation fails, continue with account balances only
      logger.warn("Failed to include investment valuations in summary", {
        householdId,
        error: err,
      });
    }

    return {
      totalAssets: totalAssets.toNumber(),
      totalLiabilities: totalLiabilities.toNumber(),
      netWorth: totalAssets.subtract(totalLiabilities).toNumber(),
      currency: baseCurrency,
    };
  }

  /**
   * Get household-level net worth summary (no user visibility filtering)
   * TODO-009: Used for household-scoped reports after authorization check.
   * @private - Only call after verifying user has owner/admin role
   */
  private async getHouseholdNetWorthSummary(
    householdId: string,
  ): Promise<{
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    currency: string;
  }> {
    const household = await householdRepository.findById(householdId);
    const baseCurrency = household?.currency || "ZMW";

    // Get all account balances without user visibility filtering
    const balances = await accountRepository.getBalancesForNetWorth(
      householdId,
      undefined, // No userId = no visibility filtering
    );

    const currencies = Array.from(
      new Set(balances.map((a) => a.currency).filter(Boolean)),
    );

    const fxRatesByCurrency =
      currencies.length > 0
        ? await getLatestFxRates(currencies, baseCurrency)
        : new Map<string, number>();

    let totalAssets = Money.zero(baseCurrency);
    let totalLiabilities = Money.zero(baseCurrency);

    for (const account of balances) {
      let amount = new Money(account.balance, account.currency || baseCurrency);

      // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1,
      // which corrupts the household net-worth total). Rate math stays on Money.
      if (account.currency && account.currency !== baseCurrency) {
        const fxRate = fxRatesByCurrency.get(account.currency);
        if (fxRate === undefined) {
          logger.error("Missing FX rate for household net-worth summary", {
            householdId,
            fromCurrency: account.currency,
            toCurrency: baseCurrency,
          });
          throw new CalculationError(
            "MISSING_FX_RATE",
            { from: account.currency, to: baseCurrency, householdId },
            `Exchange rate unavailable for ${account.currency} -> ${baseCurrency}`,
          );
        }
        amount = amount.multiply(fxRate);
      }

      if (account.isAsset) {
        totalAssets = totalAssets.add(amount);
      } else {
        totalLiabilities = totalLiabilities.add(amount.abs());
      }
    }

    // Add investment valuations for parity with snapshotWorker
    try {
      const investmentValue =
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

      totalAssets = totalAssets
        .add(new Money(investmentValue.totalValue || 0, baseCurrency))
        .add(new Money(tbillsValue || 0, baseCurrency))
        .add(new Money(pensionValue || 0, baseCurrency));
    } catch (err) {
      logger.warn("Failed to include investment valuations in household summary", {
        householdId,
        error: err,
      });
    }

    return {
      totalAssets: totalAssets.toNumber(),
      totalLiabilities: totalLiabilities.toNumber(),
      netWorth: totalAssets.subtract(totalLiabilities).toNumber(),
      currency: baseCurrency,
    };
  }

  /**
   * Update account ownership (optionally within a transaction)
   */
  async updateOwner(
    id: string,
    ownerUserId: string | null,
    householdId: string,
    userId: string,
    tx?: TransactionType,
  ): Promise<Account> {
    return await this.updateAccount(
      id,
      { ownerUserId },
      householdId,
      userId,
      undefined,
      tx,
    );
  }

  /**
   * Bulk update account ownership
   * TODO-018: Now properly threads tx to all inner updates for transactional integrity.
   */
  async bulkUpdateOwner(
    ids: string[],
    ownerUserId: string | null,
    householdId: string,
    userId: string,
  ): Promise<Account[]> {
    const results: Account[] = [];

    // Process sequentially within transaction for atomicity
    await withTransaction(async (tx) => {
      for (const id of ids) {
        const account = await this.updateOwner(
          id,
          ownerUserId,
          householdId,
          userId,
          tx, // TODO-018: Pass transaction handle
        );
        results.push(account);
      }
    });

    return results;
  }

  /**
   * Get net worth history for charts
   *
   * TODO-009: Scope alignment fix
   * - scope=user (default): Uses visibility-filtered account snapshots
   * - scope=household: Uses aggregate netWorthSnapshots (owner/admin only)
   *
   */
  async getNetWorthHistory(
    householdId: string,
    userId: string,
    dateRange: string,
    scope: "user" | "household" = "user",
  ): Promise<{
    series: {
      date: string;
      assets: number;
      liabilities: number;
      netWorth: number;
    }[];
    latest: { assets: number; liabilities: number; netWorth: number };
    scope: "household" | "user";
  }> {
    // TODO-009: Gate household scope to owner/admin
    if (scope === "household") {
      const member = await householdRepository.findMember(householdId, userId);
      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new AuthorizationError(
          "Only household owners and admins can view household-scoped net worth history",
        );
      }
    }

    const endDate = new Date();
    const startDate = getStartDateFromRange(dateRange);

    // Get historical snapshots based on scope
    let snapshots;
    if (scope === "user") {
      // TODO-009: User-scoped from account balance snapshots with visibility filters
      snapshots = await accountSnapshotRepository.getUserNetWorthSeries(
        householdId,
        userId,
        startDate,
        endDate,
      );
    } else {
      // Household-scoped from aggregate netWorthSnapshots
      snapshots = await accountSnapshotRepository.getNetWorthSnapshots(
        householdId,
        startDate,
        endDate,
      );
    }

    // TODO-009: Get current summary for latest - scope must match series data
    let latest: { assets: number; liabilities: number; netWorth: number };

    if (scope === "household") {
      // For household scope, use unfiltered summary (authorization already verified above)
      const householdSummary = await this.getHouseholdNetWorthSummary(householdId);
      latest = {
        assets: householdSummary.totalAssets,
        liabilities: householdSummary.totalLiabilities,
        netWorth: householdSummary.netWorth,
      };
    } else {
      // User-scoped uses visibility-filtered summary
      const summary = await this.getNetWorthSummary(householdId, userId);
      latest = {
        assets: summary.totalAssets,
        liabilities: summary.totalLiabilities,
        netWorth: summary.netWorth,
      };
    }

    // If no snapshots, return current value as only point
    if (snapshots.length === 0) {
      return {
        series: [
          {
            date: endDate.toISOString().split("T")[0],
            assets: latest.assets,
            liabilities: latest.liabilities,
            netWorth: latest.netWorth,
          },
        ],
        latest,
        scope,
      };
    }

    // Format snapshots for response
    const series = snapshots.map((s) => ({
      date: s.date,
      assets: new Money(s.totalAssets || 0).toNumber(),
      liabilities: new Money(s.totalLiabilities || 0).toNumber(),
      netWorth: new Money(s.netWorth || 0).toNumber(),
    }));

    return {
      series,
      latest,
      scope,
    };
  }

  /**
   * Get balance history for a specific account
   */
  async getBalanceHistory(
    accountId: string,
    householdId: string,
    userId: string,
    dateRange: string,
  ): Promise<{ date: string; balance: number }[]> {
    // Verify access
    const account = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    const endDate = new Date();
    const startDate = getStartDateFromRange(dateRange);

    const snapshots = await accountRepository.getBalanceSnapshots(
      accountId,
      startDate,
      endDate,
    );

    // If no snapshots, return current balance as only point
    if (snapshots.length === 0) {
      return [
        {
          date: endDate.toISOString().split("T")[0],
          balance: new Money(account.balance).toNumber(),
        },
      ];
    }

    return snapshots.map((s) => ({
      date: s.date,
      balance: new Money(s.balance).toNumber(),
    }));
  }

  /**
   * Export accounts summary as CSV
   * Delegates to AccountExportService
   */
  async exportSummary(householdId: string, userId: string): Promise<string> {
    return exportSummaryFn(this, householdId, userId);
  }

  /**
   * Export balance history as CSV
   * Delegates to AccountExportService
   */
  async exportBalanceHistory(
    accountId: string,
    householdId: string,
    userId: string,
  ): Promise<string> {
    return exportBalanceHistoryFn(this, accountId, householdId, userId);
  }

  /**
   * Import balance history from parsed CSV data
   * Delegates to AccountExportService
   */
  async importBalanceHistory(
    accountId: string,
    data: { date: string; amount: string }[],
    householdId: string,
    userId: string,
  ): Promise<{ imported: number }> {
    return importBalanceHistoryFn(accountId, data, householdId, userId);
  }
}
