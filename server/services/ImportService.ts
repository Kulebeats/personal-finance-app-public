import { parse } from "csv-parse/sync";
import { db } from "../db";
import {
  accounts, type Account,
  transactions,
  type Transaction,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { Money } from "../core/money";
import { runPostImportSideEffects } from "./import/sideEffects";
import type {
  ImportOptions,
  ExecuteImportResult,
  ImportRowOutcomeRecord,
  ParsedImportRow,
} from "./import/types";
import { transactionRepository } from "../repositories/TransactionRepository";
import { lockTransactionCreateGrant } from "../repositories/TransactionCreateBoundary";
import {
  assertImportCurrency, assertReplayableImportRow, importedRowName, lockImportAccount, reverseImportOverwrite,
} from "./import/ledger";
import { GLOBAL_IMPORT_IDENTITY_VERSION, importRequestFingerprint } from "./import/identity";
import {
  buildStatement, failedOrdinals, ImportRowConflictError, matchKeys, repeatedIdentityConflicts, storedMatch,
} from "./import/statement";
import { readImportBatchForUpdate, recordImportBatch, replayImportBatch } from "./import/batch";
import { accountImportKey, batchImportKey, withImportAdmission } from "./import/admission";
import { overwriteScopeOf, statementDigests } from "./import/overwrite";
import { assertCandidatesReviewed } from "./import/candidateReview";
import { ValidationError } from "../utils/errorHandler";
import { businessAuditService } from "./BusinessAuditService";
import type { TransactionType } from "../utils/withTransaction";
import { findOrCreateMerchantByName } from "../modules/merchants/merchants.name-guard";

// Types now live in ./import/types; re-exported here so existing importers of
// `services/ImportService` keep working unchanged.
export type { ImportRowError, ExecuteImportResult } from "./import/types";

export class ImportService {
  /**
   * Parse CSV buffer and return raw rows with normalized headers
   */
  async parseCsv(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
    let content = buffer.toString("utf-8");

    // Strip BOM (Byte Order Mark) if present - common in Excel exports
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    // Normalize newlines (CRLF, CR -> LF)
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Trim trailing empty lines
    const trimmed = normalized.trimEnd();

    if (!trimmed || trimmed.length === 0) {
      throw new Error("CSV file is empty");
    }

    try {
      const records = parse(trimmed, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true, // More lenient quoting
        bom: true, // Built-in BOM handling
      });

      if (!records || records.length === 0) {
        throw new Error("CSV file contains no data rows (only headers?)");
      }

      const headers = Object.keys((records as Record<string, string>[])[0]);
      if (headers.length === 0) {
        throw new Error("CSV file has no columns");
      }

      return { headers, rows: records as Record<string, string>[] };
    } catch (error) {
      const message = (error as Error).message;
      // Provide more helpful error messages
      if (message.includes("Invalid Record Length")) {
        throw new Error(
          "Failed to parse CSV: Inconsistent number of columns. Some rows have more/fewer columns than the header.",
        );
      }
      if (message.includes("Invalid Opening Quote")) {
        throw new Error(
          "Failed to parse CSV: Unbalanced quotes in the file. Check for unclosed quotes.",
        );
      }
      throw new Error(`Failed to parse CSV: ${message}`);
    }
  }

  /**
   * Execute the import process based on strategy.
   *
   * NEW-17 (D13): row identity is the provider reference or the batch
   * fingerprint plus row ordinal (`import/identity.ts`). A ledger row that only
   * shares date, type and amount is never merged here; the preview offers it as
   * a candidate and the caller lists confirmed duplicates in `skipRowOrdinals`.
   * One `data_imports` row is written in the same transaction as the ledger rows.
   */
  async executeImport(
    rows: Record<string, string>[],
    options: ImportOptions,
  ): Promise<ExecuteImportResult> {
    const targetAccountId = options.targetAccountId;
    if (!targetAccountId) {
      throw new Error("Target Account ID is required for this version");
    }

    // R2 P2: the preview's currency binds execute; the A-48 lock compare then holds it until the write.
    assertImportCurrency(options.previewCurrency, options.accountCurrency);
    const expectedCurrency = options.previewCurrency ?? options.accountCurrency;
    const { fingerprint, statement, errors } = buildStatement(rows, options, targetAccountId);
    // Even an all-failed statement can record a keyed result. Its validation
    // must still describe the denomination under which that result commits.
    const needsAccountLock = statement.length > 0 || expectedCurrency !== undefined;
    // A provider reference repeated with different content refuses the whole file before any write.
    const repeated = repeatedIdentityConflicts(statement);
    if (repeated.size > 0) throw new ImportRowConflictError(statement, repeated);
    const skipOrdinals = new Set(options.skipRowOrdinals ?? []);
    const failed = failedOrdinals(errors);
    const postRows = options.postRows ?? [];
    const skipRows = options.skipRows ?? [];
    const requestFingerprint = importRequestFingerprint([fingerprint, targetAccountId.toLowerCase(), options.strategy,
      Object.entries(options.categoryMapping).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      Array.from(skipOrdinals).sort((a, b) => a - b),
      // Only when present, so a batch recorded before A-01 still replays under its fingerprint.
      ...(postRows.length ? [postRows.map(item => [item.ordinal, item.candidateId.toLowerCase()]).sort((a, b) => Number(a[0]) - Number(b[0]))] : []),
      ...(skipRows.length ? [{ skipRows: skipRows.map(item => [item.ordinal, item.candidateId.toLowerCase()]).sort((a, b) => Number(a[0]) - Number(b[0])) }] : [])]);
    const { statementDigest } = statementDigests(statement, options.categoryMapping);
    const counts = { imported: 0, duplicate: 0, skipped: 0, failed: failed.length, deleted: 0 };
    const outcomes: ImportRowOutcomeRecord[] = failed.map(ordinal => ({ ordinal, outcome: "failed" }));
    const createdTransactions: Transaction[] = [];
    let importId = "";

    const postStatement = async (tx: TransactionType) => {
      const actor = (await lockTransactionCreateGrant(tx, options.householdId, {
        createActor: { householdId: options.householdId, userId: options.userId },
      }))!;
      let account: Account | undefined;
      let minDateString: string | undefined;
      let maxDateString: string | undefined;

      if (statement.length > 0) {
        const dates = statement.map(({ row }) => row.dateString).sort();
        minDateString = dates[0];
        maxDateString = dates[dates.length - 1];

        if (options.strategy === "prioritize_csv") {
          ({ account, deleted: counts.deleted } = await reverseImportOverwrite(tx, {
            scope: overwriteScopeOf(statement, options.categoryMapping, actor, targetAccountId)!, actor,
            ipAddress: options.ipAddress, expectedCurrency, reviewedRemovals: options.reviewedRemovals ?? [],
          }));
        } else {
          account = await lockImportAccount(tx, actor, targetAccountId, expectedCurrency);
        }
      } else if (needsAccountLock) {
        account = await lockImportAccount(tx, actor, targetAccountId, expectedCurrency);
      }

      const keys = statement.flatMap(matchKeys);
      const matches = keys.length ? await tx.select().from(transactions).where(and(
        eq(transactions.householdId, options.householdId), inArray(transactions.idempotencyKey, keys),
      )) : [];
      const byKey = new Map(matches.map(row => [row.idempotencyKey, row]));
      // R2-01: in "keep the ledger" mode only skips bound to their current candidate apply.
      const rowSkips = options.strategy === "prioritize_coppercoin"
        ? await assertCandidatesReviewed(tx, { householdId: options.householdId, userId: actor.userId, accountId: targetAccountId,
          statement, byKey, skipOrdinals, skipRows, postRows })
        : skipOrdinals;
      // Apply replacement income first so the asset overdraft guard sees the funds available in this batch.
      const ordered = account?.isAsset && options.strategy === "prioritize_csv"
        ? [...statement].sort((a, b) => Number(b.row.type === "income") - Number(a.row.type === "income"))
        : statement;
      const seenKeys = new Set<string>();
      for (const item of ordered) {
        const { row, idempotencyKey } = item;
        if (!account) throw new Error("Import account lock missing");
        const existing = storedMatch(byKey, item);
        const verdict = existing && assertReplayableImportRow(existing, {
          account, actorUserId: actor.userId, row, strategy: options.strategy,
        });
        if (verdict || seenKeys.has(idempotencyKey)) {
          // Hidden matches and visible duplicates store the same outcome: no transaction id for either.
          counts.duplicate++;
          outcomes.push({ ordinal: row.rowIndex, outcome: "duplicate" });
          continue;
        }
        seenKeys.add(idempotencyKey);
        if (rowSkips.has(row.rowIndex)) {
          counts.skipped++;
          outcomes.push({ ordinal: row.rowIndex, outcome: "skipped" });
          continue;
        }
        const transaction = await this.createImportedRow(tx, options, account, row, idempotencyKey);
        createdTransactions.push(transaction);
        counts.imported++;
        outcomes.push({ ordinal: row.rowIndex, outcome: "imported", transactionId: transaction.id });
      }

      if (account?.isAsset && counts.deleted > 0) {
        const [final] = await tx.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, account.id));
        const closing = new Money(final.balance, account.currency);
        if (closing.lt(0) && closing.lt(new Money(account.balance, account.currency))) {
          throw new ValidationError("Insufficient funds to reverse the overwritten income");
        }
      }
      importId = await recordImportBatch(tx, {
        householdId: options.householdId, userId: options.userId, accountId: targetAccountId,
        source: "global_csv", identityVersion: GLOBAL_IMPORT_IDENTITY_VERSION, fingerprint: requestFingerprint,
        batchKey: options.batchKey, strategy: options.strategy, fileName: options.fileName,
        recordCount: rows.length, counts, errors, outcomes,
      });
      await businessAuditService.logCreate({
        tx,
        userId: options.userId,
        // A private account's import is not a household-visible audit row (#367 review P2-2).
        // overwrite.ts reads this row back for exact-retry detection, scoped to the actor.
        householdId: account?.isPrivate ? null : options.householdId,
        entityId: targetAccountId,
        entityType: "transaction_import",
        newValue: {
          accountId: targetAccountId,
          importId,
          identityVersion: GLOBAL_IMPORT_IDENTITY_VERSION,
          strategy: options.strategy,
          rowCount: rows.length,
          validRowCount: statement.length,
          statementDigest,
          ...counts,
          errorCount: errors.length,
          startDate: minDateString,
          endDate: maxDateString,
        },
        ipAddress: options.ipAddress,
        metadata: {
          source: "csv_import",
        },
      });
    };

    const batchKey = options.batchKey;
    if (batchKey || needsAccountLock) {
      const replay = await withImportAdmission(async admission => {
        if (batchKey) {
          await admission.acquire(batchImportKey(options.householdId, batchKey));
          const prior = await admission.transaction(tx => readImportBatchForUpdate(tx, options.householdId, batchKey));
          if (prior) return replayImportBatch(prior, requestFingerprint, options.userId);
        }
        if (needsAccountLock) await admission.acquire(accountImportKey(targetAccountId));
        await admission.transaction(postStatement);
      });
      if (replay) return replay;
    } else {
      await db.transaction(postStatement);
    }
    await runPostImportSideEffects(
      createdTransactions,
      options.householdId,
      options.userId,
      counts.deleted,
    );

    return { importId, replayed: false, ...counts, errors };
  }

  private async createImportedRow(
    tx: TransactionType, options: ImportOptions, account: Account, row: ParsedImportRow, idempotencyKey: string,
  ): Promise<Transaction> {
    const categoryId =
      row.categoryName && options.categoryMapping[row.categoryName]
        ? options.categoryMapping[row.categoryName]
        : null;
    const merchantId = await this.findOrCreateMerchantId(tx, {
      householdId: options.householdId,
      merchantName: row.merchantName,
    });
    const { transaction } = await transactionRepository.createWithinTransaction(
      tx,
      {
        accountId: account.id,
        householdId: options.householdId,
        ownerUserId: options.userId,
        date: row.dateString,
        type: row.type,
        amount: row.amount.toString(), currency: account.currency,
        name: importedRowName(row),
        originalName: importedRowName(row),
        merchantId,
        categoryId,
        notes: row.notes,
        source: "csv_import",
        idempotencyKey,
      },
      {
        validateReferences: true,
        publishCreatedEvent: true,
        audit: {
          userId: options.userId,
          householdId: options.householdId,
          ipAddress: options.ipAddress,
          metadata: {
            source: "csv_import",
            importStrategy: options.strategy,
          },
        },
      },
    );
    return transaction;
  }

  private async findOrCreateMerchantId(
    tx: TransactionType,
    params: { householdId: string; merchantName: string },
  ): Promise<string | null> {
    const merchantName = params.merchantName.trim();
    if (!merchantName) {
      return null;
    }

    // Names and aliases share one namespace (merchants.name-guard): a row whose
    // merchant text is already a merchant's name or alias links to it.
    const { merchantId } = await findOrCreateMerchantByName(tx, params.householdId, merchantName);
    return merchantId;
  }
}

export const importService = new ImportService();
