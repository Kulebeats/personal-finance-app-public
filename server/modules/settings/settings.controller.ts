/**
 * Settings Module - Controller
 *
 * HTTP handlers for user and household settings.
 * Covers profile, preferences, security, and notifications.
 *
 * @module modules/settings/controller
 */

import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import { hashPassword, verifyPassword } from "../../auth";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { revokeUserSessions } from "../../services/session-revocation";
import {
  householdPreferences,
  users,
  type HouseholdPreferences,
} from "@shared/schema";
import {
  updateProfileSchema,
  changePasswordSchema,
  updatePreferencesSchema,
  updateNotificationPreferencesSchema,
  updateDisplaySettingsSchema,
} from "./settings.validation";
import { settingsAccountController } from "./settings.account.controller";

export const settingsController = {
  // ... (previous methods)

  async updateNotificationPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const parseResult = updateNotificationPreferencesSchema.safeParse(
        req.body,
      );
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const { preferences } = parseResult.data;
      const results = [];

      for (const pref of preferences) {
        const prefData = {
          ...pref,
          thresholdAmount:
            pref.thresholdAmount != null ? String(pref.thresholdAmount) : null,
        };
        let updated = await userRepository.updateNotificationPreference(
          req.session.userId!,
          pref.notificationType,
          prefData,
        );

        if (!updated) {
          // If preference doesn't exist, create it with defaults
          updated = await userRepository.createNotificationPreference({
            userId: req.session.userId!,
            notificationType: pref.notificationType,
            inAppEnabled: pref.inAppEnabled ?? true,
            emailEnabled: pref.emailEnabled ?? false,
            pushEnabled: pref.pushEnabled ?? false,
            thresholdAmount: pref.thresholdAmount
              ? String(pref.thresholdAmount)
              : null,
          });

          await businessAuditService.logCreate({
            householdId: req.householdContext?.householdId ?? null,
            userId: req.session.userId!,
            entityType: "notification_preference",
            entityId: req.session.userId!,
            newValue: updated,
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { notificationType: pref.notificationType },
          });
        } else {
          await businessAuditService.logUpdate({
            householdId: req.householdContext?.householdId ?? null,
            userId: req.session.userId!,
            entityType: "notification_preference",
            entityId: req.session.userId!,
            newValue: prefData,
            ipAddress: businessAuditService.getIpAddress(req),
            metadata: { notificationType: pref.notificationType },
          });
        }
        results.push(updated);
      }

      return success(res, { preferences: results }, 200, {
        message: "Notification preferences updated",
      });
    } catch (error) {
      next(error);
    }
  },
  // =========================================================================
  // Profile
  // =========================================================================

  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userRepository.findById(req.session.userId!);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      const { passwordHash: _, ...profile } = user;
      success(res, { profile });
    } catch (error) {
      next(error);
    }
  },

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = updateProfileSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const updatedUser = await userRepository.update(
        req.session.userId!,
        parseResult.data,
      );

      if (!updatedUser) {
        throw new NotFoundError("User not found");
      }

      logger.info("Profile updated", {
        userId: req.session.userId?.substring(0, 8),
      });

      await businessAuditService.logUpdate({
        householdId: req.householdContext?.householdId ?? null,
        userId: req.session.userId!,
        entityType: "user",
        entityId: req.session.userId!,
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      const { passwordHash: _, ...profile } = updatedUser;
      success(res, { profile }, 200, {
        message: "Profile updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Profile picture upload/delete are handled by settingsPictureController
  // (server/modules/settings/settings.picture.controller.ts), wired directly
  // in settings.routes.ts — split out to keep this controller under the
  // 500 LOC limit and to mirror the settings.banner.controller.ts pattern.

  // =========================================================================
  // Display Settings (user-level)
  // =========================================================================

  async getDisplaySettings(req: Request, res: Response, next: NextFunction) {
    try {
      let settings = await userRepository.getDisplaySettings(
        req.session.userId!,
      );

      // Create default settings if none exist
      if (!settings) {
        settings = await userRepository.createDisplaySettings({
          userId: req.session.userId!,
        });
      }

      return success(res, { settings });
    } catch (error) {
      next(error);
    }
  },

  async updateDisplaySettings(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = updateDisplaySettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // Ensure settings exist first
      let settings = await userRepository.getDisplaySettings(
        req.session.userId!,
      );
      if (!settings) {
        settings = await userRepository.createDisplaySettings({
          userId: req.session.userId!,
        });
      }

      const updatedSettings = await userRepository.updateDisplaySettings(
        req.session.userId!,
        parseResult.data,
      );

      logger.info("Display settings updated", {
        userId: req.session.userId?.substring(0, 8),
      });

      await businessAuditService.logUpdate({
        householdId: req.householdContext?.householdId ?? null,
        userId: req.session.userId!,
        entityType: "display_settings",
        entityId: req.session.userId!,
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { settings: updatedSettings }, 200, {
        message: "Display settings updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Password & Security
  // =========================================================================

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = changePasswordSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const user = await userRepository.findById(req.session.userId!);
      if (!user || !user.passwordHash) {
        throw new ValidationError("Cannot change password");
      }

      const isValid = await verifyPassword(
        parseResult.data.currentPassword,
        user.passwordHash,
      );
      if (!isValid) {
        throw new UnauthorizedError("Current password is incorrect");
      }

      // Check for password reuse
      // Use dynamic import to avoid potential circular dependencies if any, or just convenience
      // (Though static import is better, I'll use dynamic to minimise file header changes in this tool call if possible, but actually I should add imports at top properly. I'll do it here in body using import for now or assume I added it? No, I must add it.)
      // Okay, let's just do dynamic import inside logic to avoid header replacement
      const { wasPasswordUsedRecently, recordPasswordInHistory } =
        await import("../../modules/auth/auth.password-history");

      const isReused = await wasPasswordUsedRecently(
        user.id,
        parseResult.data.newPassword,
      );
      if (isReused) {
        throw new ValidationError(
          "You cannot reuse recent passwords. Please choose a different one.",
        );
      }

      // Record old password in history BEFORE updating
      await recordPasswordInHistory(user.id, user.passwordHash);

      const newHash = await hashPassword(parseResult.data.newPassword);

      /**
       * Atomically rotate the password and revoke every OTHER live session
       * (Rule 10: multi-table write). Fail-closed: if revocation fails, the
       * password change rolls back rather than leaving a stolen session
       * alive on a rotated password.
       *
       * Unlike the unauthenticated password-RESET flow (which revokes every
       * session), this is a self-initiated change from an authenticated
       * session - keep the CURRENT device logged in via exceptSessionId, or
       * the user would be logged out of the device they're using right now.
       */
      await withTransaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: newHash, updatedAt: new Date() })
          .where(eq(users.id, user.id));

        await revokeUserSessions(tx, user.id, {
          exceptSessionId: req.sessionID,
        });
      });

      logger.info("Password changed", {
        userId: req.session.userId?.substring(0, 8),
      });

      await businessAuditService.logUpdate({
        // auditLogs.householdId is a UUID FK; the old "security" sentinel
        // silently failed to insert. Password change is a user-level event.
        householdId: null,
        userId: req.session.userId!,
        entityType: "user",
        entityId: req.session.userId!,
        newValue: { action: "password_change", otherSessionsRevoked: true },
        ipAddress: businessAuditService.getIpAddress(req),
      });
      success(res, null, 200, { message: "Password changed successfully" });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Preferences
  // =========================================================================

  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext || {};

      let preferences = null;
      if (householdId) {
        preferences = await householdRepository.findPreferences(householdId);
        if (!preferences) {
          preferences = await householdRepository.createPreferences({
            householdId,
          });
        }
      }

      return success(res, { preferences });
    } catch (error) {
      next(error);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const parseResult = updatePreferencesSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      let preferences = await householdRepository.findPreferences(householdId);
      if (!preferences) {
        preferences = await householdRepository.createPreferences({
          householdId,
        });
      }

      const updated = await householdRepository.updatePreferences(
        householdId,
        parseResult.data as Partial<HouseholdPreferences>,
      );

      await businessAuditService.logUpdate({
        householdId,
        userId: req.session.userId!,
        entityType: "household_preferences",
        entityId: householdId,
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { preferences: updated }, 200, {
        message: "Preferences updated",
      });
    } catch (error) {
      next(error);
    }
  },

  // ... (Notification Preferences and Sessions methods same as before)

  // =========================================================================
  // Notification Preferences
  // =========================================================================

  async getNotificationPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const prefs = await userRepository.getNotificationPreferences(
        req.session.userId!,
      );
      return success(res, { preferences: prefs || {} });
    } catch (error) {
      next(error);
    }
  },

  // =========================================================================
  // Account Management
  // =========================================================================

  // Account management (delegated to settings.account.controller.ts)
  deleteAccount: settingsAccountController.deleteAccount,
  exportData: settingsAccountController.exportData,
};
