/**
 * Rules Module - Routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { rulesController } from "./rules.controller";
import { generalLimiter, analyticsLimiter } from "../../middleware/rateLimit";

const router = Router();
router.use(generalLimiter);
router.use(householdGuard);

router.get("/", rulesController.list);
router.put("/reorder", requireRole("member"), rulesController.reorder);
router.post("/bulk-enable", requireRole("member"), rulesController.bulkEnable);
router.post("/bulk-disable", requireRole("member"), rulesController.bulkDisable);
// Use analyticsLimiter for preview - it's an expensive operation that queries transactions
router.post("/preview", requireRole("member"), analyticsLimiter, rulesController.preview);
router.post("/:id/dry-run", requireRole("member"), rulesController.dryRun);
router.get("/:id", rulesController.getById);
router.post("/", requireRole("member"), rulesController.create);
router.put("/:id", requireRole("member"), rulesController.update);
router.delete("/:id", requireRole("member"), rulesController.delete);

export default router;
