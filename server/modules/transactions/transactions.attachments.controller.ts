/**
 * Transaction Attachments Controller
 *
 * Handles attachment operations for transactions.
 * Delegates to: attachmentService
 *
 * @module modules/transactions/transactions.attachments.controller
 */

import { Request, Response } from "express";
import * as fs from "fs/promises";
import { attachmentService } from "../../services/AttachmentService";
import { readUploadObject } from "../../core/storage/upload-objects";
import { sendUploadContent } from "../../core/storage/upload-response";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";

async function cleanupTempUpload(file: Express.Multer.File): Promise<void> {
  try {
    await fs.unlink(file.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Failed to remove temporary transaction attachment upload", {
        path: file.path,
        error,
      });
    }
  }
}

/**
 * Upload attachment to a transaction
 * POST /api/transactions/:id/attachments
 */
export async function uploadAttachment(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId, role } = req.householdContext!;
  const { id } = req.params;

  if (!req.file) {
    throw new ValidationError("No file uploaded", []);
  }

  let attachment;
  try {
    attachment = await attachmentService.uploadAttachment(
      id,
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        filename: req.file.filename,
      },
      householdId,
      userId,
      role
    );
  } catch (error) {
    await cleanupTempUpload(req.file);
    throw error;
  }

  logger.request(req, "Uploaded attachment", { attachmentId: attachment.id });

  created(res, attachment);
}

/**
 * List attachments for a transaction
 * GET /api/transactions/:id/attachments
 */
export async function listAttachments(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const attachments = await attachmentService.getAttachments(id, householdId, userId);

  success(res, attachments);
}

/**
 * Download an attachment
 * GET /api/transactions/:id/attachments/:attachmentId/download
 */
export async function downloadAttachment(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { attachmentId } = req.params;

  const result = await attachmentService.getAttachment(
    attachmentId,
    householdId,
    userId
  );

  if (!result) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Attachment not found" },
    });
    return;
  }

  const content = await readUploadObject(result.filePath, householdId);
  if (!content) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Attachment file not found" },
    });
    return;
  }

  // Sanitize filename for Content-Disposition header (RFC 5987)
  const sanitizedFilename = result.attachment.originalFilename
    .replace(/[^\w\s.-]/g, "_")
    .replace(/\s+/g, "_");
  const encodedFilename = encodeURIComponent(
    result.attachment.originalFilename
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`
  );
  sendUploadContent(res, content, result.filePath, result.attachment.mimeType);
}

/**
 * Delete an attachment
 * DELETE /api/transactions/:id/attachments/:attachmentId
 */
export async function deleteAttachment(
  req: Request,
  res: Response
): Promise<void> {
  const { householdId, userId, role } = req.householdContext!;
  const { attachmentId } = req.params;

  await attachmentService.deleteAttachment(attachmentId, householdId, userId, role);

  logger.request(req, "Deleted attachment", { attachmentId });

  success(res, { message: "Attachment deleted successfully" });
}

export const transactionAttachmentsController = {
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
};
