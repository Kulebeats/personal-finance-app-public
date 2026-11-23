import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { User } from "@shared/schema";
import { authService } from "../auth.service";
import { userRepository } from "../../../repositories/UserRepository";
import { verifyPassword } from "../../../auth";

vi.mock("../../../repositories/UserRepository", () => ({ userRepository: { findByEmail: vi.fn(), update: vi.fn(), createLoginHistory: vi.fn() } }));
vi.mock("../../../auth", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn(), validatePasswordComplexity: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
const current = { id: "00000000-0000-4000-8000-000000000001", email: "pending@example.invalid", passwordHash: "synthetic-hash", emailVerified: false, failedLoginAttempts: 0, lockedUntil: null } as User;
const input = { email: current.email, password: "SyntheticCredentials123!", rememberMe: false };
const req = { ip: "127.0.0.1", headers: {} } as Request;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.findByEmail).mockResolvedValue(current);
  vi.mocked(verifyPassword).mockResolvedValue(true);
});
describe("credential login verification denial code", () => {
  it("returns the structural verification code only after a valid credential", async () => {
    await expect(authService.login(input, req)).rejects.toMatchObject({ statusCode: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
    expect(verifyPassword).toHaveBeenCalledWith(input.password, current.passwordHash);
  });
  it("retains generic lockout denial without revealing verification state", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({ ...current, lockedUntil: new Date(Date.now() + 60000) });
    await expect(authService.login(input, req)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
  it("does not reveal verification state for an unknown address", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(undefined);
    await expect(authService.login(input, req)).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });
    expect(verifyPassword).toHaveBeenCalledOnce();
  });
  it("does not reveal verification state for an invalid password", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const failedLogin = vi.spyOn(authService, "handleFailedLogin").mockResolvedValue(undefined);
    try { await expect(authService.login(input, req)).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" }); }
    finally { failedLogin.mockRestore(); }
  });
});
