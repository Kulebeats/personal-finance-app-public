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
 *   2. After the transaction has durably committed, delete the collected
 *      files through their purge items (settings.account-deletion.purge.ts,
 *      A-34). Filesystem state can't roll back with the transaction, so this
 *      never runs before commit, and a failure here is never surfaced as an
 *      erasure failure (the legally significant part already succeeded).
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
 *   - any banner or profile-picture object the user stored that no users row
 *     names (for example after a crash before the users row was updated),
 *     found through storage_objects.created_by
 *
 * OPS-001: each collected path is resolved, inside the transaction, to its
 * ObjectStore key through the storage_objects manifest (a household delete
 * cascades the manifest rows, so the key is only known before commit). A path
 * with no manifest row is a legacy file on the old uploads/ disk. A household
 * delete also collects every manifest row of the household that no referencing
 * row named (for example an attachment whose storage delete failed after its
 * row was deleted), so no object outlives the cascade of its tracking row.
 *
 * @module modules/settings/account-deletion-files
 */

import { and, eq, inArray, ne, or } from "drizzle-orm";
import {
  storageObjects,
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
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  nameMatchesOwner, removeUploadTarget, resolveUploadTarget, uploadNameOf, UploadStorageError, type UploadObjectTarget, type UploadOwner,
} from "../../core/storage/upload-objects";
import { validateStorageKey, type StorageKey, type StoragePurpose } from "../../core/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { resolveOwnedBannerPath } from "./settings.banner.controller";
import { resolveOwnedPicturePath } from "./settings.picture.controller";

/**
 * Collects resolved files. A value outside the uploads root, outside its
 * owner's folder, or recorded in the manifest for another owner is never
 * collected, so a stale or edited path cannot delete another owner's file.
 */
async function collect(tx: TransactionType, targets: UploadObjectTarget[], stored: string | null | undefined, owner: UploadOwner): Promise<void> {
  if (!stored) return;
  const target = await resolveUploadTarget(stored, tx, owner);
  if (target) targets.push(target);
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
): Promise<UploadObjectTarget[]> {
  const paths: UploadObjectTarget[] = [];

  const goalImages = await tx
    .select({ filePath: goalImageUploads.filePath })
    .from(goalImageUploads)
    .where(eq(goalImageUploads.householdId, householdId));
  for (const row of goalImages) {
    await collect(tx, paths, row.filePath, { purpose: "goal-image", householdId });
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
    await collect(tx, paths, row.filePath, { purpose: "merchant-logo", householdId });
  }

  const householdTransactionIds = tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, householdId));
  const attachments = await tx
    .select({
      transactionId: transactionAttachments.transactionId,
      storagePath: transactionAttachments.storagePath,
      thumbnailPath: transactionAttachments.thumbnailPath,
    })
    .from(transactionAttachments)
    .where(
      inArray(transactionAttachments.transactionId, householdTransactionIds),
    );
  for (const row of attachments) {
    const owner = { purpose: "attachment", householdId, transactionId: row.transactionId } as const;
    await collect(tx, paths, row.storagePath, owner);
    await collect(tx, paths, row.thumbnailPath, owner);
  }

  const receipts = await tx
    .select({
      storagePath: pendingReceipts.storagePath,
      thumbnailPath: pendingReceipts.thumbnailPath,
    })
    .from(pendingReceipts)
    .where(eq(pendingReceipts.householdId, householdId));
  for (const row of receipts) {
    await collect(tx, paths, row.storagePath, { purpose: "receipt", householdId });
    await collect(tx, paths, row.thumbnailPath, { purpose: "receipt-thumbnail", householdId });
  }

  const collected = new Set(paths.map((target) => target.name));
  const manifest = await tx.select({ key: storageObjects.key, name: storageObjects.uploadName, purpose: storageObjects.purpose })
    .from(storageObjects).where(eq(storageObjects.householdId, householdId));
  for (const row of manifest) {
    if (collected.has(row.name)) continue;
    validateStorageKey(row.key);
    // The object is this household's (its manifest row says so), but the name
    // is unlinked on the legacy disk too: only when it lies in this household's
    // own folder. Otherwise just the object goes.
    const isOwnName = await manifestNameIsOwn(tx, row.name, row.purpose as StoragePurpose, householdId);
    if (!isOwnName) logger.warn("A manifest row names a file outside its household's folder; its legacy name is left alone", { objectKey: row.key, purpose: row.purpose });
    paths.push({ name: row.name, key: row.key as StorageKey, ...(isOwnName ? {} : { keepLegacy: true }) });
  }

  return paths;
}

/**
 * True when a manifest name, checked on its own, is a well-formed upload name
 * in this household's folder for its purpose; an attachment's folder must be a
 * transaction of this household.
 */
async function manifestNameIsOwn(tx: TransactionType, name: string, purpose: StoragePurpose, householdId: string): Promise<boolean> {
  if (uploadNameOf(`/uploads/${name}`) !== name) return false;
  if (purpose !== "attachment") return nameMatchesOwner(name, { purpose, householdId });
  const [folder, transactionId] = name.split("/");
  if (folder !== "transactions" || !UUID.test(transactionId)) return false;
  const [transaction] = await tx.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.id, transactionId.toLowerCase()), eq(transactions.householdId, householdId))).limit(1);
  return Boolean(transaction);
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
  householdId: string | null,
): Promise<UploadObjectTarget[]> {
  const paths: UploadObjectTarget[] = [];

  const [user] = await tx
    .select({
      bannerUrl: users.bannerUrl,
      profilePictureUrl: users.profilePictureUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A-20: a user with no household may still name a banner or picture in the
  // folder of a household they left (a legacy file has no manifest row to
  // find it by creator). That folder is the household checked against.
  const bannerUrl = user?.bannerUrl;
  const bannerHousehold = bannerUrl ? (householdId ?? await formerFolderOf(tx, userId, bannerUrl)) : null;
  if (bannerUrl && bannerHousehold && resolveOwnedBannerPath(bannerUrl, bannerHousehold)) {
    await collect(tx, paths, bannerUrl, { purpose: "banner", householdId: bannerHousehold });
  }

  const pictureUrl = user?.profilePictureUrl;
  const pictureHousehold = pictureUrl ? (householdId ?? await formerFolderOf(tx, userId, pictureUrl)) : null;
  if (pictureUrl && pictureHousehold && resolveOwnedPicturePath(pictureUrl, pictureHousehold)) {
    await collect(tx, paths, pictureUrl, { purpose: "profile-picture", householdId: pictureHousehold });
  }

  return [...paths, ...(await collectUnreferencedPersonalObjects(tx, userId, paths))];
}

const PERSONAL_FOLDER = /^\/uploads\/(?:banners|profile-pictures)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/**
 * The household folder a household-free user's banner or picture URL lies
 * in, or null. Null too when another users row names the same URL, so a
 * copied URL never deletes someone else's file.
 */
async function formerFolderOf(tx: TransactionType, userId: string, url: string): Promise<string | null> {
  const folder = PERSONAL_FOLDER.exec(url)?.[1] ?? null;
  if (!folder) return null;
  const [other] = await tx.select({ id: users.id }).from(users)
    .where(and(ne(users.id, userId), or(eq(users.bannerUrl, url), eq(users.profilePictureUrl, url)))).limit(1);
  return other ? null : folder.toLowerCase();
}

/** The personal upload kinds: a banner or picture belongs to the user who stored it, never jointly. */
const PERSONAL_PURPOSES = ["banner", "profile-picture"] as const;

/**
 * The erased user's banner and picture objects that no users row names, for
 * example one stored just before a crash, before `users.banner_url` was
 * updated. A co-member erasure keeps the household, so its cascade never
 * reaches these manifest rows. Jointly owned uploads (receipts, attachments,
 * goal images, logos) are left alone.
 */
async function collectUnreferencedPersonalObjects(
  tx: TransactionType,
  userId: string,
  collected: readonly UploadObjectTarget[],
): Promise<UploadObjectTarget[]> {
  const known = new Set(collected.map((target) => target.name));
  const owned = (await tx.select({ key: storageObjects.key, name: storageObjects.uploadName }).from(storageObjects)
    .where(and(eq(storageObjects.createdBy, userId), inArray(storageObjects.purpose, [...PERSONAL_PURPOSES]))))
    .filter((row) => !known.has(row.name));
  if (!owned.length) return [];
  const urls = owned.map((row) => `/uploads/${row.name}`);
  const referenced = await tx.select({ bannerUrl: users.bannerUrl, profilePictureUrl: users.profilePictureUrl }).from(users)
    .where(and(ne(users.id, userId), or(inArray(users.bannerUrl, urls), inArray(users.profilePictureUrl, urls))));
  const inUse = new Set(referenced.flatMap((row) => [row.bannerUrl, row.profilePictureUrl]));
  return owned.filter((row) => !inUse.has(`/uploads/${row.name}`)).map((row) => {
    validateStorageKey(row.key);
    return { name: row.name, key: row.key as StorageKey };
  });
}

/**
 * After commit: when files could not be deleted, write one audit row on the
 * erased account listing each one's opaque object key and logical name (never
 * file contents), so the orphans stay findable after the manifest rows are gone.
 * Never throws; a failed audit write is logged with the same identifiers.
 */
export async function recordErasedFileFailures(userId: string, failed: readonly UploadObjectTarget[]): Promise<void> {
  if (!failed.length) return;
  const details = {
    reason: "erasure_file_cleanup_failed", failed: failed.length,
    targets: failed.map((target) => ({ objectKey: target.key, uploadName: target.name })),
  };
  try {
    await businessAuditService.log({ householdId: null, userId, action: "DELETE", entityType: "user_account", entityId: userId, details });
  } catch (error) {
    logger.error("Could not audit erasure file-cleanup failures", { ...details, error: error instanceof Error ? error.message : String(error) });
  }
}
