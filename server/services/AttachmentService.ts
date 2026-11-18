import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { transactionAttachments, transactions } from "@shared/schema";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";
import { sanitizeUploadExtension } from "../core/uploads";

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "transactions");

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
  private async ensureUploadDir(transactionId: string): Promise<string> {
    const dir = path.join(UPLOADS_DIR, transactionId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Upload an attachment to a transaction
   */
  async uploadAttachment(
    transactionId: string,
    file: AttachmentUpload,
    householdId: string,
    userId: string
  ): Promise<AttachmentData> {
    // Verify transaction exists and belongs to household
    const [txn] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId)
        )
      )
      .limit(1);

    if (!txn) {
      throw new Error("Transaction not found or access denied");
    }

    const ext = sanitizeUploadExtension(
      file.mimetype,
      ATTACHMENT_EXTENSION_BY_MIME,
    );
    const storedFilename = `${randomUUID()}${ext}`;
    const uploadDir = await this.ensureUploadDir(transactionId);
    const storagePath = path.join(uploadDir, storedFilename);

    // Move file from temp location to permanent storage
    await fs.rename(file.path, storagePath);

    // Insert DB record
    const [attachment] = await db
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
    householdId: string
  ): Promise<AttachmentData[]> {
    // Verify transaction access
    const [txn] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId)
        )
      )
      .limit(1);

    if (!txn) {
      throw new Error("Transaction not found or access denied");
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
    householdId: string
  ): Promise<{ attachment: AttachmentData; filePath: string } | null> {
    const [attachment] = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, attachmentId))
      .limit(1);

    if (!attachment) {
      return null;
    }

    // Verify household access via transaction
    const [txn] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, attachment.transactionId),
          eq(transactions.householdId, householdId)
        )
      )
      .limit(1);

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
    userId: string
  ): Promise<void> {
    const result = await this.getAttachment(attachmentId, householdId);

    if (!result) {
      throw new Error("Attachment not found or access denied");
    }

    // Delete file from disk
    try {
      await fs.unlink(result.filePath);
    } catch (err: unknown) {
      // Ignore if file doesn't exist (already deleted)
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    // Delete DB record
    await db
      .delete(transactionAttachments)
      .where(eq(transactionAttachments.id, attachmentId));

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
