/**
 * **Feature: settings-refactoring, Property 12: Household Authorization Enforcement**
 * **Validates: Requirements 11.1, 11.2**
 * 
 * Property: For any request to household-scoped resources (categories, merchants, rules),
 * the system SHALL verify the requesting user is a member of that household before allowing access.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { Request, Response, NextFunction } from "express";
import { householdGuard } from "../householdGuard";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import type { User } from "@shared/schema";

// Configure fast-check to run minimum 100 iterations
fc.configureGlobal({ numRuns: 100 });

// findMember resolves to `undefined` when the user is not a member; its inferred
// return type is the non-undefined row, so coerce for the not-found mock case.
type Member = Awaited<ReturnType<typeof householdRepository.findMember>>;
const NO_MEMBER = undefined as unknown as Member;

// Mock storage
vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findByUserId: vi.fn(),
    findMember: vi.fn(),
  },
}));
vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));

// These membership properties intentionally model a current verified actor.
// Pending, stale and erased identities have independent R02 negative regressions.
function verifiedActor(userId: string) {
  vi.mocked(userRepository.findById).mockResolvedValue({
    id: userId, emailVerified: true, mfaEnabled: true, securityGeneration: 0, erasedAt: null, passwordHash: "synthetic-property-hash",
  } as User);
}

describe("Property 12: Household Authorization Enforcement", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn(() => ({ json: jsonMock }));
    
    mockRequest = {
      session: {} as any,
    };
    
    mockResponse = {
      status: statusMock as unknown as Response["status"],
      json: jsonMock as unknown as Response["json"],
    };
    
    mockNext = vi.fn();
    
    vi.clearAllMocks();
  });

  it("should verify household membership for all valid user-household combinations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          householdId: fc.uuid(),
          role: fc.constantFrom("owner", "admin", "member", "view_only"),
        }),
        async ({ userId, householdId, role }) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup: User is a member of the household
          mockRequest = {
            session: { userId } as any,
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({
            id: householdId,
            name: "Test Household",
            currency: "ZMW",
          } as any);
          
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce({
            id: "00000000-0000-0000-0000-000000000000",
            householdId,
            userId,
            role,
            joinedAt: new Date(),
            lastActiveAt: null,
          });

          await householdGuard(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Middleware should attach household context and call next()
          expect(mockRequest.householdContext).toBeDefined();
          expect(mockRequest.householdContext?.householdId).toBe(householdId);
          expect(mockRequest.householdContext?.userId).toBe(userId);
          expect(mockRequest.householdContext?.role).toBe(role);
          expect(mockNext).toHaveBeenCalled();
          expect(statusMock).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should reject access for users not in the household", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          householdId: fc.uuid(),
        }),
        async ({ userId, householdId }) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup: User is NOT a member of the household
          mockRequest = {
            session: { userId } as any,
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({
            id: householdId,
            name: "Test Household",
            currency: "ZMW",
          } as any);
          
          // Return undefined to indicate no membership
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce(
            NO_MEMBER,
          );

          await householdGuard(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Middleware should return 403 and not call next()
          expect(statusMock).toHaveBeenCalledWith(403);
          expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              error: expect.objectContaining({
                code: "FORBIDDEN",
              }),
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
          expect(mockRequest.householdContext).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should reject unauthenticated requests", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(undefined),
        async () => {
          // Setup: No userId in session (unauthenticated)
          mockRequest.session = {} as any;

          await householdGuard(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Middleware should return 401 and not call next()
          expect(statusMock).toHaveBeenCalledWith(401);
          expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              error: expect.objectContaining({
                code: "UNAUTHORIZED",
              }),
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
          expect(householdRepository.findByUserId).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle users without households", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (userId) => {
          // Setup: User has no household
          mockRequest.session = { userId } as any;
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findByUserId).mockResolvedValue(undefined);

          await householdGuard(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Middleware should return 404 and not call next()
          // FIX P7b-3: code is now the distinguishable HOUSEHOLD_NOT_FOUND
          // signal (not the generic NOT_FOUND shared by every resource type)
          // so clients can branch structurally instead of on message prose.
          expect(statusMock).toHaveBeenCalledWith(404);
          expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              error: expect.objectContaining({
                code: "HOUSEHOLD_NOT_FOUND",
              }),
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
          expect(mockRequest.householdContext).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should verify membership is checked exactly once per request", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          householdId: fc.uuid(),
          role: fc.constantFrom("owner", "admin", "member", "view_only"),
        }),
        async ({ userId, householdId, role }) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup
          mockRequest = {
            session: { userId } as any,
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({
            id: householdId,
            name: "Test Household",
            currency: "ZMW",
          } as any);
          
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce({
            id: "00000000-0000-0000-0000-000000000000",
            householdId,
            userId,
            role,
            joinedAt: new Date(),
            lastActiveAt: null,
          });

          await householdGuard(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Membership should be verified exactly once
          expect(householdRepository.findByUserId).toHaveBeenCalledTimes(1);
          expect(householdRepository.findMember).toHaveBeenCalledTimes(1);
          expect(householdRepository.findMember).toHaveBeenCalledWith(
            householdId,
            userId
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
