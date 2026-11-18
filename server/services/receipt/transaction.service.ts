/**
 * Receipt Transaction Service
 *
 * Handles linking receipts to transactions and creating transactions from receipts.
 *
 * @module services/receipt/transaction.service
 */

import { and, eq } from "drizzle-orm";
import {
  pendingReceipts,
  tags,
  transactionTags,
  type OcrExtractedData,
} from "@shared/schema";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { tagRepository } from "../../repositories/TagRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { accountRepository } from "../../repositories/AccountRepository";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../utils/errorHandler";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { MATCH_AMOUNT_TOLERANCE } from "./matching";
import { Money } from "../../core/money";

export class ReceiptTransactionService {
  /**
   * Link a pending receipt to a transaction
   * @param options.skipAmountValidation - Set true to allow mismatched amounts (manual override)
   */
  async linkReceiptToTransaction(
    receiptId: string,
    transactionId: string,
    householdId: string,
    userId?: string,
    options?: { skipAmountValidation?: boolean }
  ): Promise<void> {
    const receipt = await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }

    const visibilityUserId = userId ?? receipt.uploadedBy;

    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      visibilityUserId
    );
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    // Validate amount match unless explicitly skipped
    const ocrData = receipt.ocrData as OcrExtractedData | null;
    if (ocrData?.amount && !options?.skipAmountValidation) {
      const ocrAmount = new Money(ocrData.amount).abs();
      const txnAmount = new Money(transaction.amount).abs();
      const diff = ocrAmount.subtract(txnAmount).abs();
      const tolerance = new Money(MATCH_AMOUNT_TOLERANCE);

      if (diff.gt(tolerance)) {
        throw new ValidationError(
          `Amount mismatch: receipt shows ${ocrData.amount} but transaction is ${transaction.amount}. ` +
          `Difference of ${diff.toString()} exceeds tolerance of ${MATCH_AMOUNT_TOLERANCE}.`,
          [
            {
              field: "amount",
              message: `Amount mismatch: receipt ${ocrData.amount}, transaction ${transaction.amount}`,
              code: "AMOUNT_MISMATCH",
            },
          ]
        );
      }
    }

    // Resolve the merchant (and persist any alias) up-front, before the atomic
    // section — mirrors createTransactionFromReceipt. The alias write is a
    // best-effort, idempotent side effect, not part of the link's atomicity.
    let resolvedMerchant: { id: string; name: string } | null = null;
    if (ocrData?.merchantName && !transaction.merchantId) {
      const merchantMatch = await resolveMerchantMatch({
        householdId,
        rawName: ocrData.merchantName,
      });
      if (merchantMatch.merchant) {
        resolvedMerchant = {
          id: merchantMatch.merchant.id,
          name: merchantMatch.merchant.name,
        };
        if (merchantMatch.aliasCandidate) {
          await ensureMerchantAlias(
            merchantMatch.merchant.id,
            merchantMatch.aliasCandidate
          );
        }
      }
    }

    // SCP-337: the status flip + tag add must be ONE atomic, race-safe unit.
    // Previously this was read-then-write with no transaction or lock, so a
    // manual match racing the auto-match cron could double-link and double-tag
    // the same receipt. Lock the receipt row FOR UPDATE and re-check its status
    // inside the transaction before writing.
    await withTransaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(pendingReceipts)
        .where(
          and(
            eq(pendingReceipts.id, receiptId),
            eq(pendingReceipts.householdId, householdId)
          )
        )
        .for("update")
        .limit(1);

      if (!locked) {
        throw new NotFoundError("Receipt not found");
      }

      // Race guard: if the receipt was already matched (by a concurrent manual
      // match or the auto-match cron), do not link again.
      if (locked.matchStatus === "matched") {
        if (locked.matchedTransactionId === transactionId) {
          return; // idempotent: already linked to this exact transaction
        }
        throw new ConflictError(
          "Receipt is already matched to another transaction"
        );
      }

      if (resolvedMerchant) {
        await transactionRepository.update(
          transactionId,
          householdId,
          { merchantId: resolvedMerchant.id, name: resolvedMerchant.name },
          undefined,
          tx
        );
      }

      await tx
        .update(pendingReceipts)
        .set({
          matchStatus: "matched",
          matchedTransactionId: transactionId,
          updatedAt: new Date(),
        })
        .where(eq(pendingReceipts.id, receiptId));

      await this.addReceiptImportTagWithTx(tx, transactionId, householdId);
    });
  }

  /**
   * Create transaction from receipt data
   */
  async createTransactionFromReceipt(
    receiptId: string,
    householdId: string,
    userId: string,
    data: {
      accountId: string;
      name: string;
      amount: string;
      date: string;
      categoryId?: string;
      notes?: string;
    }
  ): Promise<{ transactionId: string }> {
    const receipt = await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }

    // FIX AUTH-RECEIPTS-001: Validate account ownership before creating transaction
    const account = await accountRepository.findByIdWithVisibility(
      data.accountId,
      householdId,
      userId
    );
    if (!account) {
      throw new NotFoundError("Account not found");
    }

    const merchantMatch = await resolveMerchantMatch({
      householdId,
      rawName: data.name,
    });
    const resolvedName = merchantMatch.merchant
      ? merchantMatch.merchant.name
      : merchantMatch.cleanedName || data.name;
    const resolvedMerchantId = merchantMatch.merchant?.id ?? null;

    if (merchantMatch.merchant && merchantMatch.aliasCandidate) {
      await ensureMerchantAlias(
        merchantMatch.merchant.id,
        merchantMatch.aliasCandidate
      );
    }

    const result = await withTransaction(async (tx) => {
      const { transaction } =
        await transactionRepository.createWithinTransaction(tx, {
          householdId,
          ownerUserId: userId,
          accountId: data.accountId,
          name: resolvedName,
          amount: data.amount,
          date: data.date,
          type: "expense",
          source: "receipt_scan",
          categoryId: data.categoryId,
          merchantId: resolvedMerchantId,
          notes: data.notes ? `[Receipt Scan] ${data.notes}` : "[Receipt Scan]",
        });

      await tx
        .update(pendingReceipts)
        .set({
          matchStatus: "matched",
          matchedTransactionId: transaction.id,
          updatedAt: new Date(),
        })
        .where(eq(pendingReceipts.id, receiptId));

      await this.addReceiptImportTagWithTx(tx, transaction.id, householdId);

      return { transactionId: transaction.id };
    });

    return result;
  }

  private async addReceiptImportTagWithTx(
    tx: TransactionType,
    transactionId: string,
    householdId: string
  ): Promise<void> {
    const existingTag = await tx
      .select()
      .from(tags)
      .where(
        and(eq(tags.householdId, householdId), eq(tags.name, "Receipt Import"))
      )
      .limit(1);

    const tag =
      existingTag[0] ||
      (
        await tx
          .insert(tags)
          .values({ householdId, name: "Receipt Import", color: "#10B981" })
          .returning()
      )[0];

    const existingLink = await tx
      .select()
      .from(transactionTags)
      .where(
        and(
          eq(transactionTags.transactionId, transactionId),
          eq(transactionTags.tagId, tag.id)
        )
      )
      .limit(1);

    if (existingLink.length === 0) {
      await tx
        .insert(transactionTags)
        .values({ transactionId, tagId: tag.id });
    }
  }
}

export const receiptTransactionService = new ReceiptTransactionService();
