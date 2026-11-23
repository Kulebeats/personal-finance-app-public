import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { householdGuard, householdGuardWithId } from "../householdGuard";
import { requireRole } from "../validateEntity";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import type { User } from "@shared/schema";

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: { findByUserId: vi.fn(), findMember: vi.fn() },
}));
vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));
vi.mock("../../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const knownRoles = ["owner", "admin", "member", "view_only", "professional"] as const;
const invalidRoles = ["OWNER", "operator", "", "__proto__", "constructor", undefined];
const verifiedUserId = "00000000-0000-4000-8000-000000000001";
const verifiedHouseholdId = "00000000-0000-4000-8000-000000000002";

function boundary(role?: unknown) {
  const req = {
    session: { userId: "actor" }, params: { householdId: "home" }, body: {},
    householdContext: role === undefined ? undefined : {
      householdId: "home", userId: "actor", role,
    },
  } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return { req, res: res as unknown as Response, next: vi.fn() as NextFunction };
}

// Only the membership-guard cases require an authenticated verified actor.
// Legacy role-adapter cases below retain their independent context fixtures.
function verifiedBoundary() {
  const fixture = boundary();
  fixture.req.session.userId = verifiedUserId;
  fixture.req.session.securityGeneration = 0;
  fixture.req.params.householdId = verifiedHouseholdId;
  vi.mocked(userRepository.findById).mockResolvedValue({
    id: verifiedUserId, emailVerified: true, mfaEnabled: true, securityGeneration: 0, erasedAt: null, passwordHash: "synthetic-context-hash",
  } as User);
  return fixture;
}

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["resolved household", householdGuard], ["explicit household", householdGuardWithId],
] as const)("R04 context: %s", (_label, guard) => {
  it.each(knownRoles)("attaches current known role %s", async (role) => {
    const { req, res, next } = verifiedBoundary();
    vi.mocked(householdRepository.findByUserId).mockResolvedValue({ id: verifiedHouseholdId } as never);
    vi.mocked(householdRepository.findMember).mockResolvedValue({ role } as never);
    await guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.householdContext).toEqual({ householdId: verifiedHouseholdId, userId: verifiedUserId, role });
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(invalidRoles)("denies unknown stored role %s at a controlled seam", async (role) => {
    const { req, res, next } = verifiedBoundary();
    vi.mocked(householdRepository.findByUserId).mockResolvedValue({ id: verifiedHouseholdId } as never);
    vi.mocked(householdRepository.findMember).mockResolvedValue({ role } as never);
    await guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(req.householdContext).toBeUndefined();
  });
});

// Literal independent expectations: do not derive these sets from the implementation.
describe.each([
  ["owner", ["owner"]],
  ["admin", ["owner", "admin"]],
  ["member", ["owner", "admin", "member"]],
  ["view_only", ["owner", "admin", "member", "view_only", "professional"]],
] as const)("R04 legacy adapter %s", (minimum, permitted: readonly string[]) => {
  it.each([...knownRoles, ...invalidRoles])("checks literal role %s", (role) => {
    const { req, res, next } = boundary(role);
    // Unknown role is present in a context, rather than exercising missing context.
    req.householdContext = { householdId: "home", userId: "actor", role } as never;
    requireRole(minimum)(req, res, next);
    if (typeof role === "string" && permitted.includes(role)) {
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    } else {
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
});
