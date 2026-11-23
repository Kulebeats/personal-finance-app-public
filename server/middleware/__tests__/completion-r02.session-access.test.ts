import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { User } from "@shared/schema";
import { requireAuth, requireAuthWithUser, requireAuthForExplicitHousehold } from "../../auth";
import { householdGuard, householdGuardWithId } from "../householdGuard";
import { userRepository } from "../../repositories/UserRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";

vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));
vi.mock("../../repositories/HouseholdRepository", () => ({ householdRepository: { findByUserId: vi.fn(), findMember: vi.fn() } }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));

const userId = "00000000-0000-4000-8000-000000000001";
const householdId = "00000000-0000-4000-8000-000000000002";
const current = { id: userId, emailVerified: true, mfaEnabled: true, securityGeneration: 2, erasedAt: null, passwordHash: "valid-hash" } as User;
const guards = [["requireAuth", requireAuth], ["requireAuthWithUser", requireAuthWithUser], ["householdGuard", householdGuard], ["householdGuardWithId", householdGuardWithId], ["requireAuthForExplicitHousehold", requireAuthForExplicitHousehold]] as const;
function setup(identity: Record<string, unknown> = { userId, securityGeneration: 2 }) {
  const destroy = vi.fn((callback) => callback(null));
  const req = { session: { ...identity, destroy }, params: { householdId }, body: {}, requestId: "synthetic-r02" } as unknown as Request;
  const json = vi.fn(), status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  return { req, res, json, status, destroy, next: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.findById).mockResolvedValue(current);
  vi.mocked(householdRepository.findByUserId).mockResolvedValue({ id: householdId } as never);
  vi.mocked(householdRepository.findMember).mockResolvedValue({ role: "owner" } as never);
});

describe.each(guards)("R02 %s verifies current identity before downstream work", (_name, guard) => {
  it("denies pending verification even with a cached verified user and valid membership", async () => {
    const fixture = setup();
    fixture.req.user = current;
    vi.mocked(userRepository.findById).mockResolvedValue({ ...current, emailVerified: false });
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(403);
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "EMAIL_VERIFICATION_REQUIRED" }) }));
    expect(fixture.next).not.toHaveBeenCalled();
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it.each([{}, { mfaPendingUserId: userId, mfaPendingSecurityGeneration: 2 }])("denies anonymous and MFA-only identities without promoting the session", async (identity) => {
    const fixture = setup(identity);
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(401);
    expect(fixture.req.session.userId).toBeUndefined();
    expect(fixture.next).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it.each([
    undefined, { ...current, erasedAt: new Date() }, { ...current, passwordHash: "!erased!sentinel" },
    { ...current, securityGeneration: 3 },
  ])("rejects deleted, erased and generation-stale identity", async (user) => {
    const fixture = setup();
    vi.mocked(userRepository.findById).mockResolvedValue(user);
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(401);
    expect(fixture.next).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it("fails closed on simultaneous authenticated and pending MFA identities", async () => {
    const fixture = setup({ userId, securityGeneration: 2, mfaPendingUserId: userId });
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(401);
    expect(fixture.next).not.toHaveBeenCalled();
  });
  it("preserves lookup failures as server errors", async () => {
    const fixture = setup();
    vi.mocked(userRepository.findById).mockRejectedValue(new Error("synthetic lookup unavailable"));
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(500);
    expect(fixture.next).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it("allows a current verified identity", async () => {
    const fixture = setup();
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.next).toHaveBeenCalledOnce();
    expect(fixture.req.user).toEqual(current);
  });
});
it("explicit household parsing occurs only after verification", async () => {
  const fixture = setup();
  Object.defineProperty(fixture.req, "params", { get: () => { throw new Error("params must not be read"); } });
  vi.mocked(userRepository.findById).mockResolvedValue({ ...current, emailVerified: false });
  await householdGuardWithId(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(403);
  expect(fixture.next).not.toHaveBeenCalled();
});
it("explicit household guard checks its supplied target independently of implicit selection", async () => {
  const fixture = setup(), target = "00000000-0000-4000-8000-000000000003";
  fixture.req.params.householdId = target;
  vi.mocked(householdRepository.findMember).mockResolvedValue({ role: "professional" } as never);
  await householdGuardWithId(fixture.req, fixture.res, fixture.next);
  expect(fixture.next).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  expect(householdRepository.findMember).toHaveBeenCalledWith(target, userId);
  expect(fixture.req.householdContext).toEqual({ householdId: target, userId, role: "professional" });
});
it.each([["implicit", householdGuard], ["explicit", householdGuardWithId]] as const)("%s household guard rejects unknown roles and preserves membership failures", async (_name, guard) => {
  const fixture = setup();
  vi.mocked(householdRepository.findMember).mockResolvedValue({ role: "unknown" } as never);
  await guard(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(403);
  expect(fixture.next).not.toHaveBeenCalled();
  const unavailable = setup();
  vi.mocked(householdRepository.findMember).mockRejectedValue(new Error("synthetic membership unavailable"));
  await guard(unavailable.req, unavailable.res, unavailable.next);
  expect(unavailable.status).toHaveBeenCalledWith(500);
  expect(unavailable.next).not.toHaveBeenCalled();
});
