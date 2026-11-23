/**
 * Merchants Module - Routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { analyticsLimiter, uploadLimiter } from "../../middleware/rateLimit";
import { merchantsController } from "./merchants.controller";
import { merchantActivityController } from "./merchants.activity.controller";
import {
  merchantAssetsController,
  merchantLogoUpload,
} from "./merchants.assets.controller";

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
router.post(
  "/:id/logo",
  uploadLimiter,
  requireRole("member"),
  merchantLogoUpload,
  merchantAssetsController.uploadLogo,
);
router.delete("/:id/logo", requireRole("member"), merchantAssetsController.deleteLogo);
router.post("/:id/aliases", requireRole("member"), merchantAssetsController.addAlias);
router.delete(
  "/:id/aliases/:aliasId",
  requireRole("member"),
  merchantAssetsController.deleteAlias,
);
router.get("/:id/analytics", analyticsLimiter, merchantActivityController.analytics);
router.get("/:id/transactions", analyticsLimiter, merchantActivityController.transactions);
router.get("/:id", merchantsController.getById);
router.post("/", requireRole("member"), merchantsController.create);
router.put("/:id", requireRole("member"), merchantsController.update);
router.delete("/:id", requireRole("member"), merchantsController.delete);

export default router;
