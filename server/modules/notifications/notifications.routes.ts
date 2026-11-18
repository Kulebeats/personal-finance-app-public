/**
 * Notifications Module - Routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { generalLimiter } from "../../middleware/rateLimit";
import { notificationsController } from "./notifications.controller";

const router = Router();

// All notification routes require authentication
router.use(requireAuth);

// ============================================================================
// READ OPERATIONS - Rate limited
// ============================================================================

router.get("/", generalLimiter, notificationsController.list);
router.get("/unread-count", generalLimiter, notificationsController.getUnreadCount);
router.get("/:id", generalLimiter, notificationsController.getById);

// ============================================================================
// MUTATION OPERATIONS - Rate limited
// ============================================================================

// Batch operations (must be before parameterized routes)
router.put("/batch-read", generalLimiter, notificationsController.batchMarkAsRead);
router.delete("/batch-archive", generalLimiter, notificationsController.batchArchive);
router.put("/read-all", generalLimiter, notificationsController.markAllAsRead);

// Single notification operations
router.put("/:id/read", generalLimiter, notificationsController.markAsRead);
router.delete("/:id", generalLimiter, notificationsController.archive);

// ============================================================================
// PUSH NOTIFICATION OPERATIONS
// ============================================================================

router.post("/push/subscribe", generalLimiter, notificationsController.subscribePush);
router.delete("/push/unsubscribe", generalLimiter, notificationsController.unsubscribePush);
router.get("/push/vapid-key", generalLimiter, notificationsController.getVapidKey);

export default router;
