/**
 * Filter Presets Module - Routes
 *
 * API route definitions for filter preset endpoints.
 *
 * @module modules/filter-presets/filter-presets.routes
 */

import { Router } from "express";
import { filterPresetsController } from "./filter-presets.controller";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";

const router = Router();

// All routes require household context
router.use(householdGuard);

// CRUD routes
router.get("/", filterPresetsController.list);
router.get("/default/:context", filterPresetsController.getDefault);
router.get("/:id", filterPresetsController.get);
router.post("/", requireRole("member"), filterPresetsController.create);
router.patch("/:id", requireRole("member"), filterPresetsController.update);
router.delete("/:id", requireRole("member"), filterPresetsController.delete);

export default router;
