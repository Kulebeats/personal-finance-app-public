import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

// Mock requireAuth middleware before importing router
// requireAuth is imported from ./auth in notifications.ts, so we mock ../auth from __tests__
vi.mock("../auth", () => ({
  requireAuth: (req: Request, _res: Response, next: () => void) => {
    req.session = { userId: "user-1" } as any;
    next();
  },
}));

// Mock notification service
vi.mock("../../services/NotificationService", () => ({
  notificationService: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    archive: vi.fn(),
  },
}));

// Complete the mock contract: the controller's mark-as-read / mark-all /
// archive handlers call householdRepository.findByUserId + businessAuditService
// in a non-blocking audit block. Left unmocked these hit the real database
// (the query errors on the non-UUID userId and is swallowed). Mock them so the
// suite is deterministic and DB-independent. Mirrors notifications.integration.test.ts.
vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findByUserId: vi.fn().mockResolvedValue({ id: "household-1" }),
  },
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

// generalLimiter is a no-op pass-through in this harness. The real limiter is
// already skipped when NODE_ENV=test, but mocking removes that hidden dependency
// (the real keyGenerator reads req.socket, which this harness's bare req lacks).
vi.mock("../../middleware/rateLimit", () => ({
  generalLimiter: (_req: Request, _res: Response, next: () => void) => next(),
}));

import router from "../../modules/notifications/notifications.routes";
import { notificationService } from "../../services/NotificationService";
import { errorHandler } from "../../core/errors";

function createMockResponse() {
  let resolveJson: (payload: unknown) => void;
  const jsonPromise = new Promise((resolve) => {
    resolveJson = resolve;
  });

  const res = {
    statusCode: 200,
    body: undefined as any,
    status: vi.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(this: any, payload: unknown) {
      this.body = payload;
      resolveJson(payload);
      return this;
    }),
    waitForJson: () => jsonPromise,
  };

  return res;
}

async function runRoute(
  method: "get" | "put" | "delete",
  path: string,
  reqOverrides: Partial<Request>,
) {
  // Handle parameterized routes
  let matchPath = path;
  if (path.includes("/") && !path.startsWith("/:")) {
    // For paths like /abc123/read, find the pattern /:id/read
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[1] === "read") {
      matchPath = "/:id/read";
    } else if (parts.length === 1) {
      matchPath = "/:id";
    }
  }

  const layer = router.stack.find((entry: any) => {
    if (!entry.route) return false;
    const routePath = entry.route.path;
    if (routePath === matchPath) return entry.route.methods[method];
    if (routePath === path) return entry.route.methods[method];
    return false;
  });

  if (!layer || !layer.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }

  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req = {
    method: method.toUpperCase(),
    path,
    query: {},
    params: {},
    ...reqOverrides,
  } as Request;
  const res = createMockResponse();

  let index = 0;
  const next = async (err?: unknown) => {
    if (err) {
      // Translate controller-thrown errors (e.g. NotFoundError) into the
      // standardized response envelope, exactly as the app-level error
      // middleware (apiErrorMiddleware / core errorHandler) does in production.
      // Without this the harness rethrew the error, so the 404 assertions below
      // could never run.
      errorHandler(err as Error, req, res as unknown as Response, () => {});
      return;
    }
    const handler = handlers[index++];
    if (!handler) return;
    return handler(req, res, next);
  };

  await next();
  await res.waitForJson();
  return res;
}

describe("notification API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("returns paginated notifications list", async () => {
      const mockNotifications = [
        { id: "notif-1", title: "Test 1", isRead: false },
        { id: "notif-2", title: "Test 2", isRead: true },
      ];

      (notificationService.getNotifications as any).mockResolvedValue(
        mockNotifications,
      );

      const res = await runRoute("get", "/", {
        session: { userId: "user-1" } as any,
        query: { limit: "10", offset: "0" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockNotifications);
      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });

    it("filters unread only when parameter is set", async () => {
      (notificationService.getNotifications as any).mockResolvedValue([]);

      await runRoute("get", "/", {
        session: { userId: "user-1" } as any,
        query: { unreadOnly: "true" },
      });

      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ unreadOnly: true }),
      );
    });

    it("treats unreadOnly=false as false", async () => {
      (notificationService.getNotifications as any).mockResolvedValue([]);

      await runRoute("get", "/", {
        session: { userId: "user-1" } as any,
        query: { unreadOnly: "false" },
      });

      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ unreadOnly: false }),
      );
    });

    it("treats includeArchived=false as false", async () => {
      (notificationService.getNotifications as any).mockResolvedValue([]);

      await runRoute("get", "/", {
        session: { userId: "user-1" } as any,
        query: { includeArchived: "false" },
      });

      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ includeArchived: false }),
      );
    });
  });

  describe("GET /unread-count", () => {
    it("returns unread notification count", async () => {
      (notificationService.getUnreadCount as any).mockResolvedValue(5);

      const res = await runRoute("get", "/unread-count", {
        session: { userId: "user-1" } as any,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(5);
      expect(notificationService.getUnreadCount).toHaveBeenCalledWith("user-1");
    });
  });

  describe("PUT /:id/read", () => {
    const testUuid = "550e8400-e29b-41d4-a716-446655440001";

    it("marks a notification as read", async () => {
      const mockNotification = { id: testUuid, isRead: true };
      (notificationService.markAsRead as any).mockResolvedValue(
        mockNotification,
      );

      const res = await runRoute("put", "/:id/read", {
        session: { userId: "user-1" } as any,
        params: { id: testUuid },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockNotification);
      expect(notificationService.markAsRead).toHaveBeenCalledWith(
        testUuid,
        "user-1",
      );
    });

    it("returns 404 when notification not found", async () => {
      const notFoundUuid = "550e8400-e29b-41d4-a716-446655440099";
      (notificationService.markAsRead as any).mockResolvedValue(null);

      const res = await runRoute("put", "/:id/read", {
        session: { userId: "user-1" } as any,
        params: { id: notFoundUuid },
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("PUT /read-all", () => {
    it("marks all notifications as read", async () => {
      (notificationService.markAllAsRead as any).mockResolvedValue(3);

      const res = await runRoute("put", "/read-all", {
        session: { userId: "user-1" } as any,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(3);
      expect(notificationService.markAllAsRead).toHaveBeenCalledWith("user-1");
    });
  });

  describe("DELETE /:id", () => {
    const testUuid = "550e8400-e29b-41d4-a716-446655440002";

    it("archives a notification", async () => {
      const mockNotification = { id: testUuid, isArchived: true };
      (notificationService.archive as any).mockResolvedValue(mockNotification);

      const res = await runRoute("delete", "/:id", {
        session: { userId: "user-1" } as any,
        params: { id: testUuid },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockNotification);
      expect(notificationService.archive).toHaveBeenCalledWith(
        testUuid,
        "user-1",
      );
    });

    it("returns 404 when notification not found", async () => {
      const notFoundUuid = "550e8400-e29b-41d4-a716-446655440088";
      (notificationService.archive as any).mockResolvedValue(null);

      const res = await runRoute("delete", "/:id", {
        session: { userId: "user-1" } as any,
        params: { id: notFoundUuid },
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
