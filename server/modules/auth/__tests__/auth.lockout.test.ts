/**
 * Auth Module Lockout Tests
 *
 * Tests for account lockout functionality:
 * - Failed login attempt tracking
 * - Account locking after MAX_FAILED_ATTEMPTS (5)
 * - Lockout duration enforcement (15 minutes)
 * - Lockout reset on successful login
 *
 * @module modules/auth/__tests__/auth.lockout.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import session from "express-session";

// Hoist mocks before imports
const mockUserRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByUsername: vi.fn(),
  create: vi.fn(),
  createLoginHistory: vi.fn(),
  upsertSession: vi.fn(),
  findSessions: vi.fn(),
  update: vi.fn(),
  findById: vi.fn(),
  createDisplaySettings: vi.fn(),
}));

const mockAuditService = vi.hoisted(() => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: mockUserRepository,
}));

vi.mock("../../../auth", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed_password"),
  verifyPassword: vi.fn(),
  validatePasswordComplexity: vi.fn().mockReturnValue({ valid: true }),
  requireAuth: (req: any, res: any, next: any) => {
    if (req.session && req.session.userId) {
      next();
    } else {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }
  },
}));

vi.mock("../../../seed", () => ({
  seedDefaultNotificationPreferences: vi.fn(),
}));

vi.mock("../../../services/NotificationService", () => ({
  notificationService: {
    triggerNewLogin: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../services/AuditService", () => ({
  auditService: mockAuditService,
  AuditEventType: {
    REGISTER: "REGISTER",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    LOGIN_FAILED: "LOGIN_FAILED",
    LOGOUT: "LOGOUT",
    ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  },
}));

vi.mock("../../../middleware/rateLimit", () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Import after mocks
import { authController } from "../auth.controller";
import { verifyPassword } from "../../../auth";

const createMockUser = (overrides = {}) => ({
  id: "123e4567-e89b-12d3-a456-426614174000",
  email: "test@example.com",
  passwordHash: "hashed_password",
  username: "testuser",
  fullName: "Test User",
  mfaEnabled: false,
  failedLoginAttempts: 0,
  lockedUntil: null,
  emailVerified: true,
  householdId: "household-123",
  ...overrides,
});

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  const router = express.Router();
  router.post("/login", authController.login);
  app.use("/api/auth", router);

  // Error handler middleware - maps error names to status codes
  app.use((err: any, _req: any, res: any, _next: any) => {
    let statusCode = err.statusCode || err.status || 500;

    // Map error names to HTTP status codes
    if (err.name === "ValidationError") statusCode = 400;
    if (err.name === "NotFoundError") statusCode = 404;
    if (err.name === "UnauthorizedError") statusCode = 401;
    if (err.name === "ForbiddenError") statusCode = 403;
    if (err.name === "ConflictError") statusCode = 409;

    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || err.name || "INTERNAL_ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Auth Module Lockout Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ==========================================================================
  // Failed Login Attempt Tracking
  // ==========================================================================
  describe("Failed Login Attempt Tracking", () => {
    it("should increment failed attempts on wrong password", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 0 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          failedLoginAttempts: 1,
          lastFailedLoginAt: expect.any(Date),
        }),
      );
    });

    it("should increment failed attempts from existing count", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 3 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          failedLoginAttempts: 4,
        }),
      );
    });

    it("should log failed login to login history", async () => {
      const mockUser = createMockUser();
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(mockUserRepository.createLoginHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          success: false,
          failureReason: "Invalid password",
        }),
      );
    });
  });

  // ==========================================================================
  // Account Lockout After 5 Failed Attempts
  // ==========================================================================
  describe("Account Lockout After 5 Failed Attempts", () => {
    it("should lock account after 5 failed attempts", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 4 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      // Should set lockedUntil to 15 minutes from now
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          failedLoginAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
      );

      const updateCall = mockUserRepository.update.mock.calls[0];
      const lockedUntil = updateCall[1].lockedUntil as Date;
      const expectedLockEnd = Date.now() + 15 * 60 * 1000;

      // Allow 5 second tolerance for test execution time
      expect(lockedUntil.getTime()).toBeGreaterThan(expectedLockEnd - 5000);
      expect(lockedUntil.getTime()).toBeLessThan(expectedLockEnd + 5000);
    });

    it("should audit log account lockout event", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 4 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "ACCOUNT_LOCKED",
          userId: mockUser.id,
          details: expect.objectContaining({
            reason: "max_failed_attempts",
            attempts: 5,
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // Locked Account Behavior
  // ==========================================================================
  describe("Locked Account Behavior", () => {
    it("should reject login with valid password when account is locked", async () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
      const mockUser = createMockUser({
        failedLoginAttempts: 5,
        lockedUntil: futureTime,
      });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "correctpassword",
      });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("temporarily locked");

      // Password should NOT have been checked
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it("should include remaining lockout time in error message", async () => {
      const futureTime = new Date(Date.now() + 8 * 60 * 1000); // 8 minutes from now
      const mockUser = createMockUser({
        failedLoginAttempts: 5,
        lockedUntil: futureTime,
      });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password",
      });

      expect(res.status).toBe(403);
      // Should show approximately 8 minutes remaining
      expect(res.body.error.message).toMatch(/\d+ minute/);
    });

    it("should allow login after lockout period expires", async () => {
      const pastTime = new Date(Date.now() - 60 * 1000); // 1 minute ago (expired)
      const mockUser = createMockUser({
        failedLoginAttempts: 5,
        lockedUntil: pastTime,
      });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "correctpassword",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // Failed Attempt Reset on Successful Login
  // ==========================================================================
  describe("Failed Attempt Reset on Successful Login", () => {
    it("should reset failed attempts counter on successful login", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 3 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "correctpassword",
      });

      expect(mockUserRepository.update).toHaveBeenCalledWith(mockUser.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    });

    it("should not call update if no failed attempts existed", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: 0 });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "correctpassword",
      });

      // Update should not be called to reset attempts (they're already 0)
      expect(mockUserRepository.update).not.toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ failedLoginAttempts: 0 }),
      );
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe("Lockout Edge Cases", () => {
    it("should handle null failedLoginAttempts as 0", async () => {
      const mockUser = createMockUser({ failedLoginAttempts: null });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          failedLoginAttempts: 1,
        }),
      );
    });

    it("should check lockout BEFORE password verification (timing attack prevention)", async () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000);
      const mockUser = createMockUser({
        failedLoginAttempts: 5,
        lockedUntil: futureTime,
      });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "anypassword",
      });

      // verifyPassword should NOT have been called
      expect(verifyPassword).not.toHaveBeenCalled();
    });
  });
});
