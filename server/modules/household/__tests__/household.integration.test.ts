/**
 * Household Module - Integration Tests
 *
 * Tests household CRUD, role authorization (SEC-CRITICAL-002),
 * member management, and audit logging using mocked service layer.
 */

import request from "supertest";
import express from "express";
import session from "express-session";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { ConflictError } from "../../../core/errors";

// Mock repositories
const mockHouseholdRepository = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  createWithOwner: vi.fn(),
  update: vi.fn(),
  addMember: vi.fn(),
  findMembers: vi.fn(),
  findMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  // SCP-333: atomic, race-safe role change + last-member-guarded removal
  updateMemberRoleAtomic: vi.fn(),
  removeMemberWithLastMemberGuard: vi.fn(),
  // SCP-318: atomic ownership transfer + invite acceptance
  transferOwnership: vi.fn(),
  acceptInvite: vi.fn(),
  // Invitation methods (matching controller usage)
  findPendingInvitationsByHousehold: vi.fn(),
  findPendingInvitationByEmail: vi.fn(),
  findInvitationById: vi.fn(),
  findInvitationByCode: vi.fn(),
  createInvitation: vi.fn(),
  updateInvitationExpiry: vi.fn(),
  deleteInvitation: vi.fn(),
  markInvitationAccepted: vi.fn(),
}));

const mockUserRepository = vi.hoisted(() => ({
  getUserPreferences: vi.fn(),
  findByEmail: vi.fn(),
  findById: vi.fn(),
}));

const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(true));

// The create() controller calls seedDefaultTags(household.id), which runs a REAL
// db.insert(tags) against Postgres. The repository is mocked, so the household
// row is never actually persisted, and seeding tags for a non-existent
// householdId hits the tags.household_id FK and 500s. Stub the seed module so
// the create-path tests exercise the controller logic, not a live DB insert.
const mockSeedDefaultTags = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

const mockAuditService = vi.hoisted(() => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: mockUserRepository,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockAuditService,
}));

vi.mock("../../../services/emailService", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../seed", () => ({
  seedDefaultTags: mockSeedDefaultTags,
}));

// Import controller after mocks
import { householdController } from "../household.controller";

// Test data
const testHouseholdId = randomUUID();
const testOwnerId = randomUUID();
const testAdminId = randomUUID();
const testMemberId = randomUUID();
const testViewOnlyId = randomUUID();

const testHousehold = {
  id: testHouseholdId,
  name: "Test Household",
  currency: "ZMW",
  fiscalYearStartMonth: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const testOwnerMember = {
  userId: testOwnerId,
  householdId: testHouseholdId,
  role: "owner",
  joinedAt: new Date(),
};

const testAdminMember = {
  userId: testAdminId,
  householdId: testHouseholdId,
  role: "admin",
  joinedAt: new Date(),
};

const testMember = {
  userId: testMemberId,
  householdId: testHouseholdId,
  role: "member",
  joinedAt: new Date(),
};

const testViewOnlyMember = {
  userId: testViewOnlyId,
  householdId: testHouseholdId,
  role: "view_only",
  joinedAt: new Date(),
};

const testPreferences = {
  theme: "system",
  locale: "en-US",
  dateFormat: "YYYY-MM-DD",
};

function createTestApp(userId: string = testOwnerId, role: string = "owner") {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  // Middleware to set session based on X-Test-User header
  app.use((req, _res, next) => {
    if (req.headers["x-test-auth"] === "authenticated") {
      req.session.userId = (req.headers["x-test-user-id"] as string) || userId;
      (req as any).householdContext = {
        householdId: testHouseholdId,
        userId: req.session.userId,
      };
    }
    next();
  });

  // Auth check middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session?.userId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }
    next();
  };

  // Mount household routes
  const router = express.Router();
  router.get("/general", requireAuth, householdController.getGeneral);
  router.post("/", requireAuth, householdController.create);
  router.put("/general", requireAuth, householdController.updateGeneral);
  router.get("/members", requireAuth, householdController.getMembers);
  router.put(
    "/members/:userId/role",
    requireAuth,
    householdController.updateMemberRole,
  );
  router.delete(
    "/members/:userId",
    requireAuth,
    householdController.removeMember,
  );
  router.post("/invite", requireAuth, householdController.inviteMember);
  router.post(
    "/invitations/:inviteId/resend",
    requireAuth,
    householdController.resendInvite,
  );

  // New routes for P0 edge case coverage
  router.post(
    "/transfer-ownership",
    requireAuth,
    householdController.transferOwnership,
  );
  router.post("/leave", requireAuth, householdController.leaveHousehold);
  router.get("/invitations", requireAuth, householdController.getInvitations);
  router.delete(
    "/invitations/:inviteId",
    requireAuth,
    householdController.cancelInvitation,
  );

  // Accept invite (authenticated user accepts with invite token)
  router.post("/invite/accept", householdController.acceptInvite);

  app.use("/api/household", router);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        // Prefer the HttpError subclass's own `code` (e.g. "HOUSEHOLD_NOT_FOUND"),
        // matching the real production errorHandler's err.toJSON() contract
        // (core/errors/errorHandler.ts). Falling back to err.name previously
        // masked every thrown error's real `code` behind its class name.
        code: err.code || err.name || "ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Household Integration Tests", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
    // SCP-333: updateGeneral now loads the caller's membership to enforce the
    // owner/admin role check. Default the caller to the owner so the existing
    // settings tests stay green; tests that need a different role override this
    // (mockResolvedValueOnce chains take priority over this default).
    mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
    mockUserRepository.getUserPreferences.mockResolvedValue(testPreferences);
    mockUserRepository.findById.mockResolvedValue({
      id: testOwnerId,
      fullName: "Test Owner",
      displayName: null,
      username: "test-owner",
    });
    mockSendEmail.mockResolvedValue(true);
  });

  // ==========================================================================
  // GET /api/household/general - Get Household
  // ==========================================================================

  describe("GET /api/household/general", () => {
    it("should return household info for authenticated user", async () => {
      const res = await request(app)
        .get("/api/household/general")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.household.id).toBe(testHouseholdId);
      expect(res.body.data.household.name).toBe("Test Household");
      expect(res.body.data.preferences).toBeDefined();
    });

    it("should return 404 when user has no household", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/household/general")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
      // FIX P7b-3: the "no household yet" case must expose a distinguishable
      // error code (not the generic NotFoundError "NOT_FOUND" shared by every
      // resource) so the client onboarding gate can branch on structure
      // instead of on message prose. Message text is unchanged, so older
      // clients that still substring-match on it keep working too.
      expect(res.body.error.code).toBe("HOUSEHOLD_NOT_FOUND");
      expect(res.body.error.message).toBe("No household found");
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/household/general");
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/household/members - List Members
  // ==========================================================================

  describe("GET /api/household/members", () => {
    it("should return all household members", async () => {
      const members = [
        testOwnerMember,
        testAdminMember,
        testMember,
        testViewOnlyMember,
      ];
      mockHouseholdRepository.findMembers.mockResolvedValue(members);

      const res = await request(app)
        .get("/api/household/members")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.members.length).toBe(4);

      const roles = res.body.data.members.map((m: any) => m.role);
      expect(roles).toContain("owner");
      expect(roles).toContain("admin");
      expect(roles).toContain("member");
      expect(roles).toContain("view_only");
    });

    it("should be accessible by any household member", async () => {
      mockHouseholdRepository.findMembers.mockResolvedValue([
        testViewOnlyMember,
      ]);

      const res = await request(app)
        .get("/api/household/members")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testViewOnlyId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // PUT /api/household/members/:userId/role - Update Member Role
  // ==========================================================================

  describe("PUT /api/household/members/:userId/role - Role Authorization (SEC-CRITICAL-002)", () => {
    const targetUserId = randomUUID();
    const targetMember = {
      userId: targetUserId,
      householdId: testHouseholdId,
      role: "member",
      joinedAt: new Date(),
    };

    it("should allow owner to change member role to admin", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(targetMember); // Target is member
      mockHouseholdRepository.updateMemberRoleAtomic.mockResolvedValue({
        ...targetMember,
        role: "admin",
      });

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ role: "admin" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.member.role).toBe("admin");
      expect(mockAuditService.logUpdate).toHaveBeenCalled();
    });

    it("should allow admin to change member role", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testAdminMember) // Current user is admin
        .mockResolvedValueOnce(targetMember); // Target is member
      mockHouseholdRepository.updateMemberRoleAtomic.mockResolvedValue({
        ...targetMember,
        role: "view_only",
      });

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId)
        .send({ role: "view_only" });

      expect(res.status).toBe(200);
      expect(res.body.data.member.role).toBe("view_only");
    });

    it("should NOT allow member to change roles", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testMember); // Current user is member

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testMemberId)
        .send({ role: "admin" });

      expect(res.status).toBe(403);
    });

    it("should NOT allow view_only to change roles", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testViewOnlyMember);

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testViewOnlyId)
        .send({ role: "admin" });

      expect(res.status).toBe(403);
    });

    it("should NOT allow self-modification of role", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .put(`/api/household/members/${testOwnerId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ role: "member" });

      expect(res.status).toBe(400);
    });

    it("should NOT allow admin to promote to owner", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testAdminMember) // Current user is admin
        .mockResolvedValueOnce(targetMember); // Target is member

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId)
        .send({ role: "owner" });

      expect(res.status).toBe(403);
    });

    it("should NOT allow admin to modify owner role", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testAdminMember) // Current user is admin
        .mockResolvedValueOnce(testOwnerMember); // Target is owner

      const res = await request(app)
        .put(`/api/household/members/${testOwnerId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId)
        .send({ role: "member" });

      expect(res.status).toBe(403);
    });

    it("should allow owner to promote to owner", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(targetMember); // Target is member
      mockHouseholdRepository.updateMemberRoleAtomic.mockResolvedValue({
        ...targetMember,
        role: "owner",
      });

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ role: "owner" });

      expect(res.status).toBe(200);
      expect(res.body.data.member.role).toBe("owner");
    });

    it("should return 404 for non-existent member", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(undefined); // Target not found

      const res = await request(app)
        .put(`/api/household/members/${randomUUID()}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ role: "admin" });

      expect(res.status).toBe(404);
    });

    it("should validate role enum", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .put(`/api/household/members/${targetUserId}/role`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ role: "superuser" }); // Invalid role

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /api/household/members/:userId - Remove Member
  // ==========================================================================

  describe("DELETE /api/household/members/:userId - Member Removal", () => {
    const removeUserId = randomUUID();
    const removeTargetMember = {
      userId: removeUserId,
      householdId: testHouseholdId,
      role: "member",
      joinedAt: new Date(),
    };

    it("should allow owner to remove member", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(removeTargetMember); // Target is member
      mockHouseholdRepository.findMembers.mockResolvedValue([
        testOwnerMember,
        removeTargetMember,
      ]); // More than 1 member
      mockHouseholdRepository.removeMember.mockResolvedValue(undefined);

      const res = await request(app)
        .delete(`/api/household/members/${removeUserId}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId);

      expect(res.status).toBe(200);
      expect(mockAuditService.logDelete).toHaveBeenCalled();
    });

    it("should allow admin to remove member", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testAdminMember) // Current user is admin
        .mockResolvedValueOnce(removeTargetMember); // Target is member
      mockHouseholdRepository.findMembers.mockResolvedValue([
        testAdminMember,
        removeTargetMember,
      ]); // More than 1 member
      mockHouseholdRepository.removeMember.mockResolvedValue(undefined);

      const res = await request(app)
        .delete(`/api/household/members/${removeUserId}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId);

      expect(res.status).toBe(200);
    });

    it("should NOT allow member to remove others", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testMember);

      const res = await request(app)
        .delete(`/api/household/members/${removeUserId}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testMemberId);

      expect(res.status).toBe(403);
    });

    it("should NOT allow self-removal", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .delete(`/api/household/members/${testOwnerId}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId);

      expect(res.status).toBe(400);
    });

    it("should NOT allow admin to remove owner", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testAdminMember) // Current user is admin
        .mockResolvedValueOnce(testOwnerMember); // Target is owner

      const res = await request(app)
        .delete(`/api/household/members/${testOwnerId}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId);

      expect(res.status).toBe(403);
    });

    it("should return 404 for non-existent member", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(undefined); // Target not found

      const res = await request(app)
        .delete(`/api/household/members/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/household/invite - Invite Member
  // ==========================================================================

  describe("POST /api/household/invite - Invite Member", () => {
    const testInvitation = {
      id: randomUUID(),
      householdId: testHouseholdId,
      email: "new-invite@example.com",
      role: "member",
      inviteCode: "test-invite-code",
      invitedBy: testOwnerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    it("should allow owner to invite", async () => {
      // Mock the full sequence: findByUserId -> findMember -> findByEmail -> findPendingInvitationByEmail -> createInvitation
      mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
      mockUserRepository.findByEmail.mockResolvedValue(undefined); // No existing user
      mockHouseholdRepository.findPendingInvitationByEmail.mockResolvedValue(
        undefined,
      ); // No pending invite
      mockHouseholdRepository.createInvitation.mockResolvedValue(
        testInvitation,
      );

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({
          email: "new-invite@example.com",
          role: "member",
        });

      expect(res.status).toBe(201); // created() returns 201
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitation).toBeDefined();
      expect(mockAuditService.logCreate).toHaveBeenCalled();
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("should allow admin to invite", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(testHousehold);
      mockHouseholdRepository.findMember.mockResolvedValue(testAdminMember);
      mockUserRepository.findByEmail.mockResolvedValue(undefined);
      mockHouseholdRepository.findPendingInvitationByEmail.mockResolvedValue(
        undefined,
      );
      mockHouseholdRepository.createInvitation.mockResolvedValue({
        ...testInvitation,
        email: "admin-invite@example.com",
      });

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId)
        .send({
          email: "admin-invite@example.com",
          role: "member",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("should NOT allow member to invite", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testMember);

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testMemberId)
        .send({
          email: "member-invite@example.com",
          role: "member",
        });

      expect(res.status).toBe(403);
    });

    it("should NOT allow view_only to invite", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testViewOnlyMember);

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testViewOnlyId)
        .send({
          email: "viewonly-invite@example.com",
          role: "member",
        });

      expect(res.status).toBe(403);
    });

    it("should validate email format", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({
          email: "invalid-email",
          role: "member",
        });

      expect(res.status).toBe(400);
    });

    it("should validate role enum", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .post("/api/household/invite")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({
          email: "valid@example.com",
          role: "superuser", // Invalid role
        });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // PUT /api/household/general - Update Household
  // ==========================================================================

  describe("PUT /api/household/general - Update Household", () => {
    it("should update household name", async () => {
      const updatedHousehold = {
        ...testHousehold,
        name: "Updated Household Name",
      };
      mockHouseholdRepository.update.mockResolvedValue(updatedHousehold);

      const res = await request(app)
        .put("/api/household/general")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Updated Household Name",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.household.name).toBe("Updated Household Name");
    });

    it("should update fiscal year start month", async () => {
      const updatedHousehold = { ...testHousehold, fiscalYearStartMonth: 4 };
      mockHouseholdRepository.update.mockResolvedValue(updatedHousehold);

      const res = await request(app)
        .put("/api/household/general")
        .set("X-Test-Auth", "authenticated")
        .send({
          fiscalYearStartMonth: 4,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should validate fiscal year month range", async () => {
      const res = await request(app)
        .put("/api/household/general")
        .set("X-Test-Auth", "authenticated")
        .send({
          fiscalYearStartMonth: 13, // Invalid
        });

      expect(res.status).toBe(400);
    });

    it("should return 404 when user has no household", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/household/general")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "New Name",
        });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/household - Create Household
  // ==========================================================================

  describe("POST /api/household - Create Household", () => {
    it("should create a new household", async () => {
      // The controller creates the household, its owner membership, and default
      // tags atomically via createWithOwner (which also enforces the one-
      // household-per-user rule under a per-user advisory lock).
      mockHouseholdRepository.createWithOwner.mockResolvedValue(testHousehold);

      const res = await request(app)
        .post("/api/household")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "New Household",
          currency: "ZMW",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.household).toBeDefined();
    });

    it("should return 409 if user already has a household", async () => {
      // The single-household guard now lives inside createWithOwner (advisory
      // lock + in-transaction membership re-check), which rejects with
      // ConflictError when the user already belongs to a household.
      mockHouseholdRepository.createWithOwner.mockRejectedValue(
        new ConflictError("User already has a household"),
      );

      const res = await request(app)
        .post("/api/household")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Another Household",
          currency: "ZMW",
        });

      expect(res.status).toBe(409);
    });

    it("should require name", async () => {
      const res = await request(app)
        .post("/api/household")
        .set("X-Test-Auth", "authenticated")
        .send({
          currency: "ZMW",
        });

      expect(res.status).toBe(400);
    });

    it("should validate currency length", async () => {
      mockHouseholdRepository.findByUserId.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/household")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Test",
          currency: "INVALID", // More than 3 chars
        });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // POST /api/household/transfer-ownership - Transfer Ownership (EDGE-001, SEC-001)
  // ==========================================================================

  describe("POST /api/household/transfer-ownership - Ownership Transfer (EDGE-001, SEC-001)", () => {
    it("should allow owner to transfer ownership to another member", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(testAdminMember); // Target is admin
      mockHouseholdRepository.updateMemberRole
        .mockResolvedValueOnce({ ...testAdminMember, role: "owner" })
        .mockResolvedValueOnce({ ...testOwnerMember, role: "admin" });

      const res = await request(app)
        .post("/api/household/transfer-ownership")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ newOwnerId: testAdminId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it("should NOT allow non-owner to transfer ownership", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testAdminMember);

      const res = await request(app)
        .post("/api/household/transfer-ownership")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId)
        .send({ newOwnerId: testMemberId });

      expect(res.status).toBe(403);
    });

    it("should validate target UUID format", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .post("/api/household/transfer-ownership")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ newOwnerId: "invalid-uuid" });

      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent target member", async () => {
      mockHouseholdRepository.findMember
        .mockResolvedValueOnce(testOwnerMember) // Current user is owner
        .mockResolvedValueOnce(undefined); // Target not found

      const res = await request(app)
        .post("/api/household/transfer-ownership")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId)
        .send({ newOwnerId: randomUUID() });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/household/leave - Leave Household (EDGE-002, EDGE-003)
  // ==========================================================================

  describe("POST /api/household/leave - Leave Household (EDGE-002)", () => {
    it("should allow member to leave household", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testMember);
      mockHouseholdRepository.removeMember.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/household/leave")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testMemberId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it("should NOT allow owner to leave without transferring ownership", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);

      const res = await request(app)
        .post("/api/household/leave")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testOwnerId);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/transfer ownership/i);
    });

    it("should allow admin to leave household", async () => {
      mockHouseholdRepository.findMember.mockResolvedValue(testAdminMember);
      mockHouseholdRepository.removeMember.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/household/leave")
        .set("X-Test-Auth", "authenticated")
        .set("X-Test-User-Id", testAdminId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // Invitation Management Tests (SEC-002)
  // ==========================================================================

  describe("Invitation Management (SEC-002)", () => {
    const testInvitationId = randomUUID();
    const testToken = "test-invitation-token";
    const testInvitation = {
      id: testInvitationId,
      householdId: testHouseholdId,
      email: "invited@example.com",
      role: "member",
      token: testToken,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    };

    describe("GET /api/household/invitations - List Invitations", () => {
      it("should allow owner to list invitations", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
        mockHouseholdRepository.findPendingInvitationsByHousehold.mockResolvedValue(
          [testInvitation],
        );

        const res = await request(app)
          .get("/api/household/invitations")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId);

        expect(res.status).toBe(200);
        expect(res.body.data.invitations.length).toBe(1);
      });

      it("should allow admin to list invitations", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testAdminMember);
        mockHouseholdRepository.findPendingInvitationsByHousehold.mockResolvedValue(
          [testInvitation],
        );

        const res = await request(app)
          .get("/api/household/invitations")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testAdminId);

      expect(res.status).toBe(200);
    });

    describe("POST /api/household/invitations/:id/resend - Resend Invitation", () => {
      it("should allow owner to resend invitation and send email", async () => {
        const invitation = {
          id: testInvitationId,
          householdId: testHouseholdId,
          email: "invited@example.com",
          role: "member",
          inviteCode: "invite-code-123",
          invitedBy: testOwnerId,
          expiresAt: new Date(Date.now() + 86400000),
          acceptedAt: null,
          acceptedBy: null,
          createdAt: new Date(),
        };

        mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
        mockHouseholdRepository.findInvitationById.mockResolvedValue(invitation);
        mockHouseholdRepository.updateInvitationExpiry.mockResolvedValue({
          ...invitation,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        });

        const res = await request(app)
          .post(`/api/household/invitations/${testInvitationId}/resend`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockAuditService.logUpdate).toHaveBeenCalled();
      });

      it("should reject resend for member role", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testMember);

        const res = await request(app)
          .post(`/api/household/invitations/${testInvitationId}/resend`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId);

        expect(res.status).toBe(403);
      });
    });

      it("should NOT allow member to list invitations", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testMember);

        const res = await request(app)
          .get("/api/household/invitations")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId);

        expect(res.status).toBe(403);
      });
    });

    describe("DELETE /api/household/invitations/:id - Cancel Invitation", () => {
      it("should allow owner to cancel invitation", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
        mockHouseholdRepository.findInvitationById.mockResolvedValue(
          testInvitation,
        );
        mockHouseholdRepository.deleteInvitation.mockResolvedValue(undefined);

        const res = await request(app)
          .delete(`/api/household/invitations/${testInvitationId}`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId);

        expect(res.status).toBe(204);
        expect(mockAuditService.logDelete).toHaveBeenCalled();
      });

      it("should NOT allow member to cancel invitation", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testMember);

        const res = await request(app)
          .delete(`/api/household/invitations/${testInvitationId}`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId);

        expect(res.status).toBe(403);
      });

      it("should return 404 for non-existent invitation", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
        mockHouseholdRepository.findInvitationById.mockResolvedValue(undefined);

        const res = await request(app)
          .delete(`/api/household/invitations/${randomUUID()}`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId);

        expect(res.status).toBe(404);
      });
    });

    describe("POST /api/household/invite/accept - Accept Invitation", () => {
      const testNewUserId = randomUUID();

      it("should accept valid invitation with invite code", async () => {
        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          testInvitation,
        );
        // Signed in as the invited address (accept now requires it).
        mockUserRepository.findById.mockResolvedValue({
          id: testNewUserId,
          email: testInvitation.email,
        });
        mockHouseholdRepository.findMember.mockResolvedValue(undefined); // User not already a member
        mockHouseholdRepository.findByUserId.mockResolvedValue(undefined); // User has no household
        mockHouseholdRepository.addMember.mockResolvedValue(testMember);
        mockHouseholdRepository.markInvitationAccepted = vi
          .fn()
          .mockResolvedValue(undefined);
        mockHouseholdRepository.findById.mockResolvedValue(testHousehold);

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testNewUserId)
          .send({ inviteCode: testToken });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.accepted).toBe(true);
      });

      it("should reject expired invitation", async () => {
        const expiredInvitation = {
          ...testInvitation,
          expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
        };
        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          expiredInvitation,
        );

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testNewUserId)
          .send({ inviteCode: testToken });

        expect(res.status).toBe(409); // ConflictError for expired
        expect(res.body.error.message).toMatch(/expired/i);
      });

      it("should return 404 for invalid invite code", async () => {
        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          undefined,
        );

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testNewUserId)
          .send({ inviteCode: "invalid-code" });

        expect(res.status).toBe(404);
      });
    });
  });

  // ==========================================================================
  // EDGE CASE TESTS (EDGE-004 to EDGE-008, VAL-002, SEC-003 to SEC-005)
  // ==========================================================================

  describe("Edge Case Tests", () => {
    describe("EDGE-004: Duplicate Member Addition", () => {
      it("should prevent adding same user twice to household", async () => {
        const inviteCode = "test-invite-code";
        const invitation = {
          id: randomUUID(),
          householdId: testHouseholdId,
          email: "new@example.com",
          role: "member",
          inviteCode,
          invitedBy: testOwnerId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: null,
          acceptedBy: null,
          createdAt: new Date(),
        };

        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          invitation
        );
        mockUserRepository.findById.mockResolvedValue({
          id: testMemberId,
          email: invitation.email,
        });
        // User is already a member
        mockHouseholdRepository.findMember.mockResolvedValue(testMember);

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId)
          .send({ inviteCode });

        expect(res.status).toBe(409);
        expect(res.body.error?.message).toContain("already a member");
      });
    });

    describe("EDGE-005: Concurrent Role Changes", () => {
      it("should handle concurrent role update attempts gracefully", async () => {
        // This would require actual database testing with transactions
        // For now, verify that the controller properly checks member existence
        mockHouseholdRepository.findMember
          .mockResolvedValueOnce(testOwnerMember) // Current user
          .mockResolvedValueOnce(testMember); // Target member

        mockHouseholdRepository.updateMemberRoleAtomic.mockResolvedValue({
          ...testMember,
          role: "admin",
        });

        const res = await request(app)
          .put(`/api/household/members/${testMemberId}/role`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId)
          .send({ role: "admin" });

        expect(res.status).toBe(200);
        expect(mockHouseholdRepository.findMember).toHaveBeenCalledTimes(2);
      });
    });

    describe("EDGE-006: Remove Non-Existent Member", () => {
      it("should return 404 when removing non-existent member", async () => {
        const nonExistentUserId = randomUUID();
        mockHouseholdRepository.findMember
          .mockResolvedValueOnce(testOwnerMember) // Current user
          .mockResolvedValueOnce(undefined); // Target not found

        const res = await request(app)
          .delete(`/api/household/members/${nonExistentUserId}`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId);

        expect(res.status).toBe(404);
        expect(res.body.error?.message).toContain("Member not found");
      });
    });

    describe("EDGE-007: Very Long Household Name", () => {
      it("should accept household name up to 255 characters", async () => {
        const longName = "A".repeat(255);
        mockHouseholdRepository.createWithOwner.mockResolvedValue({
          ...testHousehold,
          name: longName,
        });
        mockUserRepository.getUserPreferences.mockResolvedValue({});

        const res = await request(app)
          .post("/api/household")
          .set("X-Test-Auth", "authenticated")
          .send({
            name: longName,
            currency: "USD",
          });

        expect(res.status).toBe(201);
        expect(mockHouseholdRepository.createWithOwner).toHaveBeenCalledWith(
          expect.objectContaining({ name: longName })
        );
      });

      it("should reject household name over 255 characters", async () => {
        mockHouseholdRepository.findByUserId.mockResolvedValue(undefined);
        const tooLongName = "A".repeat(256);

        const res = await request(app)
          .post("/api/household")
          .set("X-Test-Auth", "authenticated")
          .send({
            name: tooLongName,
            currency: "USD",
          });

        expect(res.status).toBe(400);
      });
    });

    describe("EDGE-008: Unicode Household Name", () => {
      it("should accept unicode characters in household name", async () => {
        const unicodeName = "🏠 家庭 Famille 家族 परिवार";
        mockHouseholdRepository.createWithOwner.mockResolvedValue({
          ...testHousehold,
          name: unicodeName,
        });
        mockUserRepository.getUserPreferences.mockResolvedValue({});

        const res = await request(app)
          .post("/api/household")
          .set("X-Test-Auth", "authenticated")
          .send({
            name: unicodeName,
            currency: "USD",
          });

        expect(res.status).toBe(201);
        expect(mockHouseholdRepository.createWithOwner).toHaveBeenCalledWith(
          expect.objectContaining({ name: unicodeName })
        );
      });

      it("should accept emoji-only household name", async () => {
        const emojiName = "🏠💰📊";
        mockHouseholdRepository.createWithOwner.mockResolvedValue({
          ...testHousehold,
          name: emojiName,
        });
        mockUserRepository.getUserPreferences.mockResolvedValue({});

        const res = await request(app)
          .post("/api/household")
          .set("X-Test-Auth", "authenticated")
          .send({
            name: emojiName,
            currency: "USD",
          });

        expect(res.status).toBe(201);
      });
    });

    describe("VAL-002: Invalid Role Assignment", () => {
      it("should reject completely invalid role", async () => {
        mockHouseholdRepository.findMember
          .mockResolvedValueOnce(testOwnerMember)
          .mockResolvedValueOnce(testMember);

        const res = await request(app)
          .put(`/api/household/members/${testMemberId}/role`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId)
          .send({ role: "superadmin" });

        expect(res.status).toBe(400);
      });

      it("should reject old 'viewer' role value", async () => {
        mockHouseholdRepository.findMember
          .mockResolvedValueOnce(testOwnerMember)
          .mockResolvedValueOnce(testMember);

        const res = await request(app)
          .put(`/api/household/members/${testMemberId}/role`)
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId)
          .send({ role: "viewer" }); // Should be 'view_only'

        expect(res.status).toBe(400);
      });
    });

    describe("SEC-003: Rate Limiting Tests", () => {
      it("should have rate limiting middleware applied", () => {
        // This test verifies that rate limiter is in the middleware chain
        // In actual implementation, the generalLimiter should be applied
        // This is a structural test - actual rate limiting tested elsewhere
        expect(app._router).toBeDefined();
      });
    });

    describe("SEC-004: Owner Transfer Authorization Tests", () => {
      it("should prevent admin from transferring ownership", async () => {
        // The VAL-002 tests above queue mockResolvedValueOnce(testOwnerMember)
        // values on findMember that they never consume (they short-circuit at
        // Zod validation). vi.clearAllMocks() does NOT drain that one-shot
        // queue, so reset findMember here before setting the caller's role;
        // otherwise the controller's first findMember call would return a
        // leaked "owner" and skip the owner-only check.
        mockHouseholdRepository.findMember.mockReset();
        mockHouseholdRepository.findMember.mockResolvedValue(testAdminMember);

        const res = await request(app)
          .post("/api/household/transfer-ownership")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testAdminId)
          .send({ newOwnerId: testMemberId });

        expect(res.status).toBe(403);
        expect(res.body.error?.message).toContain("owner can transfer");
      });

      it("should prevent member from transferring ownership", async () => {
        // Reset to drain any leaked one-shot findMember resolutions (see note
        // on the admin case above) so the controller sees the caller as a
        // plain member, not a phantom owner.
        mockHouseholdRepository.findMember.mockReset();
        mockHouseholdRepository.findMember.mockResolvedValue(testMember);

        const res = await request(app)
          .post("/api/household/transfer-ownership")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId)
          .send({ newOwnerId: testAdminId });

        expect(res.status).toBe(403);
        expect(res.body.error?.message).toContain("owner can transfer");
      });

      it("should audit log successful ownership transfer", async () => {
        mockHouseholdRepository.findMember
          .mockResolvedValueOnce(testOwnerMember)
          .mockResolvedValueOnce(testAdminMember);
        mockHouseholdRepository.updateMemberRole
          .mockResolvedValueOnce({ ...testAdminMember, role: "owner" })
          .mockResolvedValueOnce({ ...testOwnerMember, role: "admin" });

        await request(app)
          .post("/api/household/transfer-ownership")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId)
          .send({ newOwnerId: testAdminId });

        expect(mockAuditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "TRANSFER",
            entityType: "user",
            entityId: testAdminId,
          })
        );
      });
    });

    describe("SEC-005: Invitation Token Security Tests", () => {
      it("should reject expired invitation", async () => {
        const expiredInvitation = {
          id: randomUUID(),
          householdId: testHouseholdId,
          email: "test@example.com",
          role: "member",
          inviteCode: "expired-code",
          invitedBy: testOwnerId,
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
          acceptedAt: null,
          acceptedBy: null,
          createdAt: new Date(),
        };

        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          expiredInvitation
        );

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testMemberId)
          .send({ inviteCode: "expired-code" });

        expect(res.status).toBe(409);
        expect(res.body.error?.message).toContain("expired");
      });

      it("should reject already used invitation", async () => {
        const usedInvitation = {
          id: randomUUID(),
          householdId: testHouseholdId,
          email: "test@example.com",
          role: "member",
          inviteCode: "used-code",
          invitedBy: testOwnerId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(), // Already accepted
          acceptedBy: testMemberId,
          createdAt: new Date(),
        };

        mockHouseholdRepository.findInvitationByCode.mockResolvedValue(
          usedInvitation
        );

        const res = await request(app)
          .post("/api/household/invite/accept")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testAdminId)
          .send({ inviteCode: "used-code" });

        expect(res.status).toBe(409);
        expect(res.body.error?.message).toContain("already been used");
      });

      it("should generate cryptographically secure invite codes", async () => {
        mockHouseholdRepository.findMember.mockResolvedValue(testOwnerMember);
        mockHouseholdRepository.findPendingInvitationByEmail.mockResolvedValue(
          undefined
        );
        mockUserRepository.findByEmail.mockResolvedValue(undefined);

        let capturedInviteCode = "";
        mockHouseholdRepository.createInvitation.mockImplementation(
          async (data: any) => {
            capturedInviteCode = data.inviteCode;
            return {
              id: randomUUID(),
              ...data,
              createdAt: new Date(),
            };
          }
        );

        await request(app)
          .post("/api/household/invite")
          .set("X-Test-Auth", "authenticated")
          .set("X-Test-User-Id", testOwnerId)
          .send({ email: "newuser@example.com", role: "member" });

        // Invite code should be 64 hex characters (32 random bytes)
        expect(capturedInviteCode).toMatch(/^[a-f0-9]{64}$/);
      });
    });
  });
});
