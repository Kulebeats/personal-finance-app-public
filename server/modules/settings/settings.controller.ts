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
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  updateProfileSchema,
  changePasswordSchema,
  updatePreferencesSchema,
  updateNotificationPreferencesSchema,
  updateDisplaySettingsSchema,
} from "./settings.validation";
import { settingsAccountController } from "./settings.account.controller";
import { toOwnProfileDto } from "../auth/auth.dto";
import { profileFieldErrors } from "./settings.profile.helpers";
import { saveOwnProfile } from "./settings.profile.service";
import { changeOwnPassword } from "./settings.password.service";
import { updateHouseholdPolicy } from "../../core/authz/household-policy";
import {
  saveDisplaySettings,
  saveNotificationPreferences,
  type PersonalSettingsContext,
} from "./settings.preferences.service";

function personalSettingsContext(req: Request): PersonalSettingsContext {
  return {
    userId: req.session.userId!,
    householdId: req.householdContext?.householdId ?? null,
    ipAddress: businessAuditService.getIpAddress(req),
  };
}

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
      const patches = preferences.map(pref => {
        const { thresholdAmount, ...flags } = pref;
        return {
          ...flags,
          ...(thresholdAmount !== undefined ? {
            thresholdAmount: thresholdAmount === null ? null : String(thresholdAmount),
          } : {}),
        };
      });
      // NEW-26: the batch and its audit rows commit together (settings.preferences.service.ts).
      const writes = await saveNotificationPreferences(personalSettingsContext(req), patches, {
        inAppEnabled: true, emailEnabled: false, pushEnabled: false,
      });

      return success(res, { preferences: writes.map(write => write.updated) }, 200, {
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

      success(res, { profile: toOwnProfileDto(user) });
    } catch (error) {
      next(error);
    }
  },

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = updateProfileSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid profile data",
          profileFieldErrors(parseResult.error.issues),
        );
      }

      const userId = req.session.userId!;
      // AH-07: the save and its audit row commit together (settings.profile.service.ts).
      const { user: updatedUser, changedFields } = await saveOwnProfile({
        userId,
        householdId: req.householdContext?.householdId ?? null,
        ipAddress: businessAuditService.getIpAddress(req),
      }, parseResult.data);
      logger.info("Profile updated", {
        userId: userId.substring(0, 8),
        changedFields,
      });

      success(res, { profile: toOwnProfileDto(updatedUser) }, 200, {
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
      const settings = await userRepository.createDisplaySettings({
        userId: req.session.userId!,
      });

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

      // NEW-26: the save and its audit row commit together (settings.preferences.service.ts).
      const updatedSettings = await saveDisplaySettings(personalSettingsContext(req), parseResult.data);

      logger.info("Display settings updated", {
        userId: req.session.userId?.substring(0, 8),
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

      await changeOwnPassword(req, parseResult.data.currentPassword, parseResult.data.newPassword);

      logger.info("Password changed", {
        userId: req.session.userId?.substring(0, 8),
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
        preferences = (await householdRepository.findPreferences(householdId)) ?? null;
      }

      return success(res, { preferences });
    } catch (error) {
      next(error);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = updatePreferencesSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const updated = await updateHouseholdPolicy(
        req.householdContext!,
        parseResult.data,
        businessAuditService.getIpAddress(req),
      );

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
};
