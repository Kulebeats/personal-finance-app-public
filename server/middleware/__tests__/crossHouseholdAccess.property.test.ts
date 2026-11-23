/**
 * **Feature: settings-refactoring, Property 13: Cross-Household Access Prevention**
 * **Validates: Requirements 11.4**
 * 
 * Property: For any user attempting to access resources belonging to a household they are not a member of,
 * the system SHALL return a 403 Forbidden response.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { Request, Response, NextFunction } from "express";
import { householdGuardWithId } from "../householdGuard";
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
    findMember: vi.fn(),
  },
}));
vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: vi.fn() } }));

// These properties isolate membership/target checks for a current verified
// actor. Pending/stale/erased identity denial is covered by the R02 guard tests.
function verifiedActor(userId: string) {
  vi.mocked(userRepository.findById).mockResolvedValue({
    id: userId, emailVerified: true, mfaEnabled: true, securityGeneration: 0, erasedAt: null, passwordHash: "synthetic-cross-household-hash",
  } as User);
}

describe("Property 13: Cross-Household Access Prevention", () => {
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
      params: {},
      body: {},
    };
    
    mockResponse = {
      status: statusMock as unknown as Response["status"],
      json: jsonMock as unknown as Response["json"],
    };
    
    mockNext = vi.fn();
    
    vi.clearAllMocks();
  });

  it("should deny access when user attempts to access another household's resources", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          userHouseholdId: fc.uuid(),
          targetHouseholdId: fc.uuid(),
        }).filter(r => r.userHouseholdId !== r.targetHouseholdId), // Ensure different households
        async ({ userId, targetHouseholdId }) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup: User tries to access a different household's resources
          mockRequest = {
            session: { userId } as any,
            params: { householdId: targetHouseholdId },
            body: {},
          };
          verifiedActor(userId);
          
          // User is NOT a member of the target household
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce(
            NO_MEMBER,
          );

          await householdGuardWithId(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: System should return 403 and not call next()
          expect(statusMock).toHaveBeenCalledWith(403);
          expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              error: expect.objectContaining({
                code: "FORBIDDEN",
                message: expect.stringContaining("another household"),
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

  it("should allow access when user is a member of the target household", async () => {
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
          
          // Setup: User is a member of the target household
          mockRequest = {
            session: { userId } as any,
            params: { householdId },
            body: {},
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce({
            id: "00000000-0000-0000-0000-000000000000",
            householdId,
            userId,
            role,
            joinedAt: new Date(),
            lastActiveAt: null,
          });

          await householdGuardWithId(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: System should allow access and call next()
          expect(mockNext).toHaveBeenCalled();
          expect(statusMock).not.toHaveBeenCalledWith(403);
          expect(mockRequest.householdContext).toBeDefined();
          expect(mockRequest.householdContext?.householdId).toBe(householdId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should verify household membership for the specific target household", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          targetHouseholdId: fc.uuid(),
        }),
        async ({ userId, targetHouseholdId }) => {
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
            params: { householdId: targetHouseholdId },
            body: {},
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce(
            NO_MEMBER,
          );

          await householdGuardWithId(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Membership check should be for the specific target household
          expect(householdRepository.findMember).toHaveBeenCalledWith(
            targetHouseholdId,
            userId
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle household ID from request body", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          targetHouseholdId: fc.uuid(),
        }),
        async ({ userId, targetHouseholdId }) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup: Household ID in body instead of params
          mockRequest = {
            session: { userId } as any,
            params: {},
            body: { householdId: targetHouseholdId },
          };
          verifiedActor(userId);
          
          vi.mocked(householdRepository.findMember).mockResolvedValueOnce(
            NO_MEMBER,
          );

          await householdGuardWithId(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Should check membership for household ID from body
          expect(householdRepository.findMember).toHaveBeenCalledWith(
            targetHouseholdId,
            userId
          );
          expect(statusMock).toHaveBeenCalledWith(403);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should return 400 when household ID is missing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (userId) => {
          // Reset mocks for each iteration
          vi.clearAllMocks();
          jsonMock = vi.fn();
          statusMock = vi.fn(() => ({ json: jsonMock }));
          mockResponse.status = statusMock as unknown as Response["status"];
          mockResponse.json = jsonMock as unknown as Response["json"];
          mockNext = vi.fn();
          
          // Setup: No household ID provided
          mockRequest = {
            session: { userId } as any,
            params: {},
            body: {},
          };
          verifiedActor(userId);

          await householdGuardWithId(
            mockRequest as Request,
            mockResponse as Response,
            mockNext
          );

          // Property: Should return 400 for missing household ID
          expect(statusMock).toHaveBeenCalledWith(400);
          expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              error: expect.objectContaining({
                code: "BAD_REQUEST",
              }),
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
          expect(householdRepository.findMember).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
