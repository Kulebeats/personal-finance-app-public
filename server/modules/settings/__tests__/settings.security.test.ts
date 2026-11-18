import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { settingsController } from "../settings.controller";
import { userRepository } from "../../../repositories/UserRepository";
import * as auth from "../../../auth";
import * as passwordHistory from "../../auth/auth.password-history";

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
  wasPasswordUsedRecently: vi.fn(),
  recordPasswordInHistory: vi.fn(),
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
      passwordHash: "$2b$10$hashedcurrentpassword",
    };

    it("should prevent password reuse", async () => {
      // Setup mocks
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);
      vi.mocked(auth.verifyPassword).mockResolvedValue(true);
      // wasPasswordUsedRecently returns true (reuse detected)
      vi.mocked(passwordHistory.wasPasswordUsedRecently).mockResolvedValue(
        true,
      );

      const res = await request(app).put("/api/settings/password").send({
        currentPassword: "currentpassword",
        newPassword: "oldpassword",
        confirmPassword: "oldpassword",
      });

      expect(res.status).toBe(400); // ValidationError
      expect(res.body.error.message).toMatch(/cannot reuse/);
      expect(passwordHistory.wasPasswordUsedRecently).toHaveBeenCalledWith(
        "user-123",
        "oldpassword",
      );
      // Should NOT update password
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it("should record history on successful change", async () => {
      // Setup mocks
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);
      vi.mocked(auth.verifyPassword).mockResolvedValue(true);
      vi.mocked(passwordHistory.wasPasswordUsedRecently).mockResolvedValue(
        false,
      );
      vi.mocked(userRepository.update).mockResolvedValue({} as any);

      const res = await request(app).put("/api/settings/password").send({
        currentPassword: "currentpassword",
        newPassword: "newpassword123",
        confirmPassword: "newpassword123",
      });

      expect(res.status).toBe(200);

      // Should check history
      expect(passwordHistory.wasPasswordUsedRecently).toHaveBeenCalled();

      // Should record OLD hash in history
      expect(passwordHistory.recordPasswordInHistory).toHaveBeenCalledWith(
        "user-123",
        mockUser.passwordHash,
      );

      // Should update the password hash (now done inside withTransaction,
      // not via userRepository.update - see mock above).
      expect(mockTxUpdateWhere).toHaveBeenCalled();

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
