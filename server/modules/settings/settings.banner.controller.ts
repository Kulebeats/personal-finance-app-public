/**
 * Settings Module - Profile Banner Controller
 *
 * Upload and remove the user's profile banner (cover photo). Split from
 * settings.controller.ts to respect the <500 LOC controller limit.
 *
 * Banner files are stored household-scoped (uploads/banners/{householdId}/...)
 * so the authenticated /uploads handler (SEC-327) can ownership-check them,
 * which is why these routes require household context. The URL is persisted on
 * users.bannerUrl.
 *
 * @module modules/settings/settings.banner.controller
 */

import { randomUUID } from "crypto";
import * as path from "path";
import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { lockLiveMembership } from "./settings.membership-lock";
import { ValidationError, NotFoundError } from "../../core/errors";
import { success } from "../../core/http";
import {
  assertAllowedImageContent,
  sanitizeUploadExtension,
} from "../../core/uploads";
import { logger } from "../../utils/logger";
import { discardUnlessCommitted, putUploadObject, removeUploadObject } from "../../core/storage/upload-objects";

/** Matches the client-side size check in BannerUpload.tsx. */
const MAX_BANNER_FILE_SIZE = 5 * 1024 * 1024;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const BANNERS_ROOT = path.resolve(process.cwd(), "uploads", "banners");

const bannerMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BANNER_FILE_SIZE },
});

/**
 * Multer middleware for the "banner" field that maps upload errors (e.g. file
 * too large) to the V7 error envelope instead of an opaque 500.
 */
export function bannerUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  bannerMulter.single("banner")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(
        new ValidationError(
          err.code === "LIMIT_FILE_SIZE"
            ? "Banner image must be less than 5MB"
            : `Upload failed: ${err.message}`,
        ),
      );
      return;
    }
    next(err);
  });
}

/**
 * Resolve a stored bannerUrl to its on-disk path, but only when it points
 * inside this household's banners directory (SEC-PATH-002). Returns null for
 * anything else so we never unlink outside uploads/banners/{householdId}.
 *
 * Exported so the right-to-erasure flow (settings.account-deletion.files.ts)
 * can reuse the exact same containment/validation logic instead of
 * reimplementing it.
 */
export function resolveOwnedBannerPath(
  bannerUrl: string,
  householdId: string,
): string | null {
  const prefix = `/uploads/banners/${householdId}/`;
  if (!bannerUrl.startsWith(prefix)) {
    return null;
  }
  const filename = bannerUrl.slice(prefix.length);
  // Stored names are `${randomUUID()}${ext}`; reject anything else.
  if (!/^[0-9a-f-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return null;
  }
  const householdDir = path.resolve(BANNERS_ROOT, householdId);
  const resolved = path.resolve(householdDir, filename);
  if (!resolved.startsWith(householdDir + path.sep)) {
    return null;
  }
  return resolved;
}

/** Best-effort removal of a previously stored banner file. */
async function removeBannerFile(
  bannerUrl: string,
  householdId: string,
): Promise<void> {
  if (!resolveOwnedBannerPath(bannerUrl, householdId)) {
    return;
  }
  try {
    await removeUploadObject(bannerUrl);
  } catch (error) {
    logger.warn("Failed to remove old banner file", {
      error: (error as Error).message,
    });
  }
}

export const settingsBannerController = {
  /**
   * POST /api/settings/profile/banner
   * multipart/form-data with field "banner".
   */
  async uploadBanner(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const file = (req as Request & { file?: Express.Multer.File }).file;

      if (!file) {
        throw new ValidationError("No file uploaded");
      }

      const ext = sanitizeUploadExtension(file.mimetype, MIME_EXTENSION_MAP);
      await assertAllowedImageContent(
        file.buffer,
        Object.keys(MIME_EXTENSION_MAP),
      );

      const storedFilename = `${randomUUID()}${ext}`;
      const bannerUrl = `/uploads/banners/${householdId}/${storedFilename}`;

      // Store the bytes (OPS-001); if the transactional DB update fails we remove them.
      await putUploadObject({ stored: bannerUrl, householdId, purpose: "banner", bytes: file.buffer, mediaType: file.mimetype, userId });

      // Rule 10: lock the user row FOR UPDATE so concurrent uploads/deletes
      // serialize — otherwise both read the same oldBannerUrl and the loser's
      // file is orphaned (or a racing delete clobbers a fresh upload). The
      // audit row is written inside the same tx (Rule 9) so the write can never
      // commit unlogged.
      let oldBannerUrl: string | null;
      try {
        oldBannerUrl = await withTransaction(async (tx) => {
          // Live membership, under the lock erasure takes first (members, then the user
          // row): an erasure that removed this member commits before the URL is published,
          // and this upload then rolls back, so it never names bytes erasure deleted.
          await lockLiveMembership(tx, householdId, userId);
          const [locked] = await tx
            .select({ bannerUrl: users.bannerUrl })
            .from(users)
            .where(eq(users.id, userId))
            .for("update")
            .limit(1);
          if (!locked) {
            throw new NotFoundError("User not found");
          }

          await tx
            .update(users)
            .set({ bannerUrl, updatedAt: new Date() })
            .where(eq(users.id, userId));

          await businessAuditService.logUpdate({
            householdId,
            userId,
            entityType: "user",
            entityId: userId,
            oldValue: { bannerUrl: locked.bannerUrl ?? null },
            newValue: { bannerUrl },
            metadata: {
              action: "banner_upload",
              mimeType: file.mimetype,
              fileSize: file.size,
            },
            ipAddress: businessAuditService.getIpAddress(req),
            tx,
          });

          return locked.bannerUrl ?? null;
        });
      } catch (error) {
        // The new file goes only if the update certainly rolled back.
        await discardUnlessCommitted(bannerUrl, "banner", error);
        throw error;
      }

      if (oldBannerUrl && oldBannerUrl !== bannerUrl) {
        await removeBannerFile(oldBannerUrl, householdId);
      }

      logger.info("Profile banner updated", {
        userId: userId.substring(0, 8),
      });

      success(res, { bannerUrl }, 200, {
        message: "Banner updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/settings/profile/banner
   * Idempotent: succeeds (without an audit row) when no banner is set.
   */
  async deleteBanner(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;

      // Rule 10: lock the user row FOR UPDATE, clear the column, and write the
      // audit row (Rule 9) in one tx; remove the file only after commit so a
      // rollback never orphans a still-referenced file.
      const removedBannerUrl = await withTransaction(async (tx) => {
        const [locked] = await tx
          .select({ bannerUrl: users.bannerUrl })
          .from(users)
          .where(eq(users.id, userId))
          .for("update")
          .limit(1);
        if (!locked) {
          throw new NotFoundError("User not found");
        }
        if (!locked.bannerUrl) {
          return null;
        }

        await tx
          .update(users)
          .set({ bannerUrl: null, updatedAt: new Date() })
          .where(eq(users.id, userId));

        await businessAuditService.logUpdate({
          householdId,
          userId,
          entityType: "user",
          entityId: userId,
          oldValue: { bannerUrl: locked.bannerUrl },
          newValue: { bannerUrl: null },
          metadata: { action: "banner_delete" },
          ipAddress: businessAuditService.getIpAddress(req),
          tx,
        });

        return locked.bannerUrl;
      });

      if (removedBannerUrl) {
        await removeBannerFile(removedBannerUrl, householdId);
        logger.info("Profile banner removed", {
          userId: userId.substring(0, 8),
        });
      }

      success(res, { bannerUrl: null }, 200, {
        message: "Banner removed",
      });
    } catch (error) {
      next(error);
    }
  },
};
