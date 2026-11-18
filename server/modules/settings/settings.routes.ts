/**
 * Settings Module - Routes
 *
 * Express router for user and household settings.
 *
 * @module modules/settings/routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { householdGuard } from "../../middleware/householdGuard";
import { settingsController } from "./settings.controller";
import {
  settingsBannerController,
  bannerUploadMiddleware,
} from "./settings.banner.controller";
import {
  settingsPictureController,
  pictureUploadMiddleware,
} from "./settings.picture.controller";
import reportWidgetsRoutes from "../../routes/settings.report-widgets";
import { generalLimiter, uploadLimiter } from "../../middleware/rateLimit";
import { requireStepUp } from "../../middleware/requireStepUp";

const router = Router();

// Apply rate limiting to all settings routes
router.use(generalLimiter);

// All settings require authentication
router.use(requireAuth);

// Mount report widget preferences routes
router.use(reportWidgetsRoutes);

// =========================================================================
// Profile (user-level, no household required)
// =========================================================================
router.get("/profile", settingsController.getProfile);
router.put("/profile", settingsController.updateProfile);

// Profile picture: householdGuard because files are stored household-scoped
// (uploads/profile-pictures/{householdId}/...), mirroring the banner route below.
router.post(
  "/profile/picture",
  uploadLimiter,
  householdGuard,
  pictureUploadMiddleware,
  settingsPictureController.uploadProfilePicture,
);
router.delete(
  "/profile/picture",
  householdGuard,
  settingsPictureController.deleteProfilePicture,
);

// Banner: householdGuard because files are stored household-scoped
// (uploads/banners/{householdId}/...) for the /uploads ownership check.
router.post(
  "/profile/banner",
  uploadLimiter,
  householdGuard,
  bannerUploadMiddleware,
  settingsBannerController.uploadBanner,
);
router.delete(
  "/profile/banner",
  householdGuard,
  settingsBannerController.deleteBanner,
);

// =========================================================================
// Display Settings (user-level, no household required)
// =========================================================================
router.get("/display", settingsController.getDisplaySettings);
router.put("/display", settingsController.updateDisplaySettings);

// =========================================================================
// Password & Sessions
// =========================================================================
// NOTE: Password change and session management are owned by the security
// router (`/api/settings/security/*` in server/routes/security*.ts), which is
// where the live client calls and where step-up gating + DPA audit logging
// live. The previously-duplicated `/password` and `/sessions/*` routes here
// had no client caller and were removed during the SCP-320 consolidation.

// =========================================================================
// Account Management
// =========================================================================
router.post(
  "/account/delete",
  requireStepUp("DESTRUCTIVE"),
  settingsController.deleteAccount,
);
router.post(
  "/account/export",
  requireStepUp("SETTINGS"),
  settingsController.exportData,
);

// =========================================================================
// Notification Preferences (user-level)
// =========================================================================
router.get("/notifications", settingsController.getNotificationPreferences);
router.put("/notifications", settingsController.updateNotificationPreferences);

// =========================================================================
// Household Preferences (require household context)
// =========================================================================
router.get("/preferences", householdGuard, settingsController.getPreferences);
router.put(
  "/preferences",
  householdGuard,
  settingsController.updatePreferences,
);

export default router;
