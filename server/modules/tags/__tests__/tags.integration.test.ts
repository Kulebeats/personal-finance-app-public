/**
 * Tags Module - Integration Tests
 *
 * Tests tag CRUD operations, transaction tagging, authorization boundaries,
 * and audit logging using mocked service layer.
 */

import request from "supertest";
import express from "express";
import session from "express-session";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

// Mock repositories
const mockTagRepository = vi.hoisted(() => ({
  findByHousehold: vi.fn(),
  findById: vi.fn(),
  findByIds: vi.fn(), // Batch verification for performance
  findByName: vi.fn(), // Required for duplicate name checking (TAGS-VAL-002)
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getTransactionTags: vi.fn(),
  addTagToTransaction: vi.fn(),
  removeTagFromTransaction: vi.fn(),
  setTransactionTags: vi.fn(), // DATA-001: Set all tags at once
  incrementUsageCount: vi.fn().mockResolvedValue(undefined), // DATA-001: Usage tracking
  decrementUsageCount: vi.fn().mockResolvedValue(undefined), // DATA-001: Usage tracking
  findTransactionsByTag: vi.fn(), // API-001: Get transactions by tag
}));

const mockTransactionRepository = vi.hoisted(() => ({
  findByIdWithVisibility: vi.fn(),
}));
const mockTagWriteRepository = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../../../repositories/TagWriteRepository", () => ({ tagWriteRepository: mockTagWriteRepository }));
// Create/rename run the name check and write in one locked transaction (NEW-36). The
// repository is mocked here, so the transaction and its advisory lock are pass-throughs;
// the real lock and case-insensitive check are in tags.name-case.realdb.integration.test.ts.
vi.mock("../../../utils/withTransaction", () => ({ withTransaction: (work: (tx: object) => unknown) => work({}) }));
vi.mock("../tags.name-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tags.name-guard")>()), lockTagNames: vi.fn().mockResolvedValue(undefined),
}));

const mockAuditService = vi.hoisted(() => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../../../repositories/TagRepository", () => ({
  tagRepository: mockTagRepository,
}));

vi.mock("../../../repositories/TransactionRepository", () => ({
  transactionRepository: mockTransactionRepository,
}));

// This suite models repository outcomes; real actor/privacy/snapshot SQL lives
// in completion-r04.tags.realdb.integration.test.ts. Keep controllers, request
// validation and service delegation real. Atomic writer effects and audit are
// covered with actual PG in completion-r04.tag-writes.realdb.integration.test.ts.
vi.mock("../../../repositories/TagReadRepository", async () => {
  const { NotFoundError } = await import("../../../core/errors");
  return { tagReadRepository: {
    list: (actor: { householdId: string }, options: unknown) => mockTagRepository.findByHousehold(actor.householdId, options),
    get: async (actor: { householdId: string }, id: string) => {
      const row = await mockTagRepository.findById(id, actor.householdId);
      if (!row) throw new NotFoundError("Tag not found");
      return row;
    },
    transactionTags: async (actor: { householdId: string; userId: string }, id: string) => {
      if (!await mockTransactionRepository.findByIdWithVisibility(id, actor.householdId, actor.userId)) throw new NotFoundError("Transaction not found");
      return mockTagRepository.getTransactionTags(id);
    },
    mutationTags: async (_actor: unknown, rows: unknown[]) => rows,
    mutationTransactionTags: (_actor: unknown, id: string) => mockTagRepository.getTransactionTags(id),
  } };
});

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockAuditService,
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Import controller after mocks
import { tagsController } from "../tags.controller";

// Test data
const testHouseholdId = randomUUID();
const testUserId = randomUUID();
const testTag = {
  id: randomUUID(),
  householdId: testHouseholdId,
  name: "Test Tag",
  color: "#FF5733",
  icon: null,
  memberSpecific: false,
  memberId: null,
  usageCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createTestApp() {
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

  // Middleware to set householdContext and session
  app.use((req, _res, next) => {
    if (req.headers["x-test-auth"] === "authenticated") {
      req.session.userId = testUserId;
      (req as any).householdContext = {
        householdId: testHouseholdId,
        userId: testUserId,
        role: "member",
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

  // Mount tag routes - IMPORTANT: specific routes before parameterized routes
  const router = express.Router();
  router.get("/", requireAuth, tagsController.list);
  router.post("/", requireAuth, tagsController.create);
  // Transaction tag routes MUST come before /:id routes to avoid matching "transaction" as an id
  router.get(
    "/transaction/:transactionId",
    requireAuth,
    tagsController.getTransactionTags,
  );
  router.post(
    "/transaction/:transactionId",
    requireAuth,
    tagsController.addTransactionTags,
  );
  router.delete(
    "/transaction/:transactionId/:tagId",
    requireAuth,
    tagsController.removeTransactionTag,
  );
  // Generic :id routes after specific routes
  router.get("/:id", requireAuth, tagsController.getById);
  router.put("/:id", requireAuth, tagsController.update);
  router.delete("/:id", requireAuth, tagsController.delete);

  app.use("/api/tags", router);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: err.name || "ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Tags Integration Tests", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTagWriteRepository.write.mockReset().mockResolvedValue({ added: 0, removed: 0 });
  });

  // ==========================================================================
  // Tag CRUD Operations
  // ==========================================================================

  describe("POST /api/tags - Create Tag", () => {
    it("should create a tag with valid data", async () => {
      mockTagRepository.findByName.mockResolvedValue(undefined); // No duplicate
      mockTagRepository.create.mockResolvedValue(testTag);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Test Tag",
          color: "#FF5733",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Test Tag");
      expect(mockAuditService.logCreate).toHaveBeenCalled();
    });

    it("should create a tag with icon", async () => {
      const tagWithIcon = { ...testTag, icon: "star" };
      mockTagRepository.findByName.mockResolvedValue(undefined); // No duplicate
      mockTagRepository.create.mockResolvedValue(tagWithIcon);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Icon Tag",
          color: "#123456",
          icon: "star",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.icon).toBe("star");
    });

    it("should require name field", async () => {
      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          color: "#FF5733",
        });

      expect(res.status).toBe(400);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).post("/api/tags").send({
        name: "Unauthenticated Tag",
      });

      expect(res.status).toBe(401);
    });

    // TAGS-VAL-002: Test duplicate name validation
    it("should reject duplicate tag names (TAGS-VAL-002)", async () => {
      mockTagRepository.findByName.mockResolvedValue(testTag); // Duplicate exists

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Test Tag", // Duplicate name
          color: "#FF5733",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("already exists");
    });

    it("should reject empty name", async () => {
      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "",
          color: "#FF5733",
        });

      expect(res.status).toBe(400);
    });

    it("should reject name exceeding 255 characters", async () => {
      const longName = "a".repeat(256);
      mockTagRepository.findByName.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: longName,
          color: "#FF5733",
        });

      expect(res.status).toBe(400);
    });

    it("should accept name with special characters", async () => {
      const specialTag = {
        ...testTag,
        name: "Tag #1 (Important) - 2024!",
      };
      mockTagRepository.findByName.mockResolvedValue(undefined);
      mockTagRepository.create.mockResolvedValue(specialTag);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Tag #1 (Important) - 2024!",
          color: "#FF5733",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Tag #1 (Important) - 2024!");
    });

    it("should accept tag name with surrounding whitespace", async () => {
      const tagWithSpaces = { ...testTag, name: "  Spaced Tag  " };
      mockTagRepository.findByName.mockResolvedValue(undefined);
      mockTagRepository.create.mockResolvedValue(tagWithSpaces);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "  Spaced Tag  ",
          color: "#FF5733",
        });

      expect(res.status).toBe(201);
      // Note: Schema does not trim whitespace, accepts as-is
      expect(res.body.data.name).toBe("  Spaced Tag  ");
    });
  });

  describe("GET /api/tags - List Tags", () => {
    it("should return all tags for household", async () => {
      const tags = [testTag, { ...testTag, id: randomUUID(), name: "Tag 2" }];
      mockTagRepository.findByHousehold.mockResolvedValue(tags);

      const res = await request(app)
        .get("/api/tags")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/tags");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/tags/:id - Get Tag by ID", () => {
    it("should return tag by id", async () => {
      mockTagRepository.findById.mockResolvedValue(testTag);

      const res = await request(app)
        .get(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testTag.id);
    });

    it("should return 404 for non-existent tag", async () => {
      mockTagRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .get(`/api/tags/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/tags/:id - Update Tag", () => {
    it("should update tag name", async () => {
      const updatedTag = { ...testTag, name: "Updated Tag" };
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.findByName.mockResolvedValue(undefined); // No duplicate
      mockTagRepository.update.mockResolvedValue(updatedTag);

      const res = await request(app)
        .put(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated")
        .send({ name: "Updated Tag" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Tag");
      expect(mockAuditService.logUpdate).toHaveBeenCalled();
    });

    it("should return 404 for non-existent tag", async () => {
      mockTagRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .put(`/api/tags/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated")
        .send({ name: "Updated Tag" });

      expect(res.status).toBe(404);
    });

    // TAGS-VAL-002: Test duplicate name validation on update
    it("should reject duplicate tag name on update (TAGS-VAL-002)", async () => {
      const existingTag = { ...testTag, id: randomUUID(), name: "Existing Tag" };
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.findByName.mockResolvedValue(existingTag); // Duplicate exists

      const res = await request(app)
        .put(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated")
        .send({ name: "Existing Tag" }); // Try to rename to duplicate

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("already exists");
    });

    it("should allow updating tag without changing name", async () => {
      const updatedTag = { ...testTag, color: "#00FF00" };
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.update.mockResolvedValue(updatedTag);

      const res = await request(app)
        .put(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated")
        .send({ color: "#00FF00" }); // Only update color

      expect(res.status).toBe(200);
      expect(res.body.data.color).toBe("#00FF00");
      // Should not check for duplicate if name unchanged
      expect(mockTagRepository.findByName).not.toHaveBeenCalled();
    });

    it("should update tag icon", async () => {
      const updatedTag = { ...testTag, icon: "heart" };
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.update.mockResolvedValue(updatedTag);

      const res = await request(app)
        .put(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated")
        .send({ icon: "heart" });

      expect(res.status).toBe(200);
      expect(res.body.data.icon).toBe("heart");
    });

    it("should clear tag icon with null", async () => {
      const tagWithIcon = { ...testTag, icon: "star" };
      const updatedTag = { ...testTag, icon: null };
      mockTagRepository.findById.mockResolvedValue(tagWithIcon);
      mockTagRepository.update.mockResolvedValue(updatedTag);

      const res = await request(app)
        .put(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated")
        .send({ icon: null });

      expect(res.status).toBe(200);
      expect(res.body.data.icon).toBe(null);
    });
  });

  describe("DELETE /api/tags/:id - Delete Tag", () => {
    it("should delete a tag", async () => {
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.delete.mockResolvedValue(testTag);

      const res = await request(app)
        .delete(`/api/tags/${testTag.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(204);
      expect(mockAuditService.logDelete).toHaveBeenCalled();
    });

    it("should return 404 for non-existent tag", async () => {
      mockTagRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .delete(`/api/tags/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Transaction Tags
  // ==========================================================================

  describe("Transaction Tags", () => {
    const testTransactionId = randomUUID();
    const testTransaction = {
      id: testTransactionId,
      householdId: testHouseholdId,
      ownerUserId: testUserId,
    };

    it("should add tags to transaction", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      // SEC-CRITICAL (TAGS-SEC-003): Batch verification of tags belonging to household
      mockTagRepository.findByIds.mockResolvedValue([testTag]);
      mockTagRepository.addTagToTransaction.mockResolvedValue({});
      mockTagRepository.getTransactionTags.mockResolvedValue([testTag]);

      const res = await request(app)
        .post(`/api/tags/transaction/${testTransactionId}`)
        .set("X-Test-Auth", "authenticated")
        .send({ tagIds: [testTag.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockTagWriteRepository.write).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: testHouseholdId, userId: testUserId }),
        { operation: "add", transactionId: testTransactionId, tagIds: [testTag.id] }, "127.0.0.1",
      );
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it("should get transaction tags", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      mockTagRepository.getTransactionTags.mockResolvedValue([testTag]);

      const res = await request(app)
        .get(`/api/tags/transaction/${testTransactionId}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
    });

    it("should remove tag from transaction", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      // SEC-CRITICAL (TAGS-SEC-003): Controller verifies tag belongs to household
      mockTagRepository.findById.mockResolvedValue(testTag);
      mockTagRepository.removeTagFromTransaction.mockResolvedValue({});
      mockTagRepository.getTransactionTags.mockResolvedValue([]);

      const res = await request(app)
        .delete(`/api/tags/transaction/${testTransactionId}/${testTag.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(mockTagWriteRepository.write).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: testHouseholdId, userId: testUserId }),
        { operation: "remove", transactionId: testTransactionId, tagIds: [testTag.id] }, "127.0.0.1",
      );
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Authorization Boundaries (SEC-CRITICAL-001)
  // ==========================================================================

  describe("Transaction Tags - Authorization Boundaries", () => {
    it("should return 404 when transaction not visible to user", async () => {
      mockTagWriteRepository.write.mockRejectedValueOnce(Object.assign(new Error("Transaction not found"), { statusCode: 404 }));
      // Transaction belongs to different user and is private
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .post(`/api/tags/transaction/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated")
        .send({ tagIds: [testTag.id] });

      expect(res.status).toBe(404);
    });

    it("should not allow getting tags from inaccessible transaction", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .get(`/api/tags/transaction/${randomUUID()}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });

    it("should not allow removing tags from inaccessible transaction", async () => {
      mockTagWriteRepository.write.mockRejectedValueOnce(Object.assign(new Error("Transaction not found"), { statusCode: 404 }));
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .delete(`/api/tags/transaction/${randomUUID()}/${testTag.id}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Transaction Tags - Edge Cases", () => {
    const testTransactionId = randomUUID();
    const testTransaction = {
      id: testTransactionId,
      householdId: testHouseholdId,
      ownerUserId: testUserId,
    };

    it("should handle empty tagIds array", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      mockTagRepository.getTransactionTags.mockResolvedValue([]);

      const res = await request(app)
        .post(`/api/tags/transaction/${testTransactionId}`)
        .set("X-Test-Auth", "authenticated")
        .send({ tagIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("should handle adding duplicate tags (idempotent)", async () => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      // Batch verification
      mockTagRepository.findByIds.mockResolvedValue([testTag]);
      mockTagRepository.addTagToTransaction.mockResolvedValue({});
      mockTagRepository.getTransactionTags.mockResolvedValue([testTag]);

      // First add
      const res1 = await request(app)
        .post(`/api/tags/transaction/${testTransactionId}`)
        .set("X-Test-Auth", "authenticated")
        .send({ tagIds: [testTag.id] });

      expect(res1.status).toBe(200);

      // Second add (duplicate) - should be idempotent due to TAGS-RACE-001 fix
      const res2 = await request(app)
        .post(`/api/tags/transaction/${testTransactionId}`)
        .set("X-Test-Auth", "authenticated")
        .send({ tagIds: [testTag.id] });

      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(1);
    });

    it("should handle removing non-existent tag gracefully", async () => {
      mockTagWriteRepository.write.mockRejectedValueOnce(Object.assign(new Error("Tag not found"), { statusCode: 404 }));
      const nonExistentTagId = randomUUID();
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        testTransaction,
      );
      mockTagRepository.findById.mockResolvedValue(undefined); // Tag doesn't exist

      const res = await request(app)
        .delete(`/api/tags/transaction/${testTransactionId}/${nonExistentTagId}`)
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid UUID format", async () => {
      mockTagRepository.findById.mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/tags/invalid-uuid")
        .set("X-Test-Auth", "authenticated");

      // Malformed IDs fail validation before reaching the repository seam.
      expect(res.status).toBe(400);
    });

    it("should handle very long color hex codes", async () => {
      mockTagRepository.findByName.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/tags")
        .set("X-Test-Auth", "authenticated")
        .send({
          name: "Test Tag",
          color: "#FFFFFFFFFFFFFFFFFF", // Too long
        });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // List and Filtering Edge Cases
  // ==========================================================================

  describe("GET /api/tags - List Edge Cases", () => {
    it("should return empty array for household with no tags", async () => {
      mockTagRepository.findByHousehold.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/tags")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("should handle large number of tags", async () => {
      const manyTags = Array.from({ length: 100 }, (_, i) => ({
        ...testTag,
        id: randomUUID(),
        name: `Tag ${i}`,
      }));
      mockTagRepository.findByHousehold.mockResolvedValue(manyTags);

      const res = await request(app)
        .get("/api/tags")
        .set("X-Test-Auth", "authenticated");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(100);
    });
  });
});
