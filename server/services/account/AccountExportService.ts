/**
 * Account Export Service
 *
 * Handles CSV export/import operations for accounts.
 * Split from AccountReportingService to maintain LOC limits.
 *
 * @module services/account/AccountExportService
 */

import { Money } from "../../core/money";
import { sanitizeCsvRow } from "../../core/csv";
import { accountRepository } from "../../repositories/AccountRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";
import type { AccountReportingService } from "./AccountReportingService";

/**
 * Export accounts summary as CSV
 * Uses sanitized CSV output per TODO-008
 */
export async function exportSummary(
  accountService: AccountReportingService,
  householdId: string,
  userId: string,
): Promise<string> {
  const accounts = await accountService.getAccounts(householdId, userId);
  const summary = await accountService.getNetWorthSummary(householdId, userId);

  const lines: string[] = [];
  lines.push("Account Name,Type,Institution,Balance,Currency,Is Asset");

  for (const account of accounts) {
    lines.push(
      sanitizeCsvRow([
        account.name,
        account.type,
        account.institution || "",
        account.balance,
        account.currency,
        account.isAsset,
      ]),
    );
  }

  lines.push("");
  lines.push(
    sanitizeCsvRow(["Total Assets", "", "", "", summary.totalAssets]),
  );
  lines.push(
    sanitizeCsvRow([
      "Total Liabilities",
      "",
      "",
      "",
      summary.totalLiabilities,
    ]),
  );
  lines.push(sanitizeCsvRow(["Net Worth", "", "", "", summary.netWorth]));

  return lines.join("\n");
}

/**
 * Export balance history as CSV
 * Uses sanitized CSV output per TODO-008
 */
export async function exportBalanceHistory(
  accountService: AccountReportingService,
  accountId: string,
  householdId: string,
  userId: string,
): Promise<string> {
  const history = await accountService.getBalanceHistory(
    accountId,
    householdId,
    userId,
    "all",
  );

  const lines: string[] = [];
  lines.push("Date,Amount");

  for (const entry of history) {
    lines.push(sanitizeCsvRow([entry.date, entry.balance]));
  }

  return lines.join("\n");
}

/**
 * Import balance history from parsed CSV data
 */
export async function importBalanceHistory(
  accountId: string,
  data: { date: string; amount: string }[],
  householdId: string,
  userId: string,
): Promise<{ imported: number }> {
  // Verify access
  const account = await accountRepository.findByIdWithVisibility(
    accountId,
    householdId,
    userId,
  );

  if (!account) {
    throw new NotFoundError("Account not found");
  }

  // Check for duplicate dates
  const dates = data.map((d) => d.date);
  const uniqueDates = new Set(dates);
  if (uniqueDates.size !== dates.length) {
    throw new ValidationError("Duplicate dates found in import data", [
      { field: "dates", message: "Each date must be unique" },
    ]);
  }

  // Check for future dates
  const today = new Date().toISOString().split("T")[0];
  const futureDates = dates.filter((d) => d > today);
  if (futureDates.length > 0) {
    throw new ValidationError("Future dates are not supported", [
      { field: "dates", message: `Found future dates: ${futureDates.join(", ")}` },
    ]);
  }

  // Import snapshots
  const imported = await accountRepository.importBalanceSnapshots(
    accountId,
    data.map((d) => ({
      date: d.date,
      balance: d.amount,
    })),
  );

  logger.info("Imported balance history", {
    accountId,
    householdId,
    count: imported,
  });

  // Audit log the balance history import operation
  await businessAuditService.logCreate({
    householdId,
    userId,
    entityType: "balance_history_import",
    entityId: accountId,
    newValue: {
      accountId,
      accountName: account.name,
      imported,
      dateRange: {
        start: data.length > 0 ? data[0].date : null,
        end: data.length > 0 ? data[data.length - 1].date : null,
      },
    },
  });

  return { imported };
}

/**
 * Helper to calculate start date from date range string
 * TODO-013: Added 1w date range support
 */
export function getStartDateFromRange(dateRange: string): Date {
  const now = new Date();
  switch (dateRange) {
    case "1w":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "1m":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3m":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6m":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "all":
    default:
      return new Date(2000, 0, 1); // Far past date
  }
}
