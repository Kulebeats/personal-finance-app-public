/**
 * R05.2 saved views, mounted at /api/settings/saved-views (after requireAuth,
 * inside the /api general rate limiter). Every role lists; owner and admin write.
 */
import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireCapability } from "../../core/authz/requireCapability";
import { uuidParam } from "../../middleware/uuidParams";
import { asyncHandler } from "../../utils/errorHandler";
import { savedViewsController } from "./saved-views.controller";

const router = Router();
const manage = requireCapability("household.policy.write");

router.param("id", uuidParam);
router.use(householdGuard);
router.get("/", asyncHandler(savedViewsController.list));
router.post("/", manage, asyncHandler(savedViewsController.create));
router.put("/:id", manage, asyncHandler(savedViewsController.update));
router.delete("/:id", manage, asyncHandler(savedViewsController.remove));

export default router;
