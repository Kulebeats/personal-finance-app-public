import { Router } from "express";
import { householdGuard, requireAuth, requireRole } from "../../middleware/auth";
import { investmentOccurrencesController } from "./investments.occurrences.controller";

const router = Router();
router.use(requireAuth);
router.use(householdGuard);
// Mounted under /api/investments, so the global /api general quota already applies.
router.get("/calendar", investmentOccurrencesController.getCalendar);
router.put("/calendar", investmentOccurrencesController.setCalendar);
router.get("/recurring/:planId/occurrences", investmentOccurrencesController.list);
router.post("/recurring/:planId/occurrences/:scheduledDate/confirm",
  requireRole("member"), investmentOccurrencesController.confirm);

export default router;
