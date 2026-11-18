/**
 * Merchants Module - Routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { merchantsController } from "./merchants.controller";

// generalLimiter is applied globally to /api in server/routes.ts. Mounting it
// here too charged every merchant request twice against the same counter.
const router = Router();
router.use(householdGuard);

router.get("/", merchantsController.list);
router.get("/autocomplete", merchantsController.autocomplete);
router.get("/duplicates", merchantsController.duplicates);
router.get("/merge/history", merchantsController.mergeHistory);
router.post("/merge/:historyId/undo", requireRole("member"), merchantsController.undoMerge);
router.post("/seed", requireRole("member"), merchantsController.seedDefaults);
router.post("/merge", requireRole("member"), merchantsController.merge);
router.post("/:sourceId/merge", requireRole("member"), merchantsController.mergeBySource);
router.get("/:id", merchantsController.getById);
router.post("/", requireRole("member"), merchantsController.create);
router.put("/:id", requireRole("member"), merchantsController.update);
router.delete("/:id", requireRole("member"), merchantsController.delete);

export default router;
