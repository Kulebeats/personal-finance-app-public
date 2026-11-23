/**
 * Receipt Transaction Service
 *
 * Handles linking receipts to transactions and creating transactions from receipts.
 *
 * @module services/receipt/transaction.service
 */

import { and, eq, sql } from "drizzle-orm";
import {
  householdMembers,
  pendingReceipts,
  receiptConversionRecords,
  tags,
  transactionTags,
  transactions,
  type OcrExtractedData,
} from "@shared/schema";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import { receiptRepository } from "../../repositories/ReceiptRepository";
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
import { lockedConversionResult, receiptRequestHash, requireVisibleReceiptPosting } from "./conversion-evidence";
import { businessAuditService } from "../BusinessAuditService";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import { auditTransactionUpdate, isPrivateTransactionAudit } from "../transaction/updateAudit";
import { isPostgresError } from "../../utils/postgresError";
import { isHouseholdRole } from "../../core/authz/capabilities";
import { normalizeTagName } from "../../modules/tags/tags.name-guard";

const RECEIPT_IMPORT_TAG = normalizeTagName("Receipt Import");

function assertReceiptAmount(receiptAmount: string, transactionAmount: string): void {
  const diff = new Money(receiptAmount).abs().subtract(new Money(transactionAmount).abs()).abs();
  if (diff.gt(new Money(MATCH_AMOUNT_TOLERANCE))) {
    throw new ValidationError(
      `Amount mismatch: receipt shows ${receiptAmount} but transaction is ${transactionAmount}. ` +
      `Difference of ${diff.toString()} exceeds tolerance of ${MATCH_AMOUNT_TOLERANCE}.`,
      [{ field: "amount", message: `Amount mismatch: receipt ${receiptAmount}, transaction ${transactionAmount}`, code: "AMOUNT_MISMATCH" }],
    );
  }
}

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
    options?: { skipAmountValidation?: boolean; ipAddress?: string }
  ): Promise<boolean> {
    const visibilityUserId = userId ?? (await receiptRepository.findById(receiptId))?.uploadedBy;
    if (!visibilityUserId) throw new NotFoundError("Receipt not found");
    const receipt = await receiptRepository.findForSignedMatch(receiptId, householdId, visibilityUserId);
    if (!receipt) throw new NotFoundError("Receipt not found");
    const preview = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      visibilityUserId
    );
    if (!preview) throw new NotFoundError("Transaction not found");
    const merchantName = (receipt.ocrData as OcrExtractedData | null)?.merchantName;
    const merchantMatch = merchantName && !preview.merchantId
      ? await resolveMerchantMatch({ householdId, rawName: merchantName })
      : undefined;

    // Serialize linking with OCR, other linkers and the posting's current privacy.
    return withTransaction(async (tx) => {
      const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId: visibilityUserId } });
      if (!actor) throw new NotFoundError("Transaction");
      const locked = await receiptRepository.lockVisibleReceiptForWrite(tx, actor, receiptId);
      if (!locked) throw new NotFoundError("Receipt not found");
      const [conversion] = await tx.select({ transactionId: receiptConversionRecords.transactionId })
        .from(receiptConversionRecords).where(eq(receiptConversionRecords.receiptId, receiptId));
      if (conversion || locked.matchStatus === "matched" || locked.matchedTransactionId) {
        if (locked.matchStatus === "matched" && locked.matchedTransactionId === transactionId
          && (!conversion || conversion.transactionId === transactionId)) {
          await requireVisibleReceiptPosting(tx, actor, transactionId);
          return false;
        }
        throw new ConflictError("Receipt is already matched to another transaction");
      }

      const [posting] = await tx.select({ amount: transactions.amount, merchantId: transactions.merchantId })
        .from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId))).for("update");
      if (!posting) throw new NotFoundError("Transaction not found");
      await requireVisibleReceiptPosting(tx, actor, transactionId);
      const ocrData = locked.ocrData as OcrExtractedData | null;
      if (ocrData?.amount && !options?.skipAmountValidation) assertReceiptAmount(ocrData.amount, posting.amount);

      if (merchantMatch?.merchant && !posting.merchantId && ocrData?.merchantName === merchantName) {
        if (merchantMatch.aliasCandidate) {
          await ensureMerchantAlias(merchantMatch.merchant.id, merchantMatch.aliasCandidate, tx);
        }
        // FIN-16: the merchant/name change is audited in this same transaction.
        await transactionRepository.update(
          transactionId, householdId, { merchantId: merchantMatch.merchant.id, name: merchantMatch.merchant.name }, undefined, tx,
          {
            onWrite: async (writeTx, snapshot) => {
              await auditTransactionUpdate(writeTx, {
                householdId, userId: userId ?? null, before: snapshot.before, after: snapshot.after,
                privateAudit: snapshot.privateAudit || await isPrivateTransactionAudit(writeTx, snapshot.after),
                onlyFields: ["merchantId", "name"], ipAddress: options?.ipAddress,
                metadata: { operation: "receiptMatch", receiptId },
              });
            },
          },
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
      // The link audit is part of the match, so a failed audit undoes the link.
      await businessAuditService.log({
        tx, userId: userId ?? null, householdId, action: "LINK", entityType: "receipt", entityId: receiptId,
        details: { transactionId }, ipAddress: options?.ipAddress,
      });
      return true;
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
    },
    auditContext?: { ipAddress?: string },
  ): Promise<{ transactionId: string; replayed: boolean }> {
    // R6-08 review: a receipt the caller cannot read is missing before any
    // account check, so a bad account id cannot tell hidden from unknown.
    const receipt = await receiptRepository.findForSignedMatch(receiptId, householdId, userId);
    if (!receipt) {
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

    const requestHash = receiptRequestHash(data);
    const merchantMatch = await resolveMerchantMatch({
      householdId,
      rawName: data.name,
    });
    const resolvedName = merchantMatch.merchant
      ? merchantMatch.merchant.name
      : merchantMatch.cleanedName || data.name;
    const resolvedMerchantId = merchantMatch.merchant?.id ?? null;

    const result = await withTransaction(async (tx) => {
      const existingId = await lockedConversionResult(tx, receiptId, householdId, userId, requestHash);
      if (existingId) return { transactionId: existingId, replayed: true };
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
        }, {
          createActor: { householdId, userId },
          validateReferences: true,
          publishCreatedEvent: true,
          audit: { householdId, userId, ipAddress: auditContext?.ipAddress,
            metadata: { operation: "createFromReceipt", receiptId } },
          merchantAlias: merchantMatch.merchant && merchantMatch.aliasCandidate
            ? { merchantId: merchantMatch.merchant.id, aliasName: merchantMatch.aliasCandidate }
            : undefined,
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

      await tx.insert(receiptConversionRecords).values({
        receiptId, householdId, transactionId: transaction.id, requestVersion: 1, requestHash,
      });
      await businessAuditService.log({
        tx, userId, householdId, action: "LINK", entityType: "receipt", entityId: receiptId,
        details: { transactionId: transaction.id, method: "create" }, ipAddress: auditContext?.ipAddress,
      });
      return { transactionId: transaction.id, replayed: false };
    }).catch(error => {
      if (isPostgresError(error, "23505", "receipt_conversion_household_image_unique")) throw new ConflictError("Receipt has already been converted");
      throw error;
    });

    return result;
  }

  private async addReceiptImportTagWithTx(
    tx: TransactionType,
    transactionId: string,
    householdId: string
  ): Promise<void> {
    // One "Receipt Import" tag per household in any case (NEW-39). This runs after the account
    // lock, so it cannot take the tag-name lock the import writer takes before its account lock.
    // The unique index decides instead: a concurrent first insert wins, this insert does nothing,
    // and the re-read returns the winner's tag.
    const findTag = async () => (await tx.select().from(tags)
      .where(and(eq(tags.householdId, householdId), sql`lower(${tags.name}) = lower(${RECEIPT_IMPORT_TAG})`))
      .limit(1).for("update"))[0];
    const tag = await findTag()
      ?? (await tx.insert(tags).values({ householdId, name: RECEIPT_IMPORT_TAG, color: "#10B981" })
        .onConflictDoNothing().returning())[0]
      ?? await findTag();
    if (!tag) throw new ConflictError("Tag state requires reconciliation");
    // The reused tag may be member-specific (the name is one per household in any case). Apply the
    // tag writer's rule: its member must still be in this household (TagWriteRepository).
    if (tag.memberId) {
      const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, tag.memberId))).limit(1);
      if (!member || !isHouseholdRole(member.role)) throw new ConflictError("Tag state requires reconciliation");
    }

    // Serialize counter verification/effects with the single-transaction writer.
    // Historical inconsistencies require explicit reconciliation, never a recount.
    const [count] = await tx.select({ value: sql<number>`count(*)::int`.mapWith(Number) })
      .from(transactionTags).where(eq(transactionTags.tagId, tag.id));
    if (!Number.isSafeInteger(tag.usageCount) || tag.usageCount! < 0 || tag.usageCount !== count.value) {
      throw new ConflictError("Tag state requires reconciliation");
    }
    const added = await tx.insert(transactionTags).values({ transactionId, tagId: tag.id })
      .onConflictDoNothing().returning({ tagId: transactionTags.tagId });
    if (added.length) await tx.update(tags).set({ usageCount: sql`${tags.usageCount} + 1` }).where(eq(tags.id, tag.id));
  }
}

export const receiptTransactionService = new ReceiptTransactionService();
