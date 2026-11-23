import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { User } from "@shared/schema";
import { requireAuth, requireAuthWithUser, requirePendingAwareSessionUser } from "../../auth";
import * as auth from "../../auth";
import { householdGuard, householdGuardWithId } from "../householdGuard";
import { userRepository } from "../../repositories/UserRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";

vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));
vi.mock("../../repositories/HouseholdRepository", () => ({ householdRepository: { findByUserId: vi.fn(), findMember: vi.fn() } }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const userId = "00000000-0000-4000-8000-000000000001", householdId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const current = { id: userId, emailVerified: true, mfaEnabled: true, securityGeneration: 2, erasedAt: null, passwordHash: "valid-hash" } as User;
const guards = [["requireAuth", requireAuth], ["requireAuthWithUser", requireAuthWithUser], ["householdGuard", householdGuard], ["householdGuardWithId", householdGuardWithId], ["pendingAware", requirePendingAwareSessionUser], ["explicitAuth", auth.requireAuthForExplicitHousehold]] as const;
function setup(headers: Record<string, string | string[]> = {}) {
  const req = { session: { userId, securityGeneration: 2 }, headers, rawHeaders: [], params: { householdId }, body: {}, requestId: "synthetic-preconditions" } as unknown as Request;
  const json = vi.fn(), status = vi.fn(() => ({ json }));
  return { req, res: { status, json } as unknown as Response, status, json, next: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userRepository.findById).mockResolvedValue(current);
  vi.mocked(householdRepository.findByUserId).mockResolvedValue({ id: householdId } as never);
  vi.mocked(householdRepository.findMember).mockResolvedValue({ role: "owner" } as never);
});

describe.each(guards)("%s request identity preconditions", (_name, guard) => {
  it("rejects an originating subject that differs from the current cookie user before membership/effects", async () => {
    const fixture = setup({ "x-capital-subject": otherId });
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(409);
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "SESSION_CONTEXT_CHANGED" }) }));
    expect(JSON.stringify(fixture.json.mock.calls)).not.toContain(otherId);
    expect(fixture.next).not.toHaveBeenCalled();
    expect(householdRepository.findByUserId).not.toHaveBeenCalled();
    expect(householdRepository.findMember).not.toHaveBeenCalled();
  });
  it.each(["x-capital-subject", "x-capital-household"])("rejects malformed and duplicate %s expectations", async (header) => {
    for (const value of ["not-an-id", `${userId}, ${userId}`, [userId, userId]]) {
      const fixture = setup({ [header]: value });
      await guard(fixture.req, fixture.res, fixture.next);
      expect(fixture.status).toHaveBeenCalledWith(400);
      expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "BAD_REQUEST" }) }));
      expect(fixture.next).not.toHaveBeenCalled();
    }
    const fixture = setup({ [header]: userId });
    fixture.req.rawHeaders = [header, userId, header.toUpperCase(), userId];
    await guard(fixture.req, fixture.res, fixture.next);
    expect(fixture.status).toHaveBeenCalledWith(400);
  });
  it("retains headerless behavior and accepts an unchanged subject expectation", async () => {
    for (const headers of [{}, { "x-capital-subject": userId }] as Record<string, string | string[]>[]) {
      const fixture = setup(headers);
      await guard(fixture.req, fixture.res, fixture.next);
      expect(fixture.next).toHaveBeenCalledOnce();
    }
  });
});
it.each(guards.slice(0, 4))("%s rejects a changed household expectation before effects", async (_name, guard) => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": otherId });
  await guard(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(409);
  expect(fixture.next).not.toHaveBeenCalled();
});
it("reuses only the implicit context checked by the current request's verified guard", async () => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": householdId });
  await requireAuth(fixture.req, fixture.res, vi.fn());
  await householdGuard(fixture.req, fixture.res, fixture.next);
  expect(fixture.next).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).toHaveBeenCalledOnce();
  expect(householdRepository.findMember).toHaveBeenCalledOnce();
  expect(fixture.req.householdContext).toEqual({ userId, householdId, role: "owner" });
});
it("explicit household expectations check the requested target, independently of implicit selection", async () => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": otherId });
  fixture.req.params.householdId = otherId;
  await householdGuardWithId(fixture.req, fixture.res, fixture.next);
  expect(fixture.next).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  expect(householdRepository.findMember).toHaveBeenCalledWith(otherId, userId);
});
it("named explicit auth composes with WithId for H2 while implicit selection is H1", async () => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": otherId });
  fixture.req.params.householdId = otherId;
  const authenticated = vi.fn();
  await auth.requireAuthForExplicitHousehold(fixture.req, fixture.res, authenticated);
  expect(authenticated).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  await householdGuardWithId(fixture.req, fixture.res, fixture.next);
  expect(fixture.next).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  expect(householdRepository.findMember).toHaveBeenCalledWith(otherId, userId);
  expect(fixture.req.householdContext).toEqual({ userId, householdId: otherId, role: "owner" });
});
it("the existing headerless requireAuth then WithId chain retains its explicit target", async () => {
  const fixture = setup();
  fixture.req.params.householdId = otherId;
  const authenticated = vi.fn();
  await requireAuth(fixture.req, fixture.res, authenticated);
  expect(authenticated).toHaveBeenCalledOnce();
  await householdGuardWithId(fixture.req, fixture.res, fixture.next);
  expect(fixture.next).toHaveBeenCalledOnce();
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
  expect(fixture.req.householdContext?.householdId).toBe(otherId);
});
it("pending recovery still checks the originating subject", async () => {
  vi.mocked(userRepository.findById).mockResolvedValue({ ...current, emailVerified: false });
  const fixture = setup({ "x-capital-subject": otherId });
  await requirePendingAwareSessionUser(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(409);
  expect(fixture.next).not.toHaveBeenCalled();
});
it.each(["household", "member"])("preserves %s lookup failure while checking a household expectation", async (source) => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": householdId });
  if (source === "household") vi.mocked(householdRepository.findByUserId).mockRejectedValue(new Error("synthetic secret"));
  else vi.mocked(householdRepository.findMember).mockRejectedValue(new Error("synthetic secret"));
  await requireAuth(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(500);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(JSON.stringify(fixture.json.mock.calls)).not.toContain("synthetic secret");
});
it("controller reuse keeps the full authorized row and never performs a second selection", async () => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": householdId });
  const selected = { id: householdId, name: "Authorized H1" } as never;
  vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce(selected).mockResolvedValue({ id: otherId, name: "Replacement H2" } as never);
  await requireAuth(fixture.req, fixture.res, fixture.next);
  expect(await resolveRequestHousehold(fixture.req, userId)).toBe(selected);
  expect(householdRepository.findByUserId).toHaveBeenCalledOnce();
});
it("controller reuse preserves authoritative absence without a later fallback", async () => {
  const fixture = setup();
  vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce(undefined).mockResolvedValue({ id: otherId } as never);
  await householdGuard(fixture.req, fixture.res, fixture.next);
  expect(fixture.status).toHaveBeenCalledWith(404);
  expect(await resolveRequestHousehold(fixture.req, userId)).toBeUndefined();
  expect(householdRepository.findByUserId).toHaveBeenCalledOnce();
});
it("an attached user or context cannot substitute for the request's authoritative selection", async () => {
  const fixture = setup({ "x-capital-subject": userId, "x-capital-household": householdId });
  fixture.req.user = current;
  fixture.req.householdContext = { userId, householdId, role: "owner" };
  await expect(resolveRequestHousehold(fixture.req, userId)).rejects.toMatchObject({ statusCode: 409, code: "SESSION_CONTEXT_CHANGED" });
  expect(householdRepository.findByUserId).not.toHaveBeenCalled();
});
