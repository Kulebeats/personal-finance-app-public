/**
 * Notifications Module - Routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { notificationsController } from "./notifications.controller";
import { quietHoursController } from "./notifications.quiet-hours.controller";

const router = Router();

// All notification routes require authentication
router.use(requireAuth);

// ============================================================================
// READ OPERATIONS - Rate limited
// ============================================================================

router.get("/", notificationsController.list);
router.get("/unread-count", notificationsController.getUnreadCount);
// Quiet hours (before the parameterized /:id routes)
router.get("/quiet-hours", quietHoursController.get);
router.put("/quiet-hours", quietHoursController.put);
router.get("/:id", notificationsController.getById);

// ============================================================================
// MUTATION OPERATIONS - Rate limited
// ============================================================================

// Batch operations (must be before parameterized routes)
router.put("/batch-read", notificationsController.batchMarkAsRead);
router.delete("/batch-archive", notificationsController.batchArchive);
router.put("/read-all", notificationsController.markAllAsRead);

// Single notification operations
router.put("/:id/read", notificationsController.markAsRead);
router.delete("/:id", notificationsController.archive);

// ============================================================================
// PUSH NOTIFICATION OPERATIONS
// ============================================================================

router.post("/push/subscribe", notificationsController.subscribePush);
router.delete("/push/unsubscribe", notificationsController.unsubscribePush);
router.get("/push/vapid-key", notificationsController.getVapidKey);

export default router;
