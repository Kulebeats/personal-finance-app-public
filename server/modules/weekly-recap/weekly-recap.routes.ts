/**
 * Weekly Recap Module - Routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { householdGuard } from "../../middleware/householdGuard";
import { analyticsLimiter, generalLimiter } from "../../middleware/rateLimit";
import { weeklyRecapController } from "./weekly-recap.controller";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  householdGuard,
  analyticsLimiter,
  weeklyRecapController.getRecap
);
router.post("/feedback", householdGuard, generalLimiter, weeklyRecapController.submitFeedback);

// History and generation
router.get("/history", householdGuard, analyticsLimiter, weeklyRecapController.getHistory);
router.post("/generate", householdGuard, analyticsLimiter, weeklyRecapController.generateRecap);

// Settings endpoints
router.get("/settings", generalLimiter, weeklyRecapController.getSettings);
router.patch("/settings", generalLimiter, weeklyRecapController.updateSettings);

export default router;
