import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../auth.service";
import { userRepository } from "../../../repositories/UserRepository";
import * as authMfaPolicy from "../auth.mfa-policy";

// Mock dependencies
vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    createLoginHistory: vi.fn(),
    findSessions: vi.fn(),
    upsertSession: vi.fn(),
  },
}));

vi.mock("../auth.mfa-policy", () => ({
  checkMfaPolicy: vi.fn(),
}));

vi.mock("../../../auth", () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
  hashPassword: vi.fn(),
  validatePasswordComplexity: vi.fn().mockReturnValue({ valid: true }),
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

vi.mock("../auth.mfa.service", () => ({
  authMfaService: {
    beginMfaLogin: vi.fn(),
  },
}));

vi.mock("../../services/AuditService", () => ({
  auditService: {
    log: vi.fn(),
    AuditEventType: {},
  },
  AuditEventType: {},
}));

vi.mock("../../utils/logger", () => ({
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

describe("Auth Service - MFA Policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("login", () => {
    it("should return suggestMfa=true when policy recommends enrollment", async () => {
      // Mock user
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        passwordHash: "hash",
        mfaEnabled: false,
        emailVerified: true,
      };

      // Setup successful login mocks
      (userRepository.findByEmail as any).mockResolvedValue(mockUser);
      // verifyPassword mocked in factory to return true
      (userRepository.update as any).mockResolvedValue({});

      // Mock policy check to suggest enrollment
      (authMfaPolicy.checkMfaPolicy as any).mockResolvedValue({
        suggestEnrollment: true,
        requireEnrollment: false,
        reason: "Role-based suggestion",
      });

      const req = {
        ip: "127.0.0.1",
        headers: {},
        session: {
          regenerate: (cb: any) => cb(),
          cookie: {},
          userId: null,
        },
      } as any;

      const result = await authService.login(
        { email: "test@example.com", password: "password", rememberMe: false },
        req,
      );

      expect(result.suggestMfa).toBe(true);
      expect(authMfaPolicy.checkMfaPolicy).toHaveBeenCalledWith("user-1");
    });
  });
});
