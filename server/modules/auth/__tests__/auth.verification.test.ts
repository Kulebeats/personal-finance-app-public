import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../auth.service";
import { userRepository } from "../../../repositories/UserRepository";
import { ValidationError } from "../../../core/errors";
import { consumeEmailVerificationToken, issueInitialEmailVerification } from "../../../services/security-email";

// Facade tests mock the durable boundary; actual consumption and races use PG.
vi.mock("../../../services/security-email", () => ({ consumeEmailVerificationToken: vi.fn(), issueInitialEmailVerification: vi.fn() }));

// Mock dependencies
vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createLoginHistory: vi.fn(),
    createDisplaySettings: vi.fn(),
    findSessions: vi.fn(),
    upsertSession: vi.fn(),
  },
}));
vi.mock("../../../services/session-identity", () => ({
  assertCurrentCredential: vi.fn().mockResolvedValue(undefined),
  registerSessionIdentity: (_user: unknown, data: unknown) => userRepository.upsertSession(data as any),
  revokeLoginSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../auth", () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  validatePasswordComplexity: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock("../../../services/AuditService", () => ({
  auditService: {
    log: vi.fn(),
    AuditEventType: {},
  },
  AuditEventType: {},
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));


vi.mock("../auth.security.monitor", () => ({
  authSecurityMonitor: {
    checkGeoAnomaly: vi.fn().mockResolvedValue(undefined),
    checkLoginVelocity: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../auth.device", () => ({
  parseDeviceInfo: vi.fn().mockReturnValue({
    deviceName: "test",
    deviceType: "test",
    browser: "test",
    os: "test",
  }),
  isKnownDeviceSession: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../seed", () => ({
  seedDefaultNotificationPreferences: vi.fn(),
}));

describe("Email Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeEmailVerificationToken).mockReset();
    vi.mocked(issueInitialEmailVerification).mockReset().mockResolvedValue(null);
  });

  describe("register", () => {
    it("should create user with verified=false and generate token", async () => {
      const mockUser = {
        id: "new-user-id",
        email: "new@example.com",
        username: "newuser",
        emailVerified: false,
      };

      (userRepository.findByEmail as any).mockResolvedValue(null);
      (userRepository.create as any).mockResolvedValue(mockUser);

      const req = {
        ip: "127.0.0.1",
        headers: {},
        sessionID: "verification-register-unit-session",
        session: { regenerate: (cb: any) => cb(), cookie: {} },
      } as any;

      const result = await authService.register(
        {
          email: "new@example.com",
          username: "newuser",
          password: "Password1!",
          fullName: "New User",
        },
        req,
      );

      expect(result.user.id).toBe(mockUser.id);
      expect(req.session.userId).toBe(mockUser.id);
      expect(userRepository.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ userId: mockUser.id, sessionToken: req.sessionID }));

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: false,
          emailVerificationToken: expect.any(String),
          emailVerificationExpiry: expect.any(Date),
        }),
      );
    });
  });

  describe("register display settings", () => {
    it("seeds the light theme for a new account", async () => {
      (userRepository.findByEmail as any).mockResolvedValue(null);
      (userRepository.findByUsername as any).mockResolvedValue(null);
      (userRepository.create as any).mockResolvedValue({ id: "theme-user-id", email: "theme@example.com", username: "themeuser" });
      const req = {
        ip: "127.0.0.1",
        headers: {},
        sessionID: "theme-register-unit-session",
        session: { regenerate: (cb: any) => cb(), cookie: {} },
      } as any;

      await authService.register(
        { email: "theme@example.com", username: "themeuser", password: "Password1!", fullName: "Theme User" },
        req,
      );

      expect(userRepository.createDisplaySettings).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "theme-user-id", theme: "light" }),
      );
    });
  });

  describe("login", () => {
    it("should block login if email not verified", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        passwordHash: "hashed",
        emailVerified: false,
      };

      (userRepository.findByEmail as any).mockResolvedValue(mockUser);

      const req = {
        ip: "127.0.0.1",
        headers: {},
        session: {},
      } as any;

      await expect(
        authService.login(
          {
            email: "test@example.com",
            password: "password",
            rememberMe: false,
          },
          req,
        ),
      ).rejects.toMatchObject({ statusCode: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
    });

    it("should allow login if email verified", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        passwordHash: "hashed",
        emailVerified: true,
        mfaEnabled: false,
      };

      (userRepository.findByEmail as any).mockResolvedValue(mockUser);
      (userRepository.update as any).mockResolvedValue({});

      const req = {
        ip: "127.0.0.1",
        headers: {},
        sessionID: "verification-login-unit-session",
        session: { regenerate: (cb: any) => cb(), cookie: {} },
      } as any;

      const result = await authService.login(
        { email: "test@example.com", password: "password", rememberMe: false },
        req,
      );

      expect(result.user?.id).toBe(mockUser.id);
      expect(req.session.userId).toBe(mockUser.id);
      expect(userRepository.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ userId: mockUser.id, sessionToken: req.sessionID }));
    });
  });

  describe("verifyEmail", () => {
    it("should verify user when token is valid", async () => {
      await authService.verifyEmail("valid-token");

      expect(consumeEmailVerificationToken).toHaveBeenCalledWith("valid-token", { initialOnly: true, request: undefined });
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it("should throw error if token expired", async () => {
      vi.mocked(consumeEmailVerificationToken).mockRejectedValueOnce(new ValidationError("Verification token expired"));

      await expect(authService.verifyEmail("expired-token")).rejects.toThrow(
        ValidationError,
      );
    });

    it("should throw error if token invalid", async () => {
      vi.mocked(consumeEmailVerificationToken).mockRejectedValueOnce(new ValidationError("Invalid verification token"));
      await expect(authService.verifyEmail("invalid-token")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("resendVerification", () => {
    it("should generate new token if user found and unverified", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        emailVerified: false,
      };

      (userRepository.findByEmail as any).mockResolvedValue(mockUser);

      vi.mocked(issueInitialEmailVerification).mockResolvedValueOnce({ userId: mockUser.id, email: mockUser.email, token: "synthetic-issued-token" });

      await authService.resendVerification("test@example.com");

      expect(issueInitialEmailVerification).toHaveBeenCalledWith("test@example.com");
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it("should do nothing if user already verified", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        emailVerified: true,
      };

      (userRepository.findByEmail as any).mockResolvedValue(mockUser);

      await authService.resendVerification("test@example.com");

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });
});
