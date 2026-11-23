import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router, type Request, type Response, type NextFunction } from "express";

const state = vi.hoisted(() => ({ user: { id: "user", passwordHash: "hash" }, find: vi.fn(), verify: vi.fn(), write: vi.fn() }));
vi.mock("../../auth", () => ({ verifyPassword: state.verify, hashPassword: vi.fn(), requireAuth: vi.fn(), requireAuthAllowingMfaEnrolment: vi.fn() }));
vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: state.find } }));
vi.mock("../../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.user] }) }) }),
  update: state.write,
} }));
vi.mock("../../utils/withTransaction", () => ({ withTransaction: state.write }));
vi.mock("../../modules/settings/settings.account-deletion.service", () => ({ eraseAccount: state.write }));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { log: vi.fn() } }));
vi.mock("../AuditService", () => ({ auditService: {}, AuditEventType: {} }));
import { changeOwnPassword } from "../../modules/settings/settings.password.service";
import { settingsAccountController } from "../../modules/settings/settings.account.controller";
import { requestEmailChange } from "../security-email";
import { registerMfaAuthRoutes } from "../../routes/security.mfa.auth";

const req = { session: { userId: "user" }, body: { password: "wrong" } } as Request;
describe("C2 credential failures preserve the session error distinction (UNIT callers)", () => {
  beforeEach(() => { vi.clearAllMocks(); state.find.mockResolvedValue(state.user); state.verify.mockResolvedValue(false); });
  it.each(["password", "email", "delete", "mfa"])("%s returns INVALID_CREDENTIALS before writes", async kind => {
    let error: unknown;
    const next: NextFunction = value => { error = value; };
    if (kind === "password") await changeOwnPassword(req, "wrong", "NewPassword123!").catch(value => { error = value; });
    if (kind === "email") await requestEmailChange(req, "new@example.invalid", "wrong").catch(value => { error = value; });
    if (kind === "delete") await settingsAccountController.deleteAccount(req, {} as Response, next);
    if (kind === "mfa") {
      const router = Router(); registerMfaAuthRoutes(router);
      const route = router.stack.find(layer => layer.route?.path === "/disable")!.route!;
      // R06.1: disable needs password + emailed code; a wrong password still fails first.
      await route.stack[route.stack.length - 1].handle({ ...req, body: { password: "wrong", code: "123456" } } as Request, {} as Response, next);
    }
    expect(error).toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });
    expect(state.write).not.toHaveBeenCalled();
  });
  it.each(["password", "email"])("%s missing identity still returns UNAUTHORIZED", async kind => {
    state.find.mockResolvedValue(undefined);
    await expect(kind === "password" ? changeOwnPassword(req, "wrong", "NewPassword123!") : requestEmailChange(req, "new@example.invalid", "wrong"))
      .rejects.toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
  });
});
