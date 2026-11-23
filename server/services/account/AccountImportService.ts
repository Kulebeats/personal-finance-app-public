import { readAccountTransactionExport } from "../../repositories/AccountTransactionExport";
import { Money, toMoneyDto } from "../../core/money";
import type { MoneyDto } from "@shared/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { ConflictError, ForbiddenError, NotFoundError, sanitizeErrorMessage } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { AccountReportingService } from "./AccountReportingService";
import { CsvDecimal, sanitizeCsvRow } from "../../core/csv";
import { accountCsvAmount, importDirection } from "./accountCsvSign";
import { transactionService } from "../TransactionService";
import { db } from "../../db";
import { transactions, type Account, type Transaction } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { readVisibleIdempotentReplay } from "../transaction/idempotentReplay";
import { businessAuditService } from "../BusinessAuditService";
import { isCanonicalImportDate } from "@shared/import-date";
import { HttpError, ValidationError } from "../../core/errors";
import { recordImportBatch, type ImportBatchRecord } from "../import/batch";
import type { ImportRowOutcomeRecord } from "../import/types";
import { findPossibleDuplicates, planAccountImportKeys } from "./accountImportIdentity";
import {
  AccountImportReviewRequiredError, decidedSkips, reviewItems, type AccountImportDecision,
} from "./accountImportReview";
import { lockImportAccount } from "../import/ledger";
import { accountImportKey, ImportAdmissionError, withImportAdmission } from "../import/admission";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import type { TransactionRunner, TransactionType } from "../../utils/withTransaction";

/** Lock the actor's current grant and target account: a lost grant is 403, a hidden or gone account 404. */
async function lockCurrentImportTarget(tx: TransactionType, householdId: string, userId: string, accountId: string) {
  const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
  if (!actor) throw new NotFoundError("Account not found");
  return lockImportAccount(tx, actor, accountId);
}

/** One parsed row of the account-export CSV layout. */
export interface AccountImportRow {
  date: string;
  merchant: string;
  category?: string;
  originalStatement?: string;
  notes?: string;
  amount: string;
  tags?: string;
}

export interface AccountImportProgress {
  imported: number;
  /** FIN-04: the signed total in the account currency. */
  totalAmount: MoneyDto;
  skipped: number;
}

/** A row the member chose to post although it may repeat a transaction already on the account (NEW-17, A-01). */
export interface AccountImportPossibleDuplicate {
  row: number;
  transactionId: string;
  matchesTransactionId: string;
}

export type AccountImportResult = AccountImportProgress & {
  possibleDuplicates: AccountImportPossibleDuplicate[];
  /** A-01: flagged rows the member chose to skip. */
  reviewSkipped: number;
};

type AccountImportFailureStage = "row" | "postcommit" | "summary";
type AccountImportRecovery = { committedTransactionId?: string; tagsIncomplete?: boolean };

/**
 * NEW-17 review P2-2: rows commit one by one, so a batch that stops part-way
 * still gets its history row, in its own transaction. A failure to write it is
 * logged and never replaces the import's own error.
 */
async function recordIncompleteAccountImport(run: TransactionRunner, record: ImportBatchRecord): Promise<void> {
  try {
    await run(tx => recordImportBatch(tx, record));
  } catch (historyError) {
    logger.error("Account import history could not be recorded", {
      accountId: record.accountId, householdId: record.householdId, status: record.status,
    }, historyError as Error);
  }
}

/** Earlier rows are durable; retain their outcome even if a later step fails. */
export class AccountImportIncompleteError extends HttpError {
  readonly code = "ACCOUNT_IMPORT_INCOMPLETE";
  readonly statusCode: number;
  readonly details: AccountImportProgress & AccountImportRecovery & {
    failedRow: number | null;
    remaining: number;
    stage: AccountImportFailureStage;
    cause: { code: string; message: string };
  };

  constructor(error: unknown, progress: AccountImportProgress, failedRow: number | null, remaining: number, stage: AccountImportFailureStage, recovery?: AccountImportRecovery) {
    const typed = error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500;
    const cause = typed
      ? { code: error.code, message: sanitizeErrorMessage(error) }
      : { code: "INTERNAL_ERROR", message: "An internal error prevented the import from completing." };
    const where = failedRow === null ? "Import rows completed, but the summary could not be recorded"
      : `Import stopped at row ${failedRow}`;
    super(`${where}: ${progress.imported} imported, ${progress.skipped} duplicates skipped. ${cause.message} Already imported rows are preserved; retrying the same file keeps duplicate protection.`);
    this.statusCode = typed ? error.statusCode : 500;
    this.details = { ...progress, failedRow, remaining, stage, cause, ...recovery };
  }

  toJSON() {
    const response = super.toJSON();
    return { ...response, error: { ...response.error, details: this.details } };
  }
}

export class AccountImportService extends AccountReportingService {
  /**
   * Export transactions for an account as CSV
   * TODO-008: Now uses CSV sanitization
   */
  async exportTransactions(
    accountId: string,
    householdId: string,
    userId: string,
    options: { startDate?: string; endDate?: string },
  ): Promise<string> {
    const { account, rows: txns } = await readAccountTransactionExport(accountId, householdId, userId, options);

    const lines: string[] = [];
    lines.push(
      "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags",
    );

    for (const tx of txns) {
      const tags = tx.tags ? tx.tags.join(", ") : "";
      lines.push(
        sanitizeCsvRow([
          tx.date,
          tx.name,
          tx.categoryName || "",
          account.name,
          tx.originalName || "",
          tx.notes || "",
          // FIN-04: signed by direction so the import posts the same effect back.
          new CsvDecimal(accountCsvAmount(account, tx).toString()),
          tags,
        ]),
      );
    }

    return lines.join("\n");
  }

  /**
   * Import transactions from parsed CSV data
   * TODO-011: Delegates to transactionService for proper validation and processing
   * TODO-015: Now processes and links tags from CSV
   */
  async importTransactions(
    accountId: string,
    data: AccountImportRow[],
    adjustBalance: boolean,
    householdId: string,
    userId: string,
    /** A-01: the member's post/skip choice for each row the last attempt flagged, bound to its match. */
    decisions: readonly AccountImportDecision[] = [],
  ): Promise<AccountImportResult> {
    // Verify access
    const account = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }
    // A-01: the duplicate review and every posting run under the account's import lock.
    return withImportAdmission(async admission => {
      await admission.acquire(accountImportKey(account.id));
      return this.importUnderLock(account, accountId, data, adjustBalance, householdId, userId, decisions, admission.transaction);
    });
  }

  private async importUnderLock(
    account: Account,
    accountId: string,
    data: AccountImportRow[],
    adjustBalance: boolean,
    householdId: string,
    userId: string,
    decisions: readonly AccountImportDecision[],
    accountImportTransaction: TransactionRunner,
  ): Promise<AccountImportResult> {

    // Validate the entire batch before the first transaction writer. Direct
    // service/API callers must not bypass the preview's calendar validation.
    const dateErrors = data.flatMap((row, index) => isCanonicalImportDate(row.date) ? [] : [{
      field: `transactions.${index}.date`,
      message: `Row ${index + 1}: Date must be a valid calendar day in YYYY-MM-DD format`,
    }]);
    if (dateErrors.length) throw new ValidationError("Invalid import dates", dateErrors);

    // Validate magnitudes before the first row commits; CSV signs encode the
    // already-supported income/expense direction, not stored negative amounts.
    const amounts = data.map((row, index) => {
      if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(row.amount)) throw new ValidationError("Invalid import amount", [{ field: `transactions.${index}.amount`, message: "Use a nonzero signed decimal amount with at most two decimal places" }]);
      const value = new Money(row.amount, account.currency);
      if (value.isZero() || value.abs().gt("9999999999999.99")) throw new ValidationError("Invalid import amount", [{ field: `transactions.${index}.amount`, message: "Amount must be nonzero and within the supported range" }]);
      return value;
    });
    const postingMode = adjustBalance ? "posted" : "history_only";
    // NEW-17 (D13): the statement plus the row ordinal, as on the main import path.
    const statementRows = data.map((row, index) => ({ ...row, amount: amounts[index] }));
    const identity = await planAccountImportKeys({ householdId, accountId }, statementRows, postingMode);
    const idempotencyKeys = identity.keys;
    // Refuse a known mode conflict anywhere in the file before a new row commits.
    // The normal create path repeats this check under its existing replay rules
    // so a concurrent import cannot bypass it after this read-only preflight.
    const existingRows = idempotencyKeys.length ? await db.select().from(transactions).where(and(
      eq(transactions.householdId, householdId), inArray(transactions.idempotencyKey, idempotencyKeys),
    )) : [];
    const existingByKey = new Map(existingRows.map(row => [row.idempotencyKey, row]));
    for (const [index, key] of idempotencyKeys.entries()) {
      const existing = existingByKey.get(key);
      if (!existing) continue;
      const replay = await readVisibleIdempotentReplay(existing, householdId, userId, undefined, { operation: "account_import", accountId });
      if (replay.postingMode !== postingMode) {
        throw new ConflictError(`Row ${index + 1}: import posting mode differs from the recorded row; reconciliation is required. No rows were imported.`);
      }
    }
    // A row that does not replay by key but matches a visible ledger row is never dropped and never
    // posted silently (A-01): the whole file waits for the member's decision on its current match.
    const open = idempotencyKeys.flatMap((key, index) => existingByKey.has(key) ? [] : [index + 1]);
    const reviewMatches = await findPossibleDuplicates({ householdId, accountId, userId, rows: statementRows, open,
      ownedKeys: new Set(idempotencyKeys.filter(key => existingByKey.has(key))) });
    const reviewSkips = decidedSkips(reviewMatches, decisions, new Set(open));
    if (!reviewSkips) {
      // A match can vanish because the member lost access, not because the ledger changed. That is
      // reported as the access refusal (nothing recorded), never as a review of a target they cannot see.
      await accountImportTransaction(tx => lockCurrentImportTarget(tx, householdId, userId, account.id));
      throw new AccountImportReviewRequiredError(reviewItems(reviewMatches));
    }
    let reviewSkippedCount = 0;
    const possibleDuplicates: AccountImportPossibleDuplicate[] = [];
    // One history row per attempt: written with the summary, or on its own when the batch stops part-way.
    const history = {
      householdId, userId, accountId, source: "account_csv" as const, identityVersion: identity.version,
      fingerprint: identity.fingerprint, strategy: postingMode, recordCount: data.length,
    };
    let totalAmount = Money.zero(account.currency);
    let importedCount = 0;
    let skippedCount = 0;
    const outcomes: ImportRowOutcomeRecord[] = [];

    // Cache for tags and categories to avoid repeated lookups
    const categoryCache = new Map<string, string>(); // name -> id (empty string for not found)

    // Process each transaction through the proper service
    for (const [index, row] of data.entries()) {
      if (reviewSkips.has(index + 1)) {
        reviewSkippedCount++;
        outcomes.push({ ordinal: index + 1, outcome: "skipped", possibleDuplicateOf: reviewMatches.get(index + 1)?.id });
        continue;
      }
      const amount = amounts[index];
      const type = importDirection(amount);

      const idempotencyKey = idempotencyKeys[index];
      let stage: AccountImportFailureStage = "row";
      let recordedCommit = false;
      let committedTransactionId: string | undefined;
      const recordCommitted = (transaction: Transaction) => {
        if (recordedCommit) return;
        recordedCommit = true;
        committedTransactionId = transaction.id;
        importedCount++;
        const matchesTransactionId = reviewMatches.get(index + 1)?.id;
        outcomes.push({ ordinal: index + 1, outcome: "imported", transactionId: transaction.id,
          ...(matchesTransactionId && { possibleDuplicateOf: matchesTransactionId }) });
        if (matchesTransactionId) possibleDuplicates.push({ row: index + 1, transactionId: transaction.id, matchesTransactionId });
        totalAmount = totalAmount.add(amount);
        stage = "postcommit";
      };

      try {
        // TODO-015: Resolve category by name (case-insensitive)
        let categoryId: string | undefined;
        if (row.category && row.category.trim()) {
          const cachedCategoryId = categoryCache.get(
            row.category.toLowerCase(),
          );
          if (cachedCategoryId !== undefined) {
            categoryId = cachedCategoryId === "" ? undefined : cachedCategoryId;
          } else {
            const category = await categoryRepository.findByNameInHousehold(
              row.category.trim(),
              householdId,
            );
            if (category) {
              categoryCache.set(row.category.toLowerCase(), category.id);
              categoryId = category.id;
            } else {
              categoryCache.set(row.category.toLowerCase(), ""); // Not found, don't retry
            }
          }
        }

        const tagNames = row.tags?.split(",").map(name => name.trim()).filter(Boolean);
        const { transaction, isDuplicate } =
          await transactionService.createTransaction(
            {
              accountId,
              date: row.date,
              name: row.merchant,
              originalName: row.originalStatement || row.merchant,
              amount: amount.abs().toString(),
              currency: account.currency,
              type,
              notes: row.notes,
              source: "csv_import",
              categoryId, // TODO-015: Resolved from name
            },
            householdId,
            userId,
            idempotencyKey,
            undefined,
            { postingMode, producer: "account_import", accountImportTransaction, onCommitted: recordCommitted,
              ...(tagNames?.length && { initialImportTagNames: tagNames }) },
          );

        if (isDuplicate) {
          if (transaction.postingMode !== postingMode) throw new ConflictError("Import posting mode differs from the recorded row; reconciliation is required");
          skippedCount++;
          outcomes.push({ ordinal: index + 1, outcome: "duplicate", transactionId: transaction.id });
          logger.debug("Skipped duplicate import transaction", {
            date: row.date,
            merchant: row.merchant,
            householdId,
          });
        } else {
          // Also tolerate trusted callers/mocks that return a new committed row
          // without using the observer; never count the same commit twice.
          recordCommitted(transaction);
        }
      } catch (error) {
        logger.warn("Account import stopped before completing batch", { accountId, householdId, row: index + 1, imported: importedCount, skipped: skippedCount, error });
        const incomplete = new AccountImportIncompleteError(error, { imported: importedCount, totalAmount: toMoneyDto(totalAmount, account.currency), skipped: skippedCount }, index + 1, data.length - index - 1, stage, committedTransactionId ? {
          committedTransactionId,
        } : undefined);
        // A row that committed before a post-commit failure is already in the outcomes as imported.
        const rowFailed = !committedTransactionId;
        await recordIncompleteAccountImport(accountImportTransaction, { ...history,
          counts: { imported: importedCount, duplicate: skippedCount, skipped: reviewSkippedCount, failed: rowFailed ? 1 : 0, deleted: 0 },
          errors: [{ rowIndex: index + 1, field: "row", reason: incomplete.details.cause.message }],
          outcomes: rowFailed ? [...outcomes, { ordinal: index + 1, outcome: "failed" }] : outcomes,
          status: importedCount > 0 ? "partial" : "failed",
        });
        throw incomplete;
      }
    }
    // The posting core owns every account effect. There is no batch cash offset.

    logger.info("Imported transactions via service", {
      accountId,
      householdId,
      imported: importedCount,
      skipped: skippedCount,
      adjustedBalance: adjustBalance,
    });

    const skipOnly = reviewSkippedCount > 0 && reviewSkippedCount === data.length;
    try {
      // A failed summary must reach the caller after individual postings have committed.
      // Rows commit one by one here (AccountImportIncompleteError keeps their outcome),
      // so the history row is written with the summary, not with every row.
      await accountImportTransaction(async tx => {
        // Hold the current grant and target until history and audit commit: an entirely skipped
        // statement bypassed the ordinary row writer, and the audit row's privacy rule must read the
        // account as it is now, not as the pre-lock read saw it (#367 review P2-1).
        const summaryAccount = await lockCurrentImportTarget(tx, householdId, userId, account.id);
        const importId = await recordImportBatch(tx, {
          ...history,
          counts: { imported: importedCount, duplicate: skippedCount, skipped: reviewSkippedCount, failed: 0, deleted: 0 },
          errors: [], outcomes,
        });
        await businessAuditService.logCreate({
          tx,
          // Defect 10: a private account's import is not a household-visible audit row (the account writers' rule).
          householdId: summaryAccount.isPrivate ? null : householdId,
          userId,
          entityType: "transaction_import",
          entityId: accountId,
          newValue: {
            accountId,
            accountName: summaryAccount.name,
            imported: importedCount,
            skipped: skippedCount,
            possibleDuplicates: possibleDuplicates.length,
            reviewSkipped: reviewSkippedCount,
            totalAmount: toMoneyDto(totalAmount, account.currency),
            adjustedBalance: adjustBalance,
            importId,
          },
        });
      });
    } catch (error) {
      if (skipOnly && (error instanceof ForbiddenError || error instanceof NotFoundError || error instanceof ImportAdmissionError)) throw error;
      logger.warn("Account import summary failed after processing rows", { accountId, householdId, imported: importedCount, skipped: skippedCount, error });
      await recordIncompleteAccountImport(accountImportTransaction, { ...history,
        counts: { imported: importedCount, duplicate: skippedCount, skipped: reviewSkippedCount, failed: 0, deleted: 0 },
        errors: [], outcomes, status: "partial",
      });
      throw new AccountImportIncompleteError(error, { imported: importedCount, totalAmount: toMoneyDto(totalAmount, account.currency), skipped: skippedCount }, null, 0, "summary");
    }

    return {
      imported: importedCount,
      totalAmount: toMoneyDto(totalAmount, account.currency),
      skipped: skippedCount,
      possibleDuplicates,
      reviewSkipped: reviewSkippedCount,
    };
  }

}
