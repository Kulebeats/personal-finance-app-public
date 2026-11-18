import { parse } from "csv-parse/sync";
import { createHash } from "crypto";
import { db } from "../db";
import {
  accounts,
  merchants,
  transactions,
  type Transaction,
} from "@shared/schema";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { format } from "date-fns";
import { logger } from "../utils/logger";
import { Money } from "../core/money";
import { parseRows } from "./import/parse";
import { buildImportIdempotencyKey, importRowKey } from "./import/dedupe";
import { runPostImportSideEffects } from "./import/sideEffects";
import type {
  ImportMapping,
  ImportOptions,
  ImportRowError,
  ExecuteImportResult,
  ParsedImportRow,
} from "./import/types";
import { transactionRepository } from "../repositories/TransactionRepository";
import { businessAuditService } from "./BusinessAuditService";
import type { TransactionType } from "../utils/withTransaction";

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
   * Execute the import process based on strategy
   */
  async executeImport(
    rows: Record<string, string>[],
    options: ImportOptions,
  ): Promise<ExecuteImportResult> {
    const targetAccountId = options.targetAccountId;
    if (!targetAccountId) {
      throw new Error("Target Account ID is required for this version");
    }

    const parsed = parseRows(rows, options.mapping);
    const validRows = parsed.rows;
    const errors = [...parsed.errors];

    let deleted = 0;
    let imported = 0;
    let skipped = 0;
    const createdTransactions: Transaction[] = [];

    await db.transaction(async (tx) => {
      let existingMap = new Set<string>();
      let minDateString: string | undefined;
      let maxDateString: string | undefined;

      if (validRows.length > 0) {
        const dates = validRows.map((r) => r.date.getTime());
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        minDateString = format(minDate, "yyyy-MM-dd");
        maxDateString = format(maxDate, "yyyy-MM-dd");

        if (options.strategy === "prioritize_csv") {
          deleted = await this.softDeleteVisibleTransactionsForOverwrite(tx, {
            accountId: targetAccountId,
            householdId: options.householdId,
            userId: options.userId,
            startDate: minDateString,
            endDate: maxDateString,
            ipAddress: options.ipAddress,
          });
        }

        if (options.strategy === "prioritize_coppercoin") {
          existingMap = await this.findExistingVisibleKeys(tx, {
            accountId: targetAccountId,
            householdId: options.householdId,
            userId: options.userId,
            startDate: minDateString,
            endDate: maxDateString,
          });
        }
      }

      for (const row of validRows) {
        const rowKey = importRowKey(row);
        if (
          options.strategy === "prioritize_coppercoin" &&
          existingMap.has(rowKey)
        ) {
          skipped++;
          continue;
        }

        const idempotencyKey = buildImportIdempotencyKey(
          options,
          targetAccountId,
          row,
        );
        const [existingByIdempotency] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, options.householdId),
              eq(transactions.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);

        if (existingByIdempotency) {
          skipped++;
          existingMap.add(rowKey);
          continue;
        }

        const categoryId =
          row.categoryName && options.categoryMapping[row.categoryName]
            ? options.categoryMapping[row.categoryName]
            : null;
        const merchantId = await this.findOrCreateMerchantId(tx, {
          householdId: options.householdId,
          merchantName: row.merchantName,
        });

        const { transaction } =
          await transactionRepository.createWithinTransaction(
            tx,
            {
              accountId: targetAccountId,
              householdId: options.householdId,
              ownerUserId: options.userId,
              date: row.dateString,
              type: row.type,
              amount: row.amount.toString(),
              name: row.merchantName || "Imported Transaction",
              originalName: row.merchantName || "Imported Transaction",
              merchantId,
              categoryId,
              notes: row.notes,
              source: "csv_import",
              idempotencyKey,
            },
            {
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

        createdTransactions.push(transaction);
        existingMap.add(rowKey);
        imported++;
      }

      await businessAuditService.logCreate({
        tx,
        userId: options.userId,
        householdId: options.householdId,
        entityId: targetAccountId,
        entityType: "transaction_import",
        newValue: {
          accountId: targetAccountId,
          strategy: options.strategy,
          rowCount: rows.length,
          validRowCount: validRows.length,
          imported,
          skipped,
          deleted,
          errorCount: errors.length,
          startDate: minDateString,
          endDate: maxDateString,
        },
        ipAddress: options.ipAddress,
        metadata: {
          source: "csv_import",
        },
      });
    });

    await runPostImportSideEffects(
      createdTransactions,
      options.householdId,
      options.userId,
    );

    return { imported, skipped, deleted, errors };
  }

  private async softDeleteVisibleTransactionsForOverwrite(
    tx: TransactionType,
    params: {
      accountId: string;
      householdId: string;
      userId: string;
      startDate: string;
      endDate: string;
      ipAddress?: string;
    },
  ): Promise<number> {
    const visibleTransactions = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, params.householdId),
          eq(transactions.accountId, params.accountId),
          gte(transactions.date, params.startDate),
          lte(transactions.date, params.endDate),
          isNull(transactions.deletedAt),
          or(
            eq(transactions.isPrivate, false),
            eq(transactions.ownerUserId, params.userId),
          )!,
        ),
      )
      .for("update");

    if (visibleTransactions.length === 0) {
      return 0;
    }

    const [account] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, params.accountId),
          eq(accounts.householdId, params.householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1)
      .for("update");

    if (!account) {
      throw new Error("Target account not found");
    }

    let totalDelta = Money.zero(account.currency);
    for (const transaction of visibleTransactions) {
      const amount = new Money(
        transaction.amount,
        transaction.currency ?? account.currency,
      );
      const delta = transactionRepository.calculateBalanceDelta(
        transaction.type,
        amount,
        transaction.isTransferIn ?? false,
        transaction.isBalanceAdjustmentIncrease ?? true,
      );
      totalDelta = totalDelta.add(delta);
    }

    const deletedAt = new Date();
    await tx
      .update(transactions)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(
        inArray(
          transactions.id,
          visibleTransactions.map((transaction) => transaction.id),
        ),
      );

    if (!totalDelta.isZero()) {
      await tx
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} - ${totalDelta.toString()}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, params.accountId));
    }

    for (const transaction of visibleTransactions) {
      await businessAuditService.logDelete({
        tx,
        userId: params.userId,
        householdId: params.householdId,
        entityId: transaction.id,
        entityType: "transaction",
        oldValue: {
          accountId: transaction.accountId,
          amount: transaction.amount,
          currency: transaction.currency,
          date: transaction.date,
          type: transaction.type,
          source: transaction.source,
        },
        ipAddress: params.ipAddress,
        metadata: {
          source: "csv_import",
          importStrategy: "prioritize_csv",
        },
      });
    }

    return visibleTransactions.length;
  }

  private async findExistingVisibleKeys(
    tx: TransactionType,
    params: {
      accountId: string;
      householdId: string;
      userId: string;
      startDate: string;
      endDate: string;
    },
  ): Promise<Set<string>> {
    const existing = await tx
      .select({
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, params.householdId),
          eq(transactions.accountId, params.accountId),
          gte(transactions.date, params.startDate),
          lte(transactions.date, params.endDate),
          isNull(transactions.deletedAt),
          or(
            eq(transactions.isPrivate, false),
            eq(transactions.ownerUserId, params.userId),
          )!,
        ),
      );

    return new Set(
      existing.map(
        (transaction) =>
          `${transaction.date}_${transaction.type}_${new Money(
            transaction.amount,
          ).toString()}`,
      ),
    );
  }

  private async findOrCreateMerchantId(
    tx: TransactionType,
    params: { householdId: string; merchantName: string },
  ): Promise<string | null> {
    const merchantName = params.merchantName.trim();
    if (!merchantName) {
      return null;
    }

    const [existingMerchant] = await tx
      .select()
      .from(merchants)
      .where(
        and(
          eq(merchants.name, merchantName),
          eq(merchants.householdId, params.householdId),
        ),
      )
      .limit(1);

    if (existingMerchant) {
      return existingMerchant.id;
    }

    const [newMerchant] = await tx
      .insert(merchants)
      .values({
        name: merchantName,
        householdId: params.householdId,
      })
      .returning({ id: merchants.id });

    return newMerchant.id;
  }
}

export const importService = new ImportService();
