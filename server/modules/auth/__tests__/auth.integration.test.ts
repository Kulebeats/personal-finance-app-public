/**
 * Auth Module Integration Tests
 *
 * Tests for the modular auth routes: register, login, logout, me.
 * Tests HTTP endpoints with mocked service layer.
 *
 * @module modules/auth/__tests__/auth.integration.test
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

const mockNotificationService = vi.hoisted(() => ({
  triggerNewLogin: vi.fn().mockResolvedValue(undefined),
}));

// Mock modules
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
  notificationService: mockNotificationService,
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

// Import controller after mocks
import { authController } from "../auth.controller";
import { verifyPassword } from "../../../auth";

const mockUser = {
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
};

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

  // Mount auth routes manually
  const router = express.Router();
  router.post("/register", authController.register);
  router.post("/login", authController.login);
  router.post("/logout", (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }
    authController.logout(req, res, next);
  });
  router.get("/me", (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }
    authController.getCurrentUser(req, res, next);
  });

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

describe("Auth Module Integration Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ==========================================================================
  // POST /api/auth/register
  // ==========================================================================
  describe("POST /api/auth/register", () => {
    it("should register a new user successfully", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(mockUser);
      mockUserRepository.createDisplaySettings.mockResolvedValue({});

      const res = await request(app).post("/api/auth/register").send({
        email: "new@example.com",
        username: "newuser",
        password: "Password123",
        fullName: "New User",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(mockUser.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it("should reject registration with existing email", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        email: "test@example.com",
        username: "differentuser",
        password: "Password123",
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("should reject registration with existing username", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        email: "different@example.com",
        username: "testuser",
        password: "Password123",
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("should reject registration with invalid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "not-an-email",
        username: "testuser",
        password: "Password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject registration with short password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "test@example.com",
        username: "testuser",
        password: "short",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/auth/login
  // ==========================================================================
  describe("POST /api/auth/login", () => {
    it("should login successfully with valid credentials", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.findSessions.mockResolvedValue([]);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(mockUser.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.headers["set-cookie"]).toBeDefined();
      expect(mockUserRepository.createLoginHistory).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id, success: true }),
      );
    });

    it("should fail login with invalid password", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(false);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should fail login if user not found", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const res = await request(app).post("/api/auth/login").send({
        email: "unknown@example.com",
        password: "password123",
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should fail login with invalid email format", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "not-an-email",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return requiresMfa when MFA is enabled", async () => {
      const mfaUser = { ...mockUser, mfaEnabled: true };
      mockUserRepository.findByEmail.mockResolvedValue(mfaUser);
      (verifyPassword as any).mockResolvedValue(true);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresMfa).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/auth/logout
  // ==========================================================================
  describe("POST /api/auth/logout", () => {
    it("should logout successfully when authenticated", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.findSessions.mockResolvedValue([]);

      const agent = request.agent(app);

      // First login
      await agent
        .post("/api/auth/login")
        .send({
          email: "test@example.com",
          password: "password123",
        })
        .expect(200);

      // Then logout
      const res = await agent.post("/api/auth/logout");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should fail logout when not authenticated", async () => {
      const res = await request(app).post("/api/auth/logout");

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/auth/me
  // ==========================================================================
  describe("GET /api/auth/me", () => {
    it("should return current user when authenticated", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.findSessions.mockResolvedValue([]);
      mockUserRepository.findById.mockResolvedValue(mockUser);

      const agent = request.agent(app);

      // First login
      await agent
        .post("/api/auth/login")
        .send({
          email: "test@example.com",
          password: "password123",
        })
        .expect(200);

      // Get current user
      const res = await agent.get("/api/auth/me");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(mockUser.id);
    });

    it("should fail when not authenticated", async () => {
      const res = await request(app).get("/api/auth/me");

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // Session Persistence
  // ==========================================================================
  describe("Session Persistence", () => {
    it("should maintain session across requests", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.findSessions.mockResolvedValue([]);
      mockUserRepository.findById.mockResolvedValue(mockUser);

      const agent = request.agent(app);

      // Login
      await agent
        .post("/api/auth/login")
        .send({
          email: "test@example.com",
          password: "password123",
        })
        .expect(200);

      // Multiple requests should maintain session
      const res1 = await agent.get("/api/auth/me").expect(200);
      const res2 = await agent.get("/api/auth/me").expect(200);

      expect(res1.body.data.user.id).toBe(mockUser.id);
      expect(res2.body.data.user.id).toBe(mockUser.id);
    });

    it("should destroy session on logout", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);
      mockUserRepository.findSessions.mockResolvedValue([]);
      mockUserRepository.findById.mockResolvedValue(mockUser);

      const agent = request.agent(app);

      // Login
      await agent
        .post("/api/auth/login")
        .send({
          email: "test@example.com",
          password: "password123",
        })
        .expect(200);

      // Logout
      await agent.post("/api/auth/logout").expect(200);

      // Try to access protected route (should fail)
      await agent.get("/api/auth/me").expect(401);
    });
  });
});
