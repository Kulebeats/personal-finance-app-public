/**
 * Settings Module - Profile Picture Controller
 *
 * Upload and remove the user's profile picture. Split from
 * settings.controller.ts to respect the <500 LOC controller limit, and
 * modeled directly on settings.banner.controller.ts (the proven pattern for
 * this app's image uploads).
 *
 * Profile picture files are stored household-scoped
 * (uploads/profile-pictures/{householdId}/...) so the authenticated
 * /uploads handler (SEC-327) can ownership-check them, which is why these
 * routes require household context. The URL is persisted on
 * users.profilePictureUrl.
 *
 * R17 (dead-control cleanup): the client (ProfilePictureUpload.tsx) has
 * always called POST/DELETE /api/settings/profile/picture, but the server
 * returned a 501 stub — the upload/remove UI was fully built and wired to a
 * feature that could never work. This replaces the stub with a real,
 * audited implementation.
 *
 * @module modules/settings/settings.picture.controller
 */

import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { ValidationError, NotFoundError } from "../../core/errors";
import { success } from "../../core/http";
import {
  assertAllowedImageContent,
  sanitizeUploadExtension,
} from "../../core/uploads";
import { logger } from "../../utils/logger";

/** Matches the client-side size check in ProfilePictureUpload.tsx. */
const MAX_PICTURE_FILE_SIZE = 5 * 1024 * 1024;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const PICTURES_ROOT = path.resolve(process.cwd(), "uploads", "profile-pictures");

const pictureMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PICTURE_FILE_SIZE },
});

/**
 * Multer middleware for the "picture" field (matches the client's
 * `formData.append("picture", file)`) that maps upload errors (e.g. file too
 * large) to the V7 error envelope instead of an opaque 500.
 */
export function pictureUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  pictureMulter.single("picture")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(
        new ValidationError(
          err.code === "LIMIT_FILE_SIZE"
            ? "Profile picture must be less than 5MB"
            : `Upload failed: ${err.message}`,
        ),
      );
      return;
    }
    next(err);
  });
}

/**
 * Resolve a stored profilePictureUrl to its on-disk path, but only when it
 * points inside this household's profile-pictures directory (SEC-PATH-002).
 * Returns null for anything else so we never unlink outside
 * uploads/profile-pictures/{householdId}.
 *
 * Exported so the right-to-erasure flow (settings.account-deletion.files.ts)
 * can reuse the exact same containment/validation logic instead of
 * reimplementing it.
 */
export function resolveOwnedPicturePath(
  profilePictureUrl: string,
  householdId: string,
): string | null {
  const prefix = `/uploads/profile-pictures/${householdId}/`;
  if (!profilePictureUrl.startsWith(prefix)) {
    return null;
  }
  const filename = profilePictureUrl.slice(prefix.length);
  // Stored names are `${randomUUID()}${ext}`; reject anything else.
  if (!/^[0-9a-f-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return null;
  }
  const householdDir = path.resolve(PICTURES_ROOT, householdId);
  const resolved = path.resolve(householdDir, filename);
  if (!resolved.startsWith(householdDir + path.sep)) {
    return null;
  }
  return resolved;
}

/** Best-effort removal of a previously stored profile picture file. */
async function removePictureFile(
  profilePictureUrl: string,
  householdId: string,
): Promise<void> {
  const filePath = resolveOwnedPicturePath(profilePictureUrl, householdId);
  if (!filePath) {
    return;
  }
  try {
    await fs.unlink(filePath);
  } catch (error) {
    logger.warn("Failed to remove old profile picture file", {
      error: (error as Error).message,
    });
  }
}

/** Strip the password hash before returning a user row to the client. */
function toClientProfile(user: typeof users.$inferSelect) {
  const { passwordHash: _passwordHash, ...profile } = user;
  return profile;
}

export const settingsPictureController = {
  /**
   * POST /api/settings/profile/picture
   * multipart/form-data with field "picture".
   */
  async uploadProfilePicture(req: Request, res: Response, next: NextFunction) {
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
      const directory = path.join(PICTURES_ROOT, householdId);
      const filePath = path.join(directory, storedFilename);

      // SEC-PATH-002: Verify resolved path is within expected directory.
      // (There is no user input in the path now, but keep the containment
      // assertion as defense-in-depth.)
      if (!path.resolve(filePath).startsWith(PICTURES_ROOT + path.sep)) {
        throw new ValidationError("Invalid file path");
      }

      const pictureUrl = `/uploads/profile-pictures/${householdId}/${storedFilename}`;

      // Write the file first; if the transactional DB update fails we remove it.
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(filePath, file.buffer);

      // Rule 10: lock the user row FOR UPDATE so concurrent uploads/deletes
      // serialize — otherwise both read the same oldPictureUrl and the
      // loser's file is orphaned (or a racing delete clobbers a fresh
      // upload). The audit row is written inside the same tx (Rule 9) so the
      // write can never commit unlogged.
      let updatedUser: typeof users.$inferSelect;
      let oldPictureUrl: string | null;
      try {
        const result = await withTransaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .for("update")
            .limit(1);
          if (!locked) {
            throw new NotFoundError("User not found");
          }

          const [updated] = await tx
            .update(users)
            .set({ profilePictureUrl: pictureUrl, updatedAt: new Date() })
            .where(eq(users.id, userId))
            .returning();

          await businessAuditService.logUpdate({
            householdId,
            userId,
            entityType: "user",
            entityId: userId,
            oldValue: { profilePictureUrl: locked.profilePictureUrl ?? null },
            newValue: { profilePictureUrl: pictureUrl },
            metadata: {
              action: "profile_picture_upload",
              mimeType: file.mimetype,
              fileSize: file.size,
            },
            ipAddress: businessAuditService.getIpAddress(req),
            tx,
          });

          return {
            updated,
            oldPictureUrl: locked.profilePictureUrl ?? null,
          };
        });
        updatedUser = result.updated;
        oldPictureUrl = result.oldPictureUrl;
      } catch (error) {
        // DB update rolled back after the file write; don't leave the orphan.
        await removePictureFile(pictureUrl, householdId);
        throw error;
      }

      if (oldPictureUrl && oldPictureUrl !== pictureUrl) {
        await removePictureFile(oldPictureUrl, householdId);
      }

      logger.info("Profile picture updated", {
        userId: userId.substring(0, 8),
      });

      success(res, { profile: toClientProfile(updatedUser), pictureUrl }, 200, {
        message: "Profile picture uploaded successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/settings/profile/picture
   * Idempotent: succeeds (without an audit row) when no picture is set.
   */
  async deleteProfilePicture(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;

      // Rule 10: lock the user row FOR UPDATE, clear the column, and write
      // the audit row (Rule 9) in one tx; remove the file only after commit
      // so a rollback never orphans a still-referenced file.
      const result = await withTransaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .for("update")
          .limit(1);
        if (!locked) {
          throw new NotFoundError("User not found");
        }
        if (!locked.profilePictureUrl) {
          return { updated: locked, removedPictureUrl: null as string | null };
        }

        const [updated] = await tx
          .update(users)
          .set({ profilePictureUrl: null, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();

        await businessAuditService.logUpdate({
          householdId,
          userId,
          entityType: "user",
          entityId: userId,
          oldValue: { profilePictureUrl: locked.profilePictureUrl },
          newValue: { profilePictureUrl: null },
          metadata: { action: "profile_picture_delete" },
          ipAddress: businessAuditService.getIpAddress(req),
          tx,
        });

        return { updated, removedPictureUrl: locked.profilePictureUrl };
      });

      if (result.removedPictureUrl) {
        await removePictureFile(result.removedPictureUrl, householdId);
        logger.info("Profile picture removed", {
          userId: userId.substring(0, 8),
        });
      }

      success(res, { profile: toClientProfile(result.updated) }, 200, {
        message: "Profile picture removed",
      });
    } catch (error) {
      next(error);
    }
  },
};
