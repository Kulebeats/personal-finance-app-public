/**
 * Weekly Recap Module - Routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { householdGuard } from "../../middleware/householdGuard";
import { requireCapability } from "../../core/authz/requireCapability";
import { analyticsLimiter } from "../../middleware/rateLimit";
import { weeklyRecapController } from "./weekly-recap.controller";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  householdGuard,
  analyticsLimiter,
  weeklyRecapController.getRecap
);
// AH-09: ad hoc generation and feedback need financial.export (not view_only/professional).
const canExport = requireCapability("financial.export");
router.post("/feedback", householdGuard, canExport, weeklyRecapController.submitFeedback);

// History and generation
router.get("/history", householdGuard, analyticsLimiter, weeklyRecapController.getHistory);
router.post("/generate", householdGuard, canExport, analyticsLimiter, weeklyRecapController.generateRecap);

// Settings endpoints
router.get("/settings", weeklyRecapController.getSettings);
router.patch("/settings", weeklyRecapController.updateSettings);

export default router;
