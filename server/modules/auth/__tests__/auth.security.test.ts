/**
 * Auth Module Security Tests
 *
 * Tests for security-critical functionality:
 * - Device detection and tracking
 * - New device notifications
 * - Session creation
 * - MFA flow
 * - Remember Me
 *
 * @module modules/auth/__tests__/auth.security.test
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

const mockNotificationService = vi.hoisted(() => ({
  triggerNewLogin: vi.fn().mockResolvedValue(undefined),
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

// Import after mocks
import { authController } from "../auth.controller";
import { verifyPassword } from "../../../auth";
import { parseDeviceInfo, isKnownDeviceSession } from "../auth.device";

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

  const router = express.Router();
  router.post("/login", authController.login);
  router.post("/mfa/verify", authController.verifyMfa);
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

describe("Auth Module Security Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ==========================================================================
  // Session Security
  // ==========================================================================
  describe("Session Security", () => {
    it("should set session cookie on successful login", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"][0]).toContain("connect.sid");
    });

    it("should destroy session completely on logout", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      (verifyPassword as any).mockResolvedValue(true);

      const agent = request.agent(app);

      // Login
      await agent.post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
      });

      // Verify logged in
      await agent.get("/api/auth/me").expect(200);

      // Logout
      await agent.post("/api/auth/logout").expect(200);

      // Verify session is destroyed
      const res = await agent.get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("should create session record on login", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app)
        .post("/api/auth/login")
        .set(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0",
        )
        .send({
          email: "test@example.com",
          password: "password123",
        });

      expect(mockUserRepository.upsertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          sessionToken: expect.any(String),
          deviceName: expect.any(String),
          browser: expect.any(String),
          os: expect.any(String),
        }),
      );
    });
  });

  // ==========================================================================
  // Device Detection
  // ==========================================================================
  describe("Device Detection", () => {
    describe("parseDeviceInfo", () => {
      it("should detect Chrome on Windows", () => {
        const ua =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Chrome");
        expect(info.os).toBe("Windows");
        expect(info.deviceType).toBe("desktop");
        expect(info.deviceName).toBe("Chrome on Windows");
      });

      it("should detect Safari on macOS", () => {
        const ua =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Safari");
        expect(info.os).toBe("macOS");
        expect(info.deviceType).toBe("desktop");
      });

      it("should detect Firefox on Linux", () => {
        const ua =
          "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Firefox");
        expect(info.os).toBe("Linux");
        expect(info.deviceType).toBe("desktop");
      });

      it("should detect Edge on Windows", () => {
        const ua =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0 Edg/91.0";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Edge");
        expect(info.os).toBe("Windows");
      });

      it("should detect Chrome on Android (mobile)", () => {
        const ua =
          "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 Chrome/91.0 Mobile Safari/537.36";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Chrome");
        expect(info.os).toBe("Android");
        expect(info.deviceType).toBe("mobile");
      });

      it("should detect Safari on iPhone (mobile)", () => {
        const ua =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Safari");
        expect(info.os).toBe("iOS");
        expect(info.deviceType).toBe("mobile");
      });

      it("should detect Safari on iPad (tablet)", () => {
        const ua =
          "Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Safari");
        expect(info.os).toBe("iPadOS");
        expect(info.deviceType).toBe("tablet");
      });

      it("should handle unknown user agent", () => {
        const ua = "Unknown-Bot/1.0";
        const info = parseDeviceInfo(ua);

        expect(info.browser).toBe("Unknown Browser");
        expect(info.os).toBe("Unknown OS");
        expect(info.deviceType).toBe("desktop");
      });
    });

    describe("isKnownDeviceSession", () => {
      it("should return true for matching device", () => {
        const sessions = [
          {
            browser: "Chrome",
            os: "Windows",
            deviceType: "desktop",
            deviceName: "Chrome on Windows",
          },
        ];
        const deviceInfo = {
          browser: "Chrome",
          os: "Windows",
          deviceType: "desktop" as const,
          deviceName: "Chrome on Windows",
        };

        expect(isKnownDeviceSession(sessions, deviceInfo)).toBe(true);
      });

      it("should return false for new device", () => {
        const sessions = [
          {
            browser: "Chrome",
            os: "Windows",
            deviceType: "desktop",
            deviceName: "Chrome on Windows",
          },
        ];
        const deviceInfo = {
          browser: "Firefox",
          os: "Linux",
          deviceType: "desktop" as const,
          deviceName: "Firefox on Linux",
        };

        expect(isKnownDeviceSession(sessions, deviceInfo)).toBe(false);
      });

      it("should return false for empty sessions", () => {
        const sessions: any[] = [];
        const deviceInfo = {
          browser: "Chrome",
          os: "Windows",
          deviceType: "desktop" as const,
          deviceName: "Chrome on Windows",
        };

        expect(isKnownDeviceSession(sessions, deviceInfo)).toBe(false);
      });

      it("should be case-insensitive", () => {
        const sessions = [
          {
            browser: "CHROME",
            os: "WINDOWS",
            deviceType: "DESKTOP",
            deviceName: "Chrome on Windows",
          },
        ];
        const deviceInfo = {
          browser: "chrome",
          os: "windows",
          deviceType: "desktop" as const,
          deviceName: "chrome on windows",
        };

        expect(isKnownDeviceSession(sessions, deviceInfo)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // New Device Notifications
  // ==========================================================================
  describe("New Device Notifications", () => {
    it("should trigger notification for new device login", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]); // No existing sessions
      (verifyPassword as any).mockResolvedValue(true);

      await request(app)
        .post("/api/auth/login")
        .set(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0",
        )
        .send({
          email: "test@example.com",
          password: "password123",
        });

      // Wait for async notification
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockNotificationService.triggerNewLogin).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(String), // session ID
      );
    });

    it("should NOT trigger notification for known device", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([
        {
          browser: "chrome",
          os: "windows",
          deviceType: "desktop",
          deviceName: "Chrome on Windows",
        },
      ]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app)
        .post("/api/auth/login")
        .set(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0",
        )
        .send({
          email: "test@example.com",
          password: "password123",
        });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockNotificationService.triggerNewLogin).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // MFA Flow
  // ==========================================================================
  describe("MFA Flow", () => {
    it("should not set session when MFA is required", async () => {
      const mfaUser = { ...mockUser, mfaEnabled: true };
      mockUserRepository.findByEmail.mockResolvedValue(mfaUser);
      (verifyPassword as any).mockResolvedValue(true);

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.requiresMfa).toBe(true);

      // Session should NOT be created for MFA users before MFA verification
      expect(mockUserRepository.upsertSession).not.toHaveBeenCalled();
    });

    describe("MFA Hashing Security", () => {
      it("should store hashed MFA code during login challenge", async () => {
        const mfaUser = { ...mockUser, mfaEnabled: true };
        mockUserRepository.findByEmail.mockResolvedValue(mfaUser);
        mockUserRepository.findSessions.mockResolvedValue([]);
        (verifyPassword as any).mockResolvedValue(true); // Password check

        // Mock hashPassword specifically for this test
        const { hashPassword } = await import("../../../auth");
        (hashPassword as any).mockResolvedValue("hashed_mfa_code");

        await request(app).post("/api/auth/login").send({
          email: "test@example.com",
          password: "password123",
        });

        // Verify that update was called with the HASHED code, not a 6-digit number
        expect(mockUserRepository.update).toHaveBeenCalledWith(
          mfaUser.id,
          expect.objectContaining({
            mfaCode: "hashed_mfa_code",
          }),
        );
      });

      it("should verify successful MFA login with hashed code", async () => {
        // Mock Setup
        const mfaUser = { ...mockUser, mfaEnabled: true };
        mockUserRepository.findByEmail.mockResolvedValue(mfaUser);
        mockUserRepository.findById.mockResolvedValue({
          ...mfaUser,
          mfaCode: "hashed_stored_code",
          mfaCodeExpiry: new Date(Date.now() + 10000), // Valid expiry
        });

        const agent = request.agent(app);

        // 1. Trigger MFA challenge (Login)
        (verifyPassword as any).mockResolvedValueOnce(true); // Login password check
        await agent.post("/api/auth/login").send({
          email: "test@example.com",
          password: "password123",
        });

        // 2. Verify MFA
        (verifyPassword as any).mockResolvedValueOnce(true); // MFA code check

        const res = await agent.post("/api/auth/mfa/verify").send({
          code: "123456",
        });

        expect(res.status).toBe(200);

        // Assert verifyPassword was called with provided code and stored hash
        // First call was login, second call is MFA
        expect(verifyPassword).toHaveBeenLastCalledWith(
          "123456",
          "hashed_stored_code",
        );
      });

      it("should reject invalid MFA code", async () => {
        const mfaUser = { ...mockUser, mfaEnabled: true };
        mockUserRepository.findByEmail.mockResolvedValue(mfaUser);
        mockUserRepository.findById.mockResolvedValue({
          ...mfaUser,
          mfaCode: "hashed_stored_code",
          mfaCodeExpiry: new Date(Date.now() + 10000),
        });

        const agent = request.agent(app);
        (verifyPassword as any).mockResolvedValueOnce(true); // Login password OK
        await agent.post("/api/auth/login").send({
          email: "test@example.com",
          password: "password123",
        });

        // Verify MFA - Incorrect code
        (verifyPassword as any).mockResolvedValueOnce(false); // MFA check fails

        const res = await agent.post("/api/auth/mfa/verify").send({
          code: "999999",
        });

        expect(res.status).toBe(401);
      });
    });
  });

  // ==========================================================================
  // Login History
  // ==========================================================================
  describe("Login History", () => {
    it("should log successful login with device info", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app)
        .post("/api/auth/login")
        .set(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0",
        )
        .send({
          email: "test@example.com",
          password: "password123",
        });

      expect(mockUserRepository.createLoginHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          success: true,
          deviceName: expect.stringContaining("Chrome"),
        }),
      );
    });

    it("should log failed login attempt", async () => {
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
  // Remember Me
  // ==========================================================================
  describe("Remember Me", () => {
    it("should set longer session expiry with rememberMe=true", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
        rememberMe: true,
      });

      // Session should be created with ~30 day expiry
      expect(mockUserRepository.upsertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      );

      const call = mockUserRepository.upsertSession.mock.calls[0][0];
      const expiresAt = call.expiresAt as Date;
      const expectedExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Allow 5 minute tolerance
      expect(expiresAt.getTime()).toBeGreaterThan(
        expectedExpiry - 5 * 60 * 1000,
      );
    });

    it("should set shorter session expiry with rememberMe=false", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.findSessions.mockResolvedValue([]);
      (verifyPassword as any).mockResolvedValue(true);

      await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "password123",
        rememberMe: false,
      });

      expect(mockUserRepository.upsertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      );

      const call = mockUserRepository.upsertSession.mock.calls[0][0];
      const expiresAt = call.expiresAt as Date;
      const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;

      // Allow 5 minute tolerance
      expect(expiresAt.getTime()).toBeLessThan(expectedExpiry + 5 * 60 * 1000);
    });
  });
});
