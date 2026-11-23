import { Router } from "express";
import { settingsController } from "./settings.controller";
import { userPreferencesController } from "./settings.user-preferences.controller";
import { privacyExportController } from "./settings.privacy-export.controller";
import { strictLimiter } from "../../middleware/rateLimit";
import { requireStepUp } from "../../middleware/requireStepUp";

// Mounted by settings.routes.ts after requireAuth.
const router = Router();

// =========================================================================
// Display Settings (user-level, no household required)
// =========================================================================
router.get("/display", settingsController.getDisplaySettings);
router.put("/display", settingsController.updateDisplaySettings);

// Personal settings use only the signed session identity, including without a household.
router.get("/user-preferences", userPreferencesController.get);
router.put("/user-preferences", userPreferencesController.update);

// =========================================================================
// Notification Preferences (user-level)
// =========================================================================
router.get("/notifications", settingsController.getNotificationPreferences);
router.put("/notifications", settingsController.updateNotificationPreferences);

// =========================================================================
// Personal-data export (R07.1, user-level; only the requester's own exports)
// =========================================================================
router.post("/privacy/export", strictLimiter, requireStepUp("SETTINGS"), privacyExportController.create);
router.get("/privacy/exports", privacyExportController.list);
router.get("/privacy/exports/:id/download", privacyExportController.download);

export default router;
