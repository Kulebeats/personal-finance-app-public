import { accounts, type Transaction, transactions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { tagRepository } from "../../repositories/TagRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import { goalAccountAssignmentService } from "../GoalAccountAssignmentService";
import { AccountReportingService } from "./AccountReportingService";
import { sanitizeCsvRow } from "../../core/csv";
import { transactionService } from "../TransactionService";
import { businessAuditService } from "../BusinessAuditService";

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
    // Verify access
    const account = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    const txns = await accountRepository.getTransactionsForAccount(
      accountId,
      householdId,
      options.startDate,
      options.endDate,
    );

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
          tx.amount,
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
    data: {
      date: string;
      merchant: string;
      category?: string;
      originalStatement?: string;
      notes?: string;
      amount: string;
      tags?: string;
    }[],
    adjustBalance: boolean,
    householdId: string,
    userId: string,
  ): Promise<{ imported: number; totalAmount: number; skipped: number }> {
    // Verify access
    const account = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    let totalAmount = Money.zero();
    let importedCount = 0;
    let skippedCount = 0;

    // Cache for tags and categories to avoid repeated lookups
    const tagCache = new Map<string, string>(); // name -> id
    const categoryCache = new Map<string, string>(); // name -> id (empty string for not found)

    // Process each transaction through the proper service
    for (const row of data) {
      try {
        const amount = new Money(row.amount);
        const type = amount.gte(0) ? "income" : "expense";

        // Create unique idempotency key for CSV import
        const idempotencyKey = `csv_import:${accountId}:${row.date}:${row.merchant}:${row.amount}`;

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

        const { transaction, isDuplicate } =
          await transactionService.createTransaction(
            {
              accountId,
              date: row.date,
              name: row.merchant,
              originalName: row.originalStatement || row.merchant,
              amount: row.amount,
              type,
              notes: row.notes,
              source: "csv_import",
              categoryId, // TODO-015: Resolved from name
            },
            householdId,
            userId,
            idempotencyKey,
          );

        if (isDuplicate) {
          skippedCount++;
          logger.debug("Skipped duplicate import transaction", {
            date: row.date,
            merchant: row.merchant,
            householdId,
          });
        } else {
          importedCount++;
          totalAmount = totalAmount.add(amount);

          // TODO-015: Handle tags if provided
          if (row.tags && row.tags.trim()) {
            await this.linkTagsToTransaction(
              transaction.id,
              row.tags,
              householdId,
              tagCache,
            );
          }
        }
      } catch (error) {
        logger.warn("Failed to import transaction row", {
          row,
          error,
          householdId,
        });
        skippedCount++;
      }
    }

    // Adjust balance if requested and balance wasn't already adjusted by transactions
    // Note: createTransaction may handle some balance updates, so this is for explicit adjustment
    // FIX DATA-ACCOUNT-001: Use toString() to avoid floating-point conversion
    if (adjustBalance && !totalAmount.isZero()) {
      await withTransaction(async (tx) => {
        await tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${totalAmount.toString()}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, accountId));
      });

      // Sync goals after balance adjustment
      try {
        await goalAccountAssignmentService.syncGoalsForAccount(
          accountId,
          "csv_import",
        );
      } catch (error) {
        logger.error("Goal auto-sync failed after CSV import", {
          accountId,
          error,
        });
      }
    }

    logger.info("Imported transactions via service", {
      accountId,
      householdId,
      imported: importedCount,
      skipped: skippedCount,
      adjustedBalance: adjustBalance,
    });

    // Audit log the import operation
    await businessAuditService.logCreate({
      householdId,
      userId,
      entityType: "transaction_import",
      entityId: accountId,
      newValue: {
        accountId,
        accountName: account.name,
        imported: importedCount,
        skipped: skippedCount,
        totalAmount: totalAmount.toNumber(),
        adjustedBalance: adjustBalance,
      },
    });

    return {
      imported: importedCount,
      totalAmount: totalAmount.toNumber(),
      skipped: skippedCount,
    };
  }

  /**
   * TODO-015: Link tags to a transaction by name
   * Finds or creates tags and links them to the transaction
   */
  private async linkTagsToTransaction(
    transactionId: string,
    tagsString: string,
    householdId: string,
    tagCache: Map<string, string>,
  ): Promise<void> {
    // Parse comma-separated tags
    const tagNames = tagsString
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tagNames.length === 0) return;

    for (const name of tagNames) {
      try {
        let tagId = tagCache.get(name.toLowerCase());

        if (!tagId) {
          // Try to find existing tag
          const existing = await tagRepository.findByName(householdId, name);
          if (existing) {
            tagId = existing.id;
          } else {
            // Create new tag
            const newTag = await tagRepository.create({
              householdId,
              name,
            });
            tagId = newTag.id;
          }
          tagCache.set(name.toLowerCase(), tagId);
        }

        // Link tag to transaction.
        // SCP-335: only increment usageCount when a new link was inserted so a
        // re-import of the same rows does not inflate the count.
        const { inserted } = await tagRepository.addTagToTransaction(
          transactionId,
          tagId
        );
        if (inserted) {
          await tagRepository.incrementUsageCount(tagId);
        }
      } catch (error) {
        logger.warn("Failed to link tag during import", {
          transactionId,
          tagName: name,
          error,
        });
      }
    }
  }
}
