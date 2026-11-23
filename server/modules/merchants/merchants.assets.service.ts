/**
 * Merchants Module - Logo and alias writes
 *
 * Every write locks the household's merchant row, runs in one transaction and
 * writes its audit row through the same transaction (Rule 9 / Rule 10).
 *
 * Logo files: the new PNG is stored (ObjectStore + manifest, OPS-001) before the transaction and removed again
 * if the transaction fails (nothing can reference it yet). A committed logo
 * file is never unlinked here: a merge or edit can copy its URL onto another
 * merchant at any moment, so a replace or remove only changes this merchant's
 * logoUrl. The file and its merchant_logo_uploads row stay, so account
 * erasure still finds it; the orphan sweep (merchants.logo-sweep) retires a
 * file once no merchant references it.
 *
 * @module modules/merchants/assets.service
 */

import { randomUUID } from "crypto";
import * as path from "path";
import { and, eq } from "drizzle-orm";
import {
  merchantAliases,
  merchantLogoUploads,
  merchants,
} from "@shared/schema";
import { db } from "../../db";
import { NotFoundError, ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { discardUnlessCommitted, putUploadObject } from "../../core/storage/upload-objects";
import type { PreparedLogo } from "./merchants.logo-image";
import { assertMerchantNameFree, lockMerchantNames } from "./merchants.name-guard";
import { LOGO_UPLOAD_DIR, logoUrlFor, resolveHouseholdLogoPath } from "./merchants.logo-paths";

type Merchant = typeof merchants.$inferSelect;
type MerchantAlias = typeof merchantAliases.$inferSelect;

const ORIGINAL_FILENAME_MAX = 255;

export interface WriteActor {
  householdId: string;
  userId: string;
  ipAddress?: string;
}

async function lockOwnedMerchant(
  tx: TransactionType,
  merchantId: string,
  householdId: string,
): Promise<Merchant> {
  const [merchant] = await tx
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.householdId, householdId)))
    .for("update")
    .limit(1);
  if (!merchant) {
    throw new NotFoundError("Merchant");
  }
  return merchant;
}


async function setMerchantLogoUrl(
  tx: TransactionType,
  merchantId: string,
  householdId: string,
  logoUrl: string | null,
): Promise<Merchant> {
  const [updated] = await tx
    .update(merchants)
    .set({ logoUrl, updatedAt: new Date() })
    .where(and(eq(merchants.id, merchantId), eq(merchants.householdId, householdId)))
    .returning();
  return updated;
}

export const merchantAssetsService = {
  /** Non-locking ownership check, so a foreign id 404s before any image work. */
  async assertOwnedMerchant(merchantId: string, householdId: string): Promise<void> {
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.id, merchantId), eq(merchants.householdId, householdId)))
      .limit(1);
    if (!merchant) {
      throw new NotFoundError("Merchant");
    }
  },

  async setLogo(
    merchantId: string,
    actor: WriteActor,
    logo: PreparedLogo,
    originalFilename: string,
  ): Promise<{ merchant: Merchant; logoUrl: string }> {
    const storedFilename = `${randomUUID()}${logo.extension}`;
    const directory = path.join("uploads", LOGO_UPLOAD_DIR, actor.householdId);
    const filePath = path.join(directory, storedFilename);
    const resolvedPath = resolveHouseholdLogoPath(filePath, actor.householdId);
    if (!resolvedPath) {
      throw new ValidationError("Invalid file path");
    }
    const logoUrl = logoUrlFor(filePath);

    await putUploadObject({ stored: filePath, householdId: actor.householdId, purpose: "merchant-logo",
      bytes: logo.buffer, mediaType: "image/png", userId: actor.userId });

    try {
      const merchant = await withTransaction(async (tx) => {
        const current = await lockOwnedMerchant(tx, merchantId, actor.householdId);
        const [upload] = await tx
          .insert(merchantLogoUploads)
          .values({
            merchantId,
            originalFilename: originalFilename.slice(0, ORIGINAL_FILENAME_MAX),
            storedFilename,
            filePath,
            fileSize: logo.buffer.length,
            mimeType: "image/png",
            uploadedBy: actor.userId,
          })
          .returning();
        const updated = await setMerchantLogoUrl(tx, merchantId, actor.householdId, logoUrl);
        await businessAuditService.logUpdate({
          tx,
          householdId: actor.householdId,
          userId: actor.userId,
          entityType: "merchant",
          entityId: merchantId,
          oldValue: { logoUrl: current.logoUrl },
          newValue: { logoUrl },
          ipAddress: actor.ipAddress,
          metadata: {
            operation: "logo_upload",
            uploadId: upload.id,
            sourceMimeType: logo.sourceMimeType,
            storedMimeType: "image/png",
            fileSize: logo.buffer.length,
          },
        });
        return updated;
      });
      return { merchant, logoUrl };
    } catch (err) {
      // The new logo goes only if the write certainly rolled back (never throws).
      await discardUnlessCommitted(filePath, "merchant-logo", err);
      throw err;
    }
  },

  /** Clears this merchant's logo; the file stays (see the module comment). */
  async removeLogo(merchantId: string, actor: WriteActor): Promise<Merchant> {
    return withTransaction(async (tx) => {
      const merchant = await lockOwnedMerchant(tx, merchantId, actor.householdId);
      const updated = await setMerchantLogoUrl(tx, merchantId, actor.householdId, null);
      await businessAuditService.logUpdate({
        tx,
        householdId: actor.householdId,
        userId: actor.userId,
        entityType: "merchant",
        entityId: merchantId,
        oldValue: { logoUrl: merchant.logoUrl },
        newValue: { logoUrl: null },
        ipAddress: actor.ipAddress,
        metadata: { operation: "logo_remove" },
      });
      return updated;
    });
  },


  /**
   * A new alias may not repeat, case-insensitively, any alias or merchant name
   * in the household: merchant matching resolves a name through either, so a
   * duplicate would make matching pick an arbitrary merchant. Merchant create
   * and rename take the same lock and check (merchants.name-guard).
   */
  async addAlias(
    merchantId: string,
    actor: WriteActor,
    aliasName: string,
  ): Promise<MerchantAlias> {
    return withTransaction(async (tx) => {
      await lockMerchantNames(tx, actor.householdId);
      await lockOwnedMerchant(tx, merchantId, actor.householdId);
      await assertMerchantNameFree(tx, actor.householdId, aliasName);

      const [alias] = await tx
        .insert(merchantAliases)
        .values({ merchantId, aliasName })
        .returning();
      await businessAuditService.logCreate({
        tx,
        householdId: actor.householdId,
        userId: actor.userId,
        entityType: "merchant_alias",
        entityId: alias.id,
        newValue: { merchantId, aliasName },
        ipAddress: actor.ipAddress,
      });
      return alias;
    });
  },

  async removeAlias(
    merchantId: string,
    aliasId: string,
    actor: WriteActor,
  ): Promise<void> {
    await withTransaction(async (tx) => {
      await lockOwnedMerchant(tx, merchantId, actor.householdId);
      const [removed] = await tx
        .delete(merchantAliases)
        .where(and(eq(merchantAliases.id, aliasId), eq(merchantAliases.merchantId, merchantId)))
        .returning();
      if (!removed) {
        throw new NotFoundError("Merchant alias");
      }
      await businessAuditService.logDelete({
        tx,
        householdId: actor.householdId,
        userId: actor.userId,
        entityType: "merchant_alias",
        entityId: removed.id,
        oldValue: { merchantId, aliasName: removed.aliasName },
        ipAddress: actor.ipAddress,
      });
    });
  },
};
