import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { User } from "@shared/schema";
import authRoutes from "../auth.routes";
import { userRepository } from "../../../repositories/UserRepository";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { householdGuard } from "../../../middleware/householdGuard";
import { apiErrorMiddleware } from "../../../utils/errorHandler";

vi.mock("../../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));
vi.mock("../../../repositories/HouseholdRepository", () => ({ householdRepository: { findByUserId: vi.fn(), findMember: vi.fn() } }));
vi.mock("../../../utils/logger", () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), requestError: vi.fn() } }));
vi.mock("../../../middleware/rateLimit", () => ({ authLimiter: vi.fn((_req, _res, next) => next()), ipAuthLimiter: vi.fn((_req, _res, next) => next()), strictLimiter: vi.fn((_req, _res, next) => next()) }));
vi.mock("../auth.controller", () => ({
  authController: Object.fromEntries(["register", "login", "verifyMfa", "resendMfa", "verifyEmail", "resendVerification", "forgotPassword", "resetPassword", "logout", "getCurrentUser"]
    .map((name) => [name, vi.fn((_req, res) => res.json({ reached: name }))])),
}));

const userId = "00000000-0000-4000-8000-000000000001";
const householdId = "00000000-0000-4000-8000-000000000002";
const current = { id: userId, email: "synthetic@example.invalid", displayName: null, emailVerified: true, mfaEnabled: true, securityGeneration: 2, erasedAt: null, passwordHash: "valid-hash", mfaCode: "must-not-leak" } as User;
const subject = { id: userId, email: current.email, displayName: null };
function appFor(identity: Record<string, unknown> = { userId, securityGeneration: 2 }) {
  const app = express();
  // This isolated read-only route fixture supplies only identity fields. The
  // mounted PostgreSQL suite exercises real express-session persistence.
  app.use((req, _res, next) => { req.session = { ...identity } as unknown as typeof req.session; next(); });
  app.use("/auth", authRoutes);
  app.get("/protected", householdGuard, (req, res) => res.json(req.householdContext));
  app.use(apiErrorMiddleware);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.findById).mockResolvedValue(current);
  vi.mocked(householdRepository.findByUserId).mockResolvedValue({ id: householdId } as never);
  vi.mocked(householdRepository.findMember).mockResolvedValue({ role: "owner" } as never);
});

describe("R02 read-only session bootstrap routing and minimal snapshots", () => {
  it("returns anonymous with no session identity or user lookup", async () => {
    const response = await request(appFor({})).get("/auth/session").expect(200);
    expect(response.body).toEqual({ success: true, data: { state: "anonymous" } });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary?.split(/,\s*/)).toContain("Cookie");
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  });
  it("returns pending status before any household lookup, including a valid membership", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ ...current, emailVerified: false });
    const response = await request(appFor()).get("/auth/session").expect(200);
    expect(response.body).toEqual({ success: true, data: { state: "verification_pending", subject } });
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it("returns MFA-only state after current identity validation without promoting it", async () => {
    const response = await request(appFor({ mfaPendingUserId: userId, mfaPendingSecurityGeneration: 2 })).get("/auth/session").expect(200);
    expect(response.body).toEqual({ success: true, data: { state: "mfa_pending" } });
    expect(userRepository.findById).toHaveBeenCalledWith(userId);
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  });
  it("returns verified household-free status only for a successful empty membership lookup", async () => {
    vi.mocked(householdRepository.findByUserId).mockResolvedValue(undefined);
    const response = await request(appFor()).get("/auth/session").expect(200);
    expect(response.body).toEqual({ success: true, data: { state: "verified_without_household", subject } });
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it("returns minimal ready status and the same known role as implicit protected requests", async () => {
    const app = appFor();
    const response = await request(app).get("/auth/session").expect(200);
    const protectedResponse = await request(app).get("/protected").expect(200);
    expect(response.body).toEqual({ success: true, data: { state: "ready", subject, household: { id: householdId, role: "owner" } } });
    expect(protectedResponse.body).toEqual({ householdId, userId, role: "owner" });
  });
  it.each([undefined, { role: "unknown" }])("denies inconsistent or unknown membership for bootstrap and implicit guard", async (membership) => {
    vi.mocked(householdRepository.findMember).mockResolvedValue(membership as never);
    for (const route of ["/auth/session", "/protected"]) {
      const response = await request(appFor()).get(route).expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
  });
  it.each(["user", "household", "member"])("preserves %s lookup errors as safe 5xx", async (source) => {
    const error = new Error("synthetic lookup secret");
    if (source === "user") vi.mocked(userRepository.findById).mockRejectedValue(error);
    if (source === "household") vi.mocked(householdRepository.findByUserId).mockRejectedValue(error);
    if (source === "member") vi.mocked(householdRepository.findMember).mockRejectedValue(error);
    const response = await request(appFor()).get("/auth/session").expect(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(error.message);
  });
  it.each([undefined, { ...current, erasedAt: new Date() }, { ...current, passwordHash: "!erased!sentinel" }, { ...current, securityGeneration: 3 }])("invalid current user yields anonymous for cookie and MFA identities", async (user) => {
    vi.mocked(userRepository.findById).mockResolvedValue(user);
    for (const identity of [{ userId, securityGeneration: 2 }, { mfaPendingUserId: userId, mfaPendingSecurityGeneration: 2 }]) {
      expect((await request(appFor(identity)).get("/auth/session").expect(200)).body).toEqual({ success: true, data: { state: "anonymous" } });
    }
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  });
  it("rejects ambiguous simultaneous identities without user or household lookup", async () => {
    await request(appFor({ userId, securityGeneration: 2, mfaPendingUserId: userId, mfaPendingSecurityGeneration: 2 })).get("/auth/session").expect(401);
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  });
  it("pending session can reach only the own-identity and logout controller routes", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({ ...current, emailVerified: false });
    expect((await request(appFor()).get("/auth/me").expect(200)).body).toEqual({ reached: "getCurrentUser" });
    expect((await request(appFor()).post("/auth/logout").expect(200)).body).toEqual({ reached: "logout" });
  });
});
