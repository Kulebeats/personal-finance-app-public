/**
 * Categories Module - Routes
 *
 * @module modules/categories/routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { categoriesController, categoryGroupsController } from "./categories.controller";
import { categoriesOperationsController } from "./categories.operations.controller";

const router = Router();
router.use(householdGuard);

// Apply rate limiting to all category routes

// Seed default categories (must be before parameterized routes)
router.post("/seed", requireRole("admin"), categoriesOperationsController.seedDefaults);

// Reorder categories
router.put(
  "/reorder",
  requireRole("member"),
  categoriesOperationsController.reorderCategories,
);

// Category Groups
router.get("/groups", categoryGroupsController.listGroups);
router.post("/groups", requireRole("member"), categoryGroupsController.createGroup);
router.put(
  "/groups/reorder",
  requireRole("member"),
  categoriesOperationsController.reorderGroups,
);
router.put(
  "/groups/:id",
  requireRole("member"),
  categoryGroupsController.updateGroup,
);
router.delete(
  "/groups/:id",
  requireRole("member"),
  categoryGroupsController.deleteGroup,
);
router.put(
  "/groups/:id/restore",
  requireRole("member"),
  categoryGroupsController.restoreGroup,
);

// Categories
router.get("/", categoriesController.listCategories);
router.get("/:id", categoriesController.getCategoryById);
router.post("/", requireRole("member"), categoriesController.createCategory);
router.put("/:id", requireRole("member"), categoriesController.updateCategory);
router.delete(
  "/:id",
  requireRole("member"),
  categoriesController.deleteCategory,
);
router.patch(
  "/:id/archive",
  requireRole("member"),
  categoriesController.archiveCategory,
);
router.put(
  "/:id/restore",
  requireRole("member"),
  categoriesController.restoreCategory,
);

export default router;
