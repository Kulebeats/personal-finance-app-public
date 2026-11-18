import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../auth.service";
import { userRepository } from "../../../repositories/UserRepository";
import { ForbiddenError, ValidationError } from "../../../core/errors";

// Mock dependencies
vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findById: vi.fn(),
    findByVerificationToken: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createLoginHistory: vi.fn(),
    createDisplaySettings: vi.fn(),
    findSessions: vi.fn(),
    upsertSession: vi.fn(),
  },
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

vi.mock("../auth.mfa-policy", () => ({
  checkMfaPolicy: vi.fn().mockResolvedValue({ suggestEnrollment: false }),
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
        session: { regenerate: (cb: any) => cb(), cookie: {} },
      } as any;

      await authService.register(
        {
          email: "new@example.com",
          username: "newuser",
          password: "Password1!",
          fullName: "New User",
        },
        req,
      );

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: false,
          emailVerificationToken: expect.any(String),
          emailVerificationExpiry: expect.any(Date),
        }),
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
      ).rejects.toThrow(ForbiddenError);
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
        session: { regenerate: (cb: any) => cb(), cookie: {} },
      } as any;

      const result = await authService.login(
        { email: "test@example.com", password: "password", rememberMe: false },
        req,
      );

      expect(result.user).toBeDefined();
    });
  });

  describe("verifyEmail", () => {
    it("should verify user when token is valid", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        emailVerified: false,
        emailVerificationExpiry: new Date(Date.now() + 10000), // Valid
      };

      (userRepository.findByVerificationToken as any).mockResolvedValue(
        mockUser,
      );

      await authService.verifyEmail("valid-token");

      expect(userRepository.update).toHaveBeenCalledWith("user-1", {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      });
    });

    it("should throw error if token expired", async () => {
      const mockUser = {
        id: "user-1",
        emailVerificationExpiry: new Date(Date.now() - 10000), // Expired
      };

      (userRepository.findByVerificationToken as any).mockResolvedValue(
        mockUser,
      );

      await expect(authService.verifyEmail("expired-token")).rejects.toThrow(
        ValidationError,
      );
    });

    it("should throw error if token invalid", async () => {
      (userRepository.findByVerificationToken as any).mockResolvedValue(null);
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

      await authService.resendVerification("test@example.com");

      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          emailVerificationToken: expect.any(String),
          emailVerificationExpiry: expect.any(Date),
        }),
      );
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
