/**
 * Settings Module - Account Deletion File Cleanup
 *
 * Right-to-erasure (settings.account-deletion.service.ts) deletes DATABASE
 * rows but a database transaction cannot also delete files from disk
 * atomically, so file cleanup is split into two phases that the caller must
 * run in order:
 *
 *   1. `collectHouseholdUploadPaths` / `collectUserUploadPaths` — read the
 *      on-disk path columns from the still-live rows INSIDE the erasure
 *      transaction, BEFORE those rows (or the user row's bannerUrl) are
 *      deleted/scrubbed. This is the only moment the paths are still known.
 *   2. `deleteErasedFiles` — after the transaction has durably committed,
 *      unlink the collected paths. Filesystem state can't roll back with the
 *      transaction, so this must never run before commit, and a failure here
 *      must never be surfaced as an erasure failure (the legally significant
 *      part, the DB erasure, already succeeded).
 *
 * Upload categories covered (household-scoped, deleted only when this user is
 * the last member out and the household's shared data is hard-deleted):
 *   - goal_image_uploads.file_path
 *   - merchant_logo_uploads.file_path (via merchants -> household)
 *   - transaction_attachments.storage_path / thumbnail_path (via
 *     transactions -> household)
 *   - pending_receipts.storage_path / thumbnail_path
 *
 * Upload categories covered (user-scoped, always cleaned up for the erased
 * user regardless of household outcome):
 *   - users.banner_url
 *   - users.profile_picture_url (R17 implemented the upload; same
 *     household-scoped convention as the banner)
 *
 * @module modules/settings/account-deletion-files
 */

import * as fs from "fs/promises";
import * as path from "path";
import { eq, inArray } from "drizzle-orm";
import {
  goalImageUploads,
  merchantLogoUploads,
  merchants,
  transactionAttachments,
  transactions,
  pendingReceipts,
  users,
} from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import { resolveOwnedBannerPath } from "./settings.banner.controller";
import { resolveOwnedPicturePath } from "./settings.picture.controller";

/** Absolute root of the uploads directory (matches every upload writer). */
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Resolve a path stored in the database to an absolute on-disk path, and
 * verify the result stays inside UPLOADS_ROOT before returning it.
 *
 * Different upload writers persist different path shapes (some store a path
 * relative to `process.cwd()`, `AttachmentService` stores an absolute path) —
 * this normalizes both. Returns null for anything that would resolve outside
 * the uploads root, so a corrupt or unexpected DB value can never cause an
 * unlink outside `uploads/`.
 */
function resolveStoredUploadPath(storedPath: string): string | null {
  const resolved = path.isAbsolute(storedPath)
    ? path.resolve(storedPath)
    : path.resolve(process.cwd(), storedPath);
  const rootWithSep = UPLOADS_ROOT + path.sep;
  if (resolved !== UPLOADS_ROOT && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

/**
 * Collect every on-disk upload path owned by this household's shared,
 * household-scoped financial data. MUST be called inside the erasure
 * transaction, BEFORE `deleteHouseholdFinancialData` removes the rows that
 * carry these paths — those rows are the only record of where the files
 * live. Scoped strictly to `householdId`, so a household never has another
 * household's files collected.
 */
export async function collectHouseholdUploadPaths(
  tx: TransactionType,
  householdId: string,
): Promise<string[]> {
  const paths: string[] = [];

  const goalImages = await tx
    .select({ filePath: goalImageUploads.filePath })
    .from(goalImageUploads)
    .where(eq(goalImageUploads.householdId, householdId));
  for (const row of goalImages) {
    const resolved = resolveStoredUploadPath(row.filePath);
    if (resolved) paths.push(resolved);
  }

  const householdMerchantIds = tx
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.householdId, householdId));
  const merchantLogos = await tx
    .select({ filePath: merchantLogoUploads.filePath })
    .from(merchantLogoUploads)
    .where(inArray(merchantLogoUploads.merchantId, householdMerchantIds));
  for (const row of merchantLogos) {
    const resolved = resolveStoredUploadPath(row.filePath);
    if (resolved) paths.push(resolved);
  }

  const householdTransactionIds = tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, householdId));
  const attachments = await tx
    .select({
      storagePath: transactionAttachments.storagePath,
      thumbnailPath: transactionAttachments.thumbnailPath,
    })
    .from(transactionAttachments)
    .where(
      inArray(transactionAttachments.transactionId, householdTransactionIds),
    );
  for (const row of attachments) {
    const resolved = resolveStoredUploadPath(row.storagePath);
    if (resolved) paths.push(resolved);
    if (row.thumbnailPath) {
      const resolvedThumb = resolveStoredUploadPath(row.thumbnailPath);
      if (resolvedThumb) paths.push(resolvedThumb);
    }
  }

  const receipts = await tx
    .select({
      storagePath: pendingReceipts.storagePath,
      thumbnailPath: pendingReceipts.thumbnailPath,
    })
    .from(pendingReceipts)
    .where(eq(pendingReceipts.householdId, householdId));
  for (const row of receipts) {
    const resolved = resolveStoredUploadPath(row.storagePath);
    if (resolved) paths.push(resolved);
    if (row.thumbnailPath) {
      const resolvedThumb = resolveStoredUploadPath(row.thumbnailPath);
      if (resolvedThumb) paths.push(resolvedThumb);
    }
  }

  return paths;
}

/**
 * Collect on-disk upload paths owned by the specific user being erased
 * (as opposed to the household's jointly-owned uploads). MUST be called
 * inside the erasure transaction, BEFORE `anonymiseUser` clears
 * `users.banner_url` / `users.profile_picture_url`. Reuses each upload
 * controller's own containment check (`resolveOwnedBannerPath` /
 * `resolveOwnedPicturePath`) so erasure can never unlink outside this exact
 * household's banners / profile-pictures directory.
 */
export async function collectUserUploadPaths(
  tx: TransactionType,
  userId: string,
  householdId: string,
): Promise<string[]> {
  const paths: string[] = [];

  const [user] = await tx
    .select({
      bannerUrl: users.bannerUrl,
      profilePictureUrl: users.profilePictureUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.bannerUrl) {
    const resolved = resolveOwnedBannerPath(user.bannerUrl, householdId);
    if (resolved) paths.push(resolved);
  }

  if (user?.profilePictureUrl) {
    const resolved = resolveOwnedPicturePath(
      user.profilePictureUrl,
      householdId,
    );
    if (resolved) paths.push(resolved);
  }

  return paths;
}

/**
 * Best-effort removal of collected files from disk. Callers MUST invoke this
 * only after the erasure transaction has committed — filesystem operations
 * cannot share atomicity with the database transaction, so this deliberately
 * runs as a separate, later step.
 *
 * A missing file (ENOENT) is not an error; it just means the file was
 * already gone. Any other failure is logged and swallowed: a stray on-disk
 * file must never turn an already-committed, legally significant erasure
 * into a user-facing failure.
 */
export async function deleteErasedFiles(
  paths: readonly string[],
): Promise<void> {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          return;
        }
        logger.warn("Failed to remove file during account erasure", {
          error: err.message,
        });
      }
    }),
  );
}
