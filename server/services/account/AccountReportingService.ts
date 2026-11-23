import type { Account } from "@shared/schema";
import type { AccountWealthSummary } from "@shared/account-summary";
import { readAccountSummary, readAccountSummaryHistory } from "../../repositories/AccountSummaryRead";
import { readAccountBalanceHistory } from "../../repositories/AccountBalanceHistoryRead";
import {
  withTransaction,
  type TransactionType,
} from "../../utils/withTransaction";
import { AccountCoreService } from "./AccountCoreService";
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
  async getNetWorthSummary(householdId: string, userId: string): Promise<AccountWealthSummary> {
    return (await readAccountSummary(householdId, userId)).summary;
  }

  async getSummaryExportData(householdId: string, userId: string) {
    return readAccountSummary(householdId, userId, "financial.export", true);
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

  /** Historical points require their own captured classification and currency. */
  async getNetWorthHistory(householdId: string, userId: string, dateRange: string, scope: "user" | "household" = "user", includeAccounts = false, ownerUserId?: string | null) {
    const end = new Date(), start = getStartDateFromRange(dateRange);
    return readAccountSummaryHistory(householdId, userId, {
      from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), scope, includeAccounts, ownerUserId,
    });
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
    const endDate = new Date();
    const startDate = getStartDateFromRange(dateRange);
    return readAccountBalanceHistory(accountId, householdId, userId,
      startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10));
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
    ipAddress?: string,
  ): Promise<{ imported: number }> {
    return importBalanceHistoryFn(accountId, data, householdId, userId, ipAddress);
  }
}
