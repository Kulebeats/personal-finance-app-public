import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { accounts, transactionAttachments, transactions, type Transaction } from "@shared/schema";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";
import { sanitizeUploadExtension } from "../core/uploads";
import {
  discardUnlessCommitted, putUploadObject, removeUploadTarget, resolveUploadTarget, type UploadObjectTarget,
} from "../core/storage/upload-objects";
import { businessAuditService } from "./BusinessAuditService";
import { isPrivateTransactionAudit } from "./transaction/updateAudit";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { NotFoundError } from "../core/errors";
import { transactionRepository } from "../repositories/TransactionRepository";
import { visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import type { HouseholdRole } from "../core/authz/capabilities";

// Logical name prefix the attachment rows record (OPS-001: the bytes live in the ObjectStore).
// New rows store it relative to the working directory, never as an absolute host path.
const UPLOADS_DIR = path.join("uploads", "transactions");

const ATTACHMENT_EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
} as const;

export interface AttachmentUpload {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
  filename: string;
}

export interface AttachmentData {
  id: string;
  transactionId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: Date;
}

class AttachmentService {
  /**
   * Rule 11 under concurrency. Lock order is TRANSACTION first, then its
   * account, then (on delete) the attachment row: the same order as the
   * transaction writers (TransactionUpdateWriter and TransactionRepository take
   * the transaction FOR UPDATE, then the account). The reverse order here would
   * deadlock against an edit.
   *
   * 1. Lock the transaction FOR SHARE (household-scoped). A writer needs FOR
   *    UPDATE, so its account cannot change while we hold this.
   * 2. Lock that account FOR SHARE.
   * 3. Re-read the transaction under the visibility predicate, now that both
   *    rows are stable. A privacy change that committed first makes it a 404,
   *    as for a missing transaction.
   */
  private async lockVisibleTransaction(
    tx: TransactionType,
    transactionId: string,
    householdId: string,
    userId: string,
    role: HouseholdRole
  ): Promise<Transaction> {
    const [locked] = await tx
      .select({ accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)))
      .for("share")
      .limit(1);
    if (!locked) throw new NotFoundError("Transaction not found");

    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, locked.accountId)).for("share");

    const [txn] = await tx
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.id, transactionId),
        // The caller's own role, never an assumed one (Rule 11).
        visibleTransactionPredicate({ householdId, userId, role }),
      ))
      .limit(1);
    if (!txn) throw new NotFoundError("Transaction not found");
    return txn;
  }

  /**
   * Upload an attachment to a transaction
   */
  async uploadAttachment(
    transactionId: string,
    file: AttachmentUpload,
    householdId: string,
    userId: string,
    role: HouseholdRole
  ): Promise<AttachmentData> {
    // Rule 11: the transaction must be visible to this member. A hidden one is
    // a 404, the same as one that does not exist.
    const txn = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );

    if (!txn) {
      throw new NotFoundError("Transaction not found");
    }

    const ext = sanitizeUploadExtension(
      file.mimetype,
      ATTACHMENT_EXTENSION_BY_MIME,
    );
    const storedFilename = `${randomUUID()}${ext}`;
    const storagePath = path.join(UPLOADS_DIR, transactionId, storedFilename);

    // Read and drop the multer temp file BEFORE storing (OPS-001), so a failed
    // temp-file removal can never strand a stored object that no row references.
    // A removal that fails fails the upload before anything is stored: the
    // controller's cleanup retries it, and no copy of the bytes is left behind
    // on a success path.
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file.path);
    } finally {
      await fs.rm(file.path, { force: true }).catch((error: unknown) => {
        logger.error("Could not remove an attachment temp file; failing the upload", {
          tempPath: file.path, code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
        });
        throw error;
      });
    }
    await putUploadObject({ stored: storagePath, householdId, purpose: "attachment", bytes, mediaType: file.mimetype, userId });

    // Insert the DB record and its audit row in one transaction (Rule 9). If it
    // fails the file just stored is removed so nothing is left behind. The row
    // carries ids, mime type and size, never the original file name.
    let attachment: typeof transactionAttachments.$inferSelect;
    try {
      attachment = await withTransaction(async (tx) => {
        const lockedTxn = await this.lockVisibleTransaction(tx, transactionId, householdId, userId, role);
        const [saved] = await tx
          .insert(transactionAttachments)
          .values({
            transactionId,
            filename: storedFilename,
            originalFilename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath,
            uploadedBy: userId,
          })
          .returning();
        await businessAuditService.logCreate({
          tx,
          userId,
          householdId: (await isPrivateTransactionAudit(tx, lockedTxn)) ? null : householdId,
          entityType: "transaction_attachment",
          entityId: saved.id,
          newValue: { transactionId, mimeType: file.mimetype, size: file.size },
        });
        return saved;
      });
    } catch (error) {
      await discardUnlessCommitted(storagePath, "attachment", error);
      throw error;
    }

    logger.info("Uploaded attachment", {
      attachmentId: attachment.id,
      transactionId,
      originalFilename: file.originalname,
    });

    return this.formatAttachment(attachment);
  }

  /**
   * Get all attachments for a transaction
   */
  async getAttachments(
    transactionId: string,
    householdId: string,
    userId: string
  ): Promise<AttachmentData[]> {
    const txn = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );

    if (!txn) {
      throw new NotFoundError("Transaction not found");
    }

    const attachments = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, transactionId));

    return attachments.map((a) => this.formatAttachment(a));
  }

  /**
   * Get a single attachment by ID
   */
  async getAttachment(
    attachmentId: string,
    householdId: string,
    userId: string
  ): Promise<{ attachment: AttachmentData; filePath: string } | null> {
    const [attachment] = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, attachmentId))
      .limit(1);

    if (!attachment) {
      return null;
    }

    // Visibility of the attachment is the visibility of its transaction.
    const txn = await transactionRepository.findByIdWithVisibility(
      attachment.transactionId,
      householdId,
      userId
    );

    if (!txn) {
      return null;
    }

    return {
      attachment: this.formatAttachment(attachment),
      filePath: attachment.storagePath,
    };
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(
    attachmentId: string,
    householdId: string,
    userId: string,
    role: HouseholdRole
  ): Promise<void> {
    const result = await this.getAttachment(attachmentId, householdId, userId);

    if (!result) {
      throw new NotFoundError("Attachment not found");
    }

    // Delete the DB record and write its audit row in one transaction (Rule 9);
    // the file goes only after that commits, so a failed audit keeps both.
    const files = await withTransaction(async (tx) => {
      const [peek] = await tx
        .select({ transactionId: transactionAttachments.transactionId })
        .from(transactionAttachments)
        .where(eq(transactionAttachments.id, attachmentId))
        .limit(1);
      if (!peek) throw new NotFoundError("Attachment not found");
      // Lock and re-check the transaction first (account, transaction, attachment).
      const txn = await this.lockVisibleTransaction(tx, peek.transactionId, householdId, userId, role);
      const [row] = await tx
        .select()
        .from(transactionAttachments)
        .where(eq(transactionAttachments.id, attachmentId))
        .for("update")
        .limit(1);
      if (!row || row.transactionId !== txn.id) throw new NotFoundError("Attachment not found");

      await tx.delete(transactionAttachments).where(eq(transactionAttachments.id, attachmentId));
      await businessAuditService.logDelete({
        tx,
        userId,
        householdId: (await isPrivateTransactionAudit(tx, txn)) ? null : householdId,
        entityType: "transaction_attachment",
        entityId: attachmentId,
        oldValue: { transactionId: row.transactionId, mimeType: row.mimeType, size: row.size },
      });
      // Both files the row named: the attachment and, for a legacy row, its
      // thumbnail. Each is resolved against this attachment's own transaction
      // and household before commit; a path naming another owner's file
      // resolves to null and is never deleted.
      const owner = { purpose: "attachment", householdId, transactionId: row.transactionId } as const;
      const targets: UploadObjectTarget[] = [];
      for (const stored of [row.storagePath, row.thumbnailPath]) {
        const target = stored ? await resolveUploadTarget(stored, tx, owner) : null;
        if (target) targets.push(target);
      }
      return targets;
    });

    // The record is gone; each file is attempted on its own, and one that
    // cannot be removed is logged, not thrown.
    for (const target of files) {
      try {
        await removeUploadTarget(target);
      } catch (err: unknown) {
        logger.error("Failed to remove attachment file after delete", { attachmentId }, err as Error);
      }
    }

    logger.info("Deleted attachment", {
      attachmentId,
      userId,
    });
  }

  private formatAttachment(
    attachment: typeof transactionAttachments.$inferSelect
  ): AttachmentData {
    return {
      id: attachment.id,
      transactionId: attachment.transactionId,
      filename: attachment.filename,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/transactions/${attachment.transactionId}/attachments/${attachment.id}/download`,
      createdAt: attachment.createdAt,
    };
  }
}

export const attachmentService = new AttachmentService();
