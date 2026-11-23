import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../auth.service";
import { userRepository } from "../../../repositories/UserRepository";

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
vi.mock("../../../services/session-identity", () => ({
  assertCurrentCredential: vi.fn().mockResolvedValue(undefined),
  registerSessionIdentity: (_user: unknown, data: unknown) => userRepository.upsertSession(data as any),
  revokeLoginSession: vi.fn().mockResolvedValue(undefined),
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
    debug: vi.fn(),
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
    it("returns the MFA grace deadline for a member without MFA (AH-11)", async () => {
      // Mock user
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        passwordHash: "hash",
        mfaEnabled: false,
        emailVerified: true,
        mfaGraceEndsAt: new Date(Date.now() + 3 * 86_400_000),
      };

      // Setup successful login mocks
      (userRepository.findByEmail as any).mockResolvedValue(mockUser);
      // verifyPassword mocked in factory to return true
      (userRepository.update as any).mockResolvedValue({});

      const req = {
        ip: "127.0.0.1",
        headers: {},
        sessionID: "policy-unit-session",
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

      expect(result.mfa).toEqual({ state: "grace", graceEndsAt: mockUser.mfaGraceEndsAt.toISOString(), daysRemaining: 3 });
      expect(result.user?.id).toBe(mockUser.id);
      expect(req.session.userId).toBe(mockUser.id);
      expect(userRepository.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ userId: mockUser.id, sessionToken: req.sessionID }));
    });
  });
});
