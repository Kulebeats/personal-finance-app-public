import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { settingsController } from "../settings.controller";
import { userRepository } from "../../../repositories/UserRepository";
import * as auth from "../../../auth";
import * as passwordHistory from "../../auth/auth.password-history";
import { ValidationError } from "../../../core/errors";
import { enqueueSecurityNotice } from "../../../services/security-notice";

// Mock dependencies
vi.mock("@shared/schema", () => ({
  users: {},
  householdPreferences: {},
  HouseholdPreferences: {},
  User: {},
}));
vi.mock("../../../repositories/UserRepository");
vi.mock("../../../repositories/HouseholdRepository");
vi.mock("../../auth/auth.password-history", () => ({
  assertPasswordNotReused: vi.fn(),
  recordPasswordInHistory: vi.fn(),
}));
vi.mock("../../../services/session-identity", () => ({
  lockCurrentSessionCredential: vi.fn(async (_tx, user) => user),
}));
vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: { getIpAddress: vi.fn(), logUpdate: vi.fn().mockResolvedValue(undefined) },
}));
// This controller-only transaction double has no insert/query executor. Atomic
// audit/notice persistence and rollback are covered by the R01 real-PG suites.
vi.mock("../../../services/security-notice", () => ({
  enqueueSecurityNotice: vi.fn().mockResolvedValue("unit-security-event"),
}));
vi.mock("../../../auth", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("newhashedpassword"),
}));

// changePassword now wraps the password rotation + other-session revocation
// in withTransaction (Rule 10) - stub both so this stays a pure unit test
// (no real DB). The real-DB proof of revocation behavior lives in
// settings.password-change-session-revocation.realdb.integration.test.ts.
const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../utils/withTransaction", () => ({
  withTransaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
    operation({
      update: () => ({ set: () => ({ where: mockTxUpdateWhere }) }),
    }),
  ),
}));
vi.mock("../../../services/session-revocation", () => ({
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
}));

// Setup app
const app = express();
app.use(express.json());
app.use(
  session({
    secret: "test",
    resave: false,
    saveUninitialized: true,
  }),
);
// Mock session user
app.use((req, res, next) => {
  (req.session as any).userId = "user-123";
  next();
});

app.put("/api/settings/password", settingsController.changePassword);

// Mock error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.status(err.statusCode || err.status || 500).json({
      error: {
        message: err.message || "Internal Server Error",
      },
    });
  },
);

describe("Settings Controller - Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("changePassword", () => {
    const mockUser = {
      id: "user-123",
      email: "settings-security-unit@example.invalid",
      passwordHash: "$2b$10$hashedcurrentpassword",
      pendingEmail: null,
    };

    it("should prevent password reuse", async () => {
      // Setup mocks
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);
      vi.mocked(auth.verifyPassword).mockResolvedValue(true);
      vi.mocked(passwordHistory.assertPasswordNotReused).mockRejectedValue(
        new ValidationError("You cannot reuse recent passwords"),
      );

      const res = await request(app).put("/api/settings/password").send({
        currentPassword: "currentpassword",
        newPassword: "OldPassword123!",
        confirmPassword: "OldPassword123!",
      });

      expect(res.status).toBe(400); // ValidationError
      expect(res.body.error.message).toMatch(/cannot reuse/);
      expect(passwordHistory.assertPasswordNotReused).toHaveBeenCalledWith(
        expect.anything(), mockUser, "OldPassword123!",
      );
      // Should NOT update password
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(mockTxUpdateWhere).not.toHaveBeenCalled();
      expect(enqueueSecurityNotice).not.toHaveBeenCalled();
    });

    it("should record history on successful change", async () => {
      // Setup mocks
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);
      vi.mocked(auth.verifyPassword).mockResolvedValue(true);
      vi.mocked(passwordHistory.assertPasswordNotReused).mockResolvedValue(
        undefined,
      );
      vi.mocked(userRepository.update).mockResolvedValue({} as any);

      const res = await request(app).put("/api/settings/password").send({
        currentPassword: "currentpassword",
        newPassword: "NewPassword123!",
        confirmPassword: "NewPassword123!",
      });

      expect(res.status).toBe(200);

      // Should check history
      expect(passwordHistory.assertPasswordNotReused).toHaveBeenCalled();

      // Should record OLD hash in history
      expect(passwordHistory.recordPasswordInHistory).toHaveBeenCalledWith(
        "user-123",
        mockUser.passwordHash,
        expect.anything(),
      );

      // Should update the password hash (now done inside withTransaction,
      // not via userRepository.update - see mock above).
      expect(mockTxUpdateWhere).toHaveBeenCalled();
      const tx = vi.mocked(passwordHistory.recordPasswordInHistory).mock.calls[0][2];
      expect(enqueueSecurityNotice).toHaveBeenCalledExactlyOnceWith(
        tx, mockUser, expect.objectContaining({ session: expect.objectContaining({ userId: mockUser.id }) }),
        { eventType: "PASSWORD_CHANGE", kind: "password_changed", recipients: [mockUser.email], action: "password_change", sessionsRevoked: true },
      );

      // Should revoke every OTHER session, keeping the current one alive.
      const { revokeUserSessions } = await import(
        "../../../services/session-revocation"
      );
      expect(revokeUserSessions).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        expect.objectContaining({ exceptSessionId: expect.anything() }),
      );
    });
  });
});
