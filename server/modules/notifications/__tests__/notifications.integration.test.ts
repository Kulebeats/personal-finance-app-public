/**
 * Notifications Module - Integration Tests
 *
 * Tests notification CRUD operations, user scoping, mark as read,
 * archive, and audit logging using mocked service layer.
 */

import request from "supertest";
import express from "express";
import session from "express-session";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

// Mock services and repositories
const mockNotificationService = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  archive: vi.fn(),
}));

const mockNotificationRepository = vi.hoisted(() => ({
  findById: vi.fn(),
}));

const mockHouseholdRepository = vi.hoisted(() => ({
  findByUserId: vi.fn(),
}));

const mockAuditService = vi.hoisted(() => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

const mockPushNotificationService = vi.hoisted(() => ({
  saveSubscription: vi.fn().mockResolvedValue(undefined),
  removeSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../services/NotificationService", () => ({
  notificationService: mockNotificationService,
}));

vi.mock("../../../repositories/NotificationRepository", () => ({
  notificationRepository: mockNotificationRepository,
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockAuditService,
}));

vi.mock("../../../services/notification/push", () => ({
  pushNotificationService: mockPushNotificationService,
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Import controller after mocks
import { notificationsController } from "../notifications.controller";

// Test data
const testHouseholdId = randomUUID();
const testUser1Id = randomUUID();
const testUser2Id = randomUUID();

const testHousehold = {
  id: testHouseholdId,
  name: "Test Household",
  currency: "ZMW",
};

const testNotification1 = {
  id: randomUUID(),
  userId: testUser1Id,
  householdId: testHouseholdId,
  type: "budget_alert",
  title: "Budget Alert",
  body: "You are over budget!",
  isRead: false,
  isArchived: false,
  createdAt: new Date(),
};

const testNotification2 = {
  id: randomUUID(),
  userId: testUser1Id,
  householdId: testHouseholdId,
  type: "info",
  title: "Unread Test",
  body: "Test body",
  isRead: false,
  isArchived: false,
  createdAt: new Date(),
};

const testNotificationUser2 = {
  id: randomUUID(),
  userId: testUser2Id,
  householdId: testHouseholdId,
  type: "goal_milestone",
  title: "Goal Milestone",
  body: "You reached a milestone!",
  isRead: false,
  isArchived: false,
  createdAt: new Date(),
};

function createTestApp(userId: string = testUser1Id) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );

  // Middleware to set session based on X-Test-User header
  app.use((req, _res, next) => {
    if (req.headers["x-test-auth"] === "authenticated") {
      req.session.userId = (req.headers["x-test-user-id"] as string) || userId;
    }
    next();
  });

  // Auth check middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session?.userId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }
    next();
  };

  // Mount notification routes - specific routes before parameterized routes
  const router = express.Router();
  router.get("/", requireAuth, notificationsController.list);
  router.get("/unread-count", requireAuth, notificationsController.getUnreadCount);
  // Batch routes MUST come before /:id routes
  router.put("/read-all", requireAuth, notificationsController.markAllAsRead);
  router.put("/batch-read", requireAuth, notificationsController.batchMarkAsRead);
  router.delete("/batch-archive", requireAuth, notificationsController.batchArchive);
  // Parameterized routes after specific routes
  router.get("/:id", requireAuth, notificationsController.getById);
  router.put("/:id/read", requireAuth, notificationsController.markAsRead);
  router.delete("/:id", requireAuth, notificationsController.archive);
  router.post("/push/subscribe", requireAuth, notificationsController.subscribePush);
  router.delete("/push/unsubscribe", requireAuth, notificationsController.unsubscribePush);

  app.use("/api/notifications", router);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: err.name || "ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Notifications Integration Tests", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
  });

  // ==========================================================================
  // GET /api/notifications - List Notifications
  // ==========================================================================

  describe("GET /api/notifications - List Notifications", () => {
    it("should return only current user's notifications (user scoping)", async () => {
      mockNotificationService.getNotifications.mockResolvedValue([testNotification1]);

      const res = await request(app)
        .get("/api/notifications")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Verify service was called with correct userId
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        testUser1Id,
        expect.objectContaining({ limit: 20, offset: 0 })
      );
    });

    it("should support unreadOnly filter", async () => {
      mockNotificationService.getNotifications.mockResolvedValue([testNotification2]);

      const res = await request(app)
        .get("/api/notifications?unreadOnly=true")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        testUser1Id,
        expect.objectContaining({ unreadOnly: true })
      );
    });

    it("should support pagination", async () => {
      mockNotificationService.getNotifications.mockResolvedValue([testNotification1]);

      const res = await request(app)
        .get("/api/notifications?limit=1&offset=0")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        testUser1Id,
        expect.objectContaining({ limit: 1, offset: 0 })
      );
    });

    it("should support includeArchived filter", async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/notifications?includeArchived=true")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        testUser1Id,
        expect.objectContaining({ includeArchived: true })
      );
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/notifications");
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/notifications/unread-count - Unread Count
  // ==========================================================================

  describe("GET /api/notifications/unread-count", () => {
    it("should return unread count for current user", async () => {
      mockNotificationService.getUnreadCount.mockResolvedValue(5);

      const res = await request(app)
        .get("/api/notifications/unread-count")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(5);
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith(testUser1Id);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/notifications/unread-count");
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/notifications/:id - Get Single Notification
  // ==========================================================================

  describe("GET /api/notifications/:id - Get Single Notification", () => {
    it("should return notification by id", async () => {
      mockNotificationRepository.findById.mockResolvedValue(testNotification1);

      const res = await request(app)
        .get(`/api/notifications/${testNotification1.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testNotification1.id);
    });

    it("should return 404 for notification belonging to another user", async () => {
      mockNotificationRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .get(`/api/notifications/${testNotificationUser2.id}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(404);
    });

    it("should return 404 for non-existent notification", async () => {
      mockNotificationRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .get(`/api/notifications/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });

    it("should validate notification ID format", async () => {
      const res = await request(app)
        .get("/api/notifications/invalid-uuid")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // PUT /api/notifications/:id/read - Mark as Read
  // ==========================================================================

  describe("PUT /api/notifications/:id/read - Mark as Read", () => {
    it("should mark notification as read", async () => {
      const readNotification = { ...testNotification1, isRead: true };
      mockNotificationService.markAsRead.mockResolvedValue(readNotification);

      const res = await request(app)
        .put(`/api/notifications/${testNotification1.id}/read`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRead).toBe(true);
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith(
        testNotification1.id,
        testUser1Id
      );
    });

    it("should return 404 for notification belonging to another user", async () => {
      mockNotificationService.markAsRead.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/notifications/${testNotificationUser2.id}/read`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(404);
    });

    it("should return 404 for non-existent notification", async () => {
      mockNotificationService.markAsRead.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/notifications/${randomUUID()}/read`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });

    it("should audit log mark as read (non-blocking)", async () => {
      const readNotification = { ...testNotification1, isRead: true };
      mockNotificationService.markAsRead.mockResolvedValue(readNotification);

      await request(app)
        .put(`/api/notifications/${testNotification1.id}/read`)
        .set("X-Test-Auth", "authenticated")
        .expect(200);

      // Verify audit was called (non-blocking so no need to wait)
      expect(mockAuditService.logUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PUT /api/notifications/read-all - Mark All as Read
  // ==========================================================================

  describe("PUT /api/notifications/read-all - Mark All as Read", () => {
    it("should mark all notifications as read for current user", async () => {
      mockNotificationService.markAllAsRead.mockResolvedValue(3);

      const res = await request(app)
        .put("/api/notifications/read-all")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(3);
      expect(mockNotificationService.markAllAsRead).toHaveBeenCalledWith(testUser1Id);
    });

    it("should not affect other user's notifications", async () => {
      // This is implicitly tested by verifying service is called with correct userId
      mockNotificationService.markAllAsRead.mockResolvedValue(2);

      await request(app)
        .put("/api/notifications/read-all")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id)
        .expect(200);

      expect(mockNotificationService.markAllAsRead).toHaveBeenCalledWith(testUser1Id);
    });
  });

  // ==========================================================================
  // PUT /api/notifications/batch-read - Batch Mark as Read
  // ==========================================================================

  describe("PUT /api/notifications/batch-read - Batch Mark as Read", () => {
    it("should mark multiple notifications as read", async () => {
      mockNotificationService.markAsRead.mockResolvedValue({ ...testNotification1, isRead: true });

      const res = await request(app)
        .put("/api/notifications/batch-read")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: [testNotification1.id, testNotification2.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it("should validate notificationIds array", async () => {
      const res = await request(app)
        .put("/api/notifications/batch-read")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: "not-an-array" });

      expect(res.status).toBe(400);
    });

    it("should require at least one notification ID", async () => {
      const res = await request(app)
        .put("/api/notifications/batch-read")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: [] });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /api/notifications/:id - Archive Notification
  // ==========================================================================

  describe("DELETE /api/notifications/:id - Archive Notification", () => {
    it("should archive notification", async () => {
      const archivedNotification = { ...testNotification1, isArchived: true };
      mockNotificationService.archive.mockResolvedValue(archivedNotification);

      const res = await request(app)
        .delete(`/api/notifications/${testNotification1.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(true);
    });

    it("should return 404 for notification belonging to another user", async () => {
      mockNotificationService.archive.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/api/notifications/${testNotificationUser2.id}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(404);
    });

    it("should audit log notification archive", async () => {
      const archivedNotification = { ...testNotification1, isArchived: true };
      mockNotificationService.archive.mockResolvedValue(archivedNotification);

      await request(app)
        .delete(`/api/notifications/${testNotification1.id}`)
        .set("X-Test-Auth", "authenticated")
        .expect(200);

      expect(mockAuditService.logDelete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // DELETE /api/notifications/batch-archive - Batch Archive
  // ==========================================================================

  describe("DELETE /api/notifications/batch-archive - Batch Archive", () => {
    it("should archive multiple notifications", async () => {
      mockNotificationService.archive.mockResolvedValue({ ...testNotification1, isArchived: true });

      const res = await request(app)
        .delete("/api/notifications/batch-archive")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: [testNotification1.id, testNotification2.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it("should validate notificationIds array", async () => {
      const res = await request(app)
        .delete("/api/notifications/batch-archive")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: "not-an-array" });

      expect(res.status).toBe(400);
    });

    it("should enforce max 100 notifications limit", async () => {
      const tooManyIds = Array.from({ length: 101 }, () => randomUUID());

      const res = await request(app)
        .delete("/api/notifications/batch-archive")
        .set("X-Test-Auth", "authenticated")
        .send({ notificationIds: tooManyIds });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // Push Subscriptions
  // ==========================================================================

  describe("Push Subscriptions", () => {
    const pushEndpoint = "https://fcm.googleapis.com/fcm/send/raw-endpoint-token";
    const subscription = {
      endpoint: pushEndpoint,
      keys: {
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    };

    it("should audit log push subscription saves without storing the raw endpoint", async () => {
      await request(app)
        .post("/api/notifications/push/subscribe")
        .set("X-Test-Auth", "authenticated")
        .send({ subscription })
        .expect(200);

      expect(mockPushNotificationService.saveSubscription).toHaveBeenCalledWith(
        testUser1Id,
        expect.any(String),
        subscription,
      );

      expect(mockAuditService.logCreate).toHaveBeenCalled();
      const auditArg = mockAuditService.logCreate.mock.calls[0][0];
      expect(auditArg).toMatchObject({
        householdId: testHouseholdId,
        userId: testUser1Id,
        entityType: "push_subscription",
        ipAddress: "127.0.0.1",
        metadata: { action: "push_subscription_saved" },
      });
      expect(auditArg.entityId).toHaveLength(16);
      expect(auditArg.entityId).not.toContain("raw-endpoint-token");
      expect(auditArg.newValue).toEqual({ endpointHash: auditArg.entityId });
    });

    it("should audit log push subscription removals without storing the raw endpoint", async () => {
      await request(app)
        .delete("/api/notifications/push/unsubscribe")
        .set("X-Test-Auth", "authenticated")
        .send({ endpoint: pushEndpoint })
        .expect(200);

      expect(mockPushNotificationService.removeSubscription).toHaveBeenCalledWith(
        pushEndpoint,
        testUser1Id,
      );

      expect(mockAuditService.logDelete).toHaveBeenCalled();
      const auditArg = mockAuditService.logDelete.mock.calls[0][0];
      expect(auditArg).toMatchObject({
        householdId: testHouseholdId,
        userId: testUser1Id,
        entityType: "push_subscription",
        ipAddress: "127.0.0.1",
        metadata: { action: "push_subscription_removed" },
      });
      expect(auditArg.entityId).toHaveLength(16);
      expect(auditArg.entityId).not.toContain("raw-endpoint-token");
      expect(auditArg.oldValue).toEqual({ endpointHash: auditArg.entityId });
    });
  });

  // ==========================================================================
  // User Isolation (Cross-User Access Prevention)
  // ==========================================================================

  describe("User Isolation - Cross-User Access Prevention", () => {
    it("should not allow user1 to see user2's notifications", async () => {
      // Service should only return notifications for the requesting user
      mockNotificationService.getNotifications.mockResolvedValue([testNotification1]);

      const res = await request(app)
        .get("/api/notifications")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(200);
      // Verify service was called with user1's ID, not user2's
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        testUser1Id,
        expect.any(Object)
      );
    });

    it("should not allow user1 to mark user2's notification as read", async () => {
      mockNotificationService.markAsRead.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/notifications/${testNotificationUser2.id}/read`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      // Service returns null for notifications not belonging to the user
      expect(res.status).toBe(404);
    });

    it("should not allow user1 to archive user2's notification", async () => {
      mockNotificationService.archive.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/api/notifications/${testNotificationUser2.id}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testUser1Id);

      expect(res.status).toBe(404);
    });
  });
});
