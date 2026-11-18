/**
 * Categories Module - Integration Tests
 *
 * Tests category groups and categories CRUD operations.
 * Uses mocked middleware for reliable testing (same pattern as budgets.integration.test.ts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockCategoryGroupRepository,
  mockCategoryRepository,
  mockBusinessAuditService,
  mockSeedDefaultCategories,
} = vi.hoisted(() => ({
  mockCategoryGroupRepository: {
    findByHousehold: vi.fn(),
    findByIdAndHousehold: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(), // SCP-335: atomic, household-scoped group reorder
  },
  mockCategoryRepository: {
    findByHousehold: vi.fn(),
    findByIdAndHousehold: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findByGroup: vi.fn(),
    reorder: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
  mockSeedDefaultCategories: vi.fn(),
}));

// Mock Repositories (paths relative to test file in __tests__)
vi.mock("../../../repositories/CategoryGroupRepository", () => ({
  categoryGroupRepository: mockCategoryGroupRepository,
}));

vi.mock("../../../repositories/CategoryRepository", () => ({
  categoryRepository: mockCategoryRepository,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../../seed", () => ({
  seedDefaultCategories: mockSeedDefaultCategories,
}));

// Mock Middleware
vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (req: any, res: any, next: any) => {
    req.householdContext = {
      householdId: "house-123",
      userId: "user-123",
      role: "admin",
    };
    req.user = { id: "user-123" };
    req.session = { userId: "user-123" };
    next();
  },
}));

vi.mock("../../../middleware/validateEntity", () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (req: any, res: any, next: any) => next(),
}));

// Import Routes (after mocks are defined)
import categoriesRouter from "../categories.routes";
import { errorHandler } from "../../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/categories", categoriesRouter);
app.use(errorHandler);

describe("Categories Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // CATEGORY GROUPS TESTS
  // =========================================================================

  describe("GET /api/categories/groups - List Category Groups", () => {
    it("should return all category groups for household", async () => {
      const mockGroups = [
        { id: "group-1", name: "Food", type: "expense", householdId: "house-123" },
        { id: "group-2", name: "Income", type: "income", householdId: "house-123" },
      ];

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue(mockGroups);

      const res = await request(app)
        .get("/api/categories/groups")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.groups).toEqual(mockGroups);
      expect(mockCategoryGroupRepository.findByHousehold).toHaveBeenCalledWith("house-123");
    });

    it("should return empty array when no groups exist", async () => {
      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/categories/groups")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.groups).toEqual([]);
    });
  });

  describe("POST /api/categories/groups - Create Category Group", () => {
    it("should create a new category group", async () => {
      const mockGroup = {
        id: "group-new",
        name: "Test Group",
        type: "expense",
        householdId: "house-123",
        isArchived: false,
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: "Test Group",
          type: "expense",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.name).toBe("Test Group");
      expect(res.body.data.group.type).toBe("expense");

      expect(mockCategoryGroupRepository.create).toHaveBeenCalled();
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category_group",
          entityId: "group-new",
          householdId: "house-123",
        })
      );
    });

    it("should validate type enum (expense/income/transfers)", async () => {
      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: "Invalid Type Group",
          type: "invalid_type",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(mockCategoryGroupRepository.create).not.toHaveBeenCalled();
    });

    it("should require name field", async () => {
      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          type: "expense",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should create group with budget mode", async () => {
      const mockGroup = {
        id: "group-budget",
        name: "By Group Budget",
        type: "expense",
        budgetMode: "by_group",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: "By Group Budget",
          type: "expense",
          budgetMode: "by_group",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.budgetMode).toBe("by_group");
    });

    it("should create group with rollover enabled", async () => {
      const mockGroup = {
        id: "group-rollover",
        name: "Rollover Group",
        type: "expense",
        rolloverEnabled: true,
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: "Rollover Group",
          type: "expense",
          rolloverEnabled: true,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.rolloverEnabled).toBe(true);
    });
  });

  describe("PUT /api/categories/groups/:id - Update Category Group", () => {
    it("should update category group name", async () => {
      const existingGroup = { id: "group-1", name: "Original", type: "expense", householdId: "house-123" };
      const updatedGroup = { ...existingGroup, name: "Updated Group Name" };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(existingGroup);
      mockCategoryGroupRepository.update.mockResolvedValue(updatedGroup);

      const res = await request(app)
        .put("/api/categories/groups/group-1")
        .send({
          name: "Updated Group Name",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.name).toBe("Updated Group Name");

      expect(mockBusinessAuditService.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category_group",
          entityId: "group-1",
        })
      );
    });

    it("should return 404 for non-existent group", async () => {
      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(null);

      const res = await request(app)
        .put("/api/categories/groups/non-existent")
        .send({
          name: "Updated Name",
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/categories/groups/:id - Delete Category Group", () => {
    it("should archive (soft delete) a category group", async () => {
      const existingGroup = { id: "group-1", name: "Group", householdId: "house-123", isArchived: false };
      const archivedGroup = { ...existingGroup, isArchived: true };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(existingGroup);
      mockCategoryGroupRepository.update.mockResolvedValue(archivedGroup);

      const res = await request(app)
        .delete("/api/categories/groups/group-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockBusinessAuditService.logDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category_group",
          entityId: "group-1",
        })
      );
    });

    it("should return 404 for non-existent group", async () => {
      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(null);

      const res = await request(app)
        .delete("/api/categories/groups/non-existent")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /api/categories/groups/:id/restore - Restore Category Group", () => {
    it("should restore an archived category group", async () => {
      const archivedGroup = { id: "group-1", name: "Archived Group", isArchived: true, householdId: "house-123" };
      const restoredGroup = { ...archivedGroup, isArchived: false };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(archivedGroup);
      mockCategoryGroupRepository.update.mockResolvedValue(restoredGroup);

      const res = await request(app)
        .put("/api/categories/groups/group-1/restore")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockBusinessAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "RESTORE",
          entityType: "category_group",
          entityId: "group-1",
        })
      );
    });
  });

  describe("PUT /api/categories/groups/reorder - Reorder Groups", () => {
    it("should reorder groups successfully", async () => {
      // SCP-335: the controller now delegates to a single atomic, household-
      // scoped reorder() call instead of looping findByIdAndHousehold + update.
      mockCategoryGroupRepository.reorder.mockResolvedValue(undefined);

      const groupIds = [
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440002",
      ];

      await request(app)
        .put("/api/categories/groups/reorder")
        .send({ groupIds })
        .expect(204);

      // Should delegate to the atomic reorder, scoped by household.
      expect(mockCategoryGroupRepository.reorder).toHaveBeenCalledTimes(1);
      expect(mockCategoryGroupRepository.reorder).toHaveBeenCalledWith(
        "house-123",
        groupIds
      );
    });

    it("should reject reorder with empty array", async () => {
      const res = await request(app)
        .put("/api/categories/groups/reorder")
        .send({
          groupIds: [],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // CATEGORIES TESTS
  // =========================================================================

  describe("GET /api/categories - List Categories", () => {
    it("should return all categories for household", async () => {
      const mockCategories = [
        { id: "cat-1", name: "Food", groupId: "group-1" },
        { id: "cat-2", name: "Transport", groupId: "group-1" },
      ];
      const mockGroups = [{ id: "group-1", name: "Expenses", type: "expense" }];

      mockCategoryRepository.findByHousehold.mockResolvedValue(mockCategories);
      mockCategoryGroupRepository.findByHousehold.mockResolvedValue(mockGroups);

      const res = await request(app)
        .get("/api/categories")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.categories).toHaveLength(2);
      expect(res.body.data.groups).toHaveLength(1);
    });

    it("should return empty arrays for household with no categories", async () => {
      mockCategoryRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/categories")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.categories).toEqual([]);
      expect(res.body.data.groups).toEqual([]);
    });
  });

  describe("GET /api/categories/:id - Get Category by ID", () => {
    it("should return category by id", async () => {
      const mockCategory = {
        id: "cat-1",
        name: "Food",
        groupId: "group-1",
        householdId: "house-123",
      };

      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(mockCategory);

      const res = await request(app)
        .get("/api/categories/cat-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.id).toBe("cat-1");
      expect(res.body.data.category.name).toBe("Food");
    });

    it("should return 404 for non-existent category", async () => {
      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/categories/non-existent")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/categories - Create Category", () => {
    it("should create a new category", async () => {
      const mockGroup = { id: "550e8400-e29b-41d4-a716-446655440001", householdId: "house-123" };
      const mockCategory = {
        id: "cat-new",
        name: "New Category",
        groupId: "550e8400-e29b-41d4-a716-446655440001",
        icon: "shopping",
        color: "#FF5500",
        householdId: "house-123",
        isArchived: false,
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(mockGroup);
      mockCategoryRepository.findByGroup.mockResolvedValue([]);
      mockCategoryRepository.create.mockResolvedValue(mockCategory);

      const res = await request(app)
        .post("/api/categories")
        .send({
          groupId: "550e8400-e29b-41d4-a716-446655440001",
          name: "New Category",
          icon: "shopping",
          color: "#FF5500",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.name).toBe("New Category");

      expect(mockCategoryRepository.create).toHaveBeenCalled();
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category",
          entityId: "cat-new",
          householdId: "house-123",
        })
      );
    });

    it("should require groupId field", async () => {
      const res = await request(app)
        .post("/api/categories")
        .send({
          name: "No Group Category",
          icon: "test",
          color: "#FF0000",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should require name field", async () => {
      const res = await request(app)
        .post("/api/categories")
        .send({
          groupId: "550e8400-e29b-41d4-a716-446655440001",
          icon: "test",
          color: "#FF0000",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept valid hex color format", async () => {
      const mockGroup = { id: "550e8400-e29b-41d4-a716-446655440001", householdId: "house-123" };
      const mockCategory = {
        id: "cat-color",
        name: "Color Category",
        color: "#AABBCC",
        groupId: "550e8400-e29b-41d4-a716-446655440001",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(mockGroup);
      mockCategoryRepository.findByGroup.mockResolvedValue([]);
      mockCategoryRepository.create.mockResolvedValue(mockCategory);

      const res = await request(app)
        .post("/api/categories")
        .send({
          groupId: "550e8400-e29b-41d4-a716-446655440001",
          name: "Color Category",
          color: "#AABBCC",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.color).toBe("#AABBCC");
    });
  });

  describe("PUT /api/categories/:id - Update Category", () => {
    it("should update category name", async () => {
      const existingCat = { id: "cat-1", name: "Original", groupId: "group-1", householdId: "house-123" };
      const updatedCat = { ...existingCat, name: "Updated Category" };

      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(existingCat);
      mockCategoryRepository.update.mockResolvedValue(updatedCat);

      const res = await request(app)
        .put("/api/categories/cat-1")
        .send({
          name: "Updated Category",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.name).toBe("Updated Category");

      expect(mockBusinessAuditService.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category",
          entityId: "cat-1",
        })
      );
    });

    it("should update category icon and color", async () => {
      const existingCat = { id: "cat-1", name: "Category", groupId: "group-1", householdId: "house-123" };
      const updatedCat = { ...existingCat, icon: "new-icon", color: "#FFFFFF" };

      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(existingCat);
      mockCategoryRepository.update.mockResolvedValue(updatedCat);

      const res = await request(app)
        .put("/api/categories/cat-1")
        .send({
          icon: "new-icon",
          color: "#FFFFFF",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.icon).toBe("new-icon");
      expect(res.body.data.category.color).toBe("#FFFFFF");
    });

    it("should return 404 for non-existent category", async () => {
      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(null);

      const res = await request(app)
        .put("/api/categories/non-existent")
        .send({
          name: "Updated Name",
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/categories/:id - Delete Category", () => {
    it("should archive (soft delete) a category", async () => {
      const existingCat = { id: "cat-1", name: "Category", householdId: "house-123", isArchived: false };
      const archivedCat = { ...existingCat, isArchived: true };

      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(existingCat);
      mockCategoryRepository.update.mockResolvedValue(archivedCat);

      const res = await request(app)
        .delete("/api/categories/cat-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockBusinessAuditService.logDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "category",
          entityId: "cat-1",
        })
      );
    });

    it("should return 404 for non-existent category", async () => {
      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(null);

      const res = await request(app)
        .delete("/api/categories/non-existent")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /api/categories/:id/restore - Restore Category", () => {
    it("should restore an archived category", async () => {
      const archivedCat = { id: "cat-1", name: "Archived Cat", isArchived: true, householdId: "house-123" };
      const restoredCat = { ...archivedCat, isArchived: false };

      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(archivedCat);
      mockCategoryRepository.update.mockResolvedValue(restoredCat);

      const res = await request(app)
        .put("/api/categories/cat-1/restore")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockBusinessAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "RESTORE",
          entityType: "category",
          entityId: "cat-1",
        })
      );
    });
  });

  describe("PUT /api/categories/reorder - Reorder Categories", () => {
    it("should reorder categories successfully", async () => {
      mockCategoryRepository.reorder.mockResolvedValue(undefined);

      const categoryIds = [
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440002",
      ];

      const res = await request(app)
        .put("/api/categories/reorder")
        .send({ categoryIds })
        .expect(204);

      expect(mockCategoryRepository.reorder).toHaveBeenCalledWith(
        "house-123",
        categoryIds
      );
    });

    it("should reject reorder with empty array", async () => {
      const res = await request(app)
        .put("/api/categories/reorder")
        .send({
          categoryIds: [],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // CATEGORY SEEDING TESTS
  // =========================================================================

  describe("POST /api/categories/seed - Seed Default Categories", () => {
    it("should seed default categories for new household", async () => {
      const mockCategories = [
        { id: "cat-1", name: "Food" },
        { id: "cat-2", name: "Transport" },
      ];
      const mockGroups = [
        { id: "group-1", name: "Living Expenses" },
      ];

      // First call checks existing categories (empty means we can seed)
      // Next two calls fetch the created categories and groups
      mockCategoryRepository.findByHousehold
        .mockResolvedValueOnce([])  // Check if categories exist
        .mockResolvedValueOnce(mockCategories);  // Fetch created categories
      mockCategoryGroupRepository.findByHousehold.mockResolvedValue(mockGroups);
      mockSeedDefaultCategories.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/categories/seed")
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.categories.length).toBeGreaterThan(0);
      expect(res.body.data.groups.length).toBeGreaterThan(0);
      expect(mockSeedDefaultCategories).toHaveBeenCalledWith("house-123");
    });

    it("should reject seeding if categories already exist", async () => {
      // Simulate categories already exist
      mockCategoryRepository.findByHousehold.mockResolvedValue([
        { id: "cat-1", name: "Existing Category" }
      ]);

      const res = await request(app)
        .post("/api/categories/seed")
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CONFLICT");
    });
  });

  // =========================================================================
  // AUDIT LOGGING VERIFICATION
  // =========================================================================

  describe("Audit Logging", () => {
    it("should create exactly one audit entry per group creation", async () => {
      const mockGroup = { id: "group-1", name: "Test", type: "expense", householdId: "house-123", displayOrder: 1 };
      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      await request(app)
        .post("/api/categories/groups")
        .send({ name: "Test", type: "expense" })
        .expect(201);

      expect(mockBusinessAuditService.logCreate).toHaveBeenCalledTimes(1);
    });

    it("should create exactly one audit entry per category update", async () => {
      const existingCat = { id: "cat-1", name: "Original", householdId: "house-123" };
      const updatedCat = { ...existingCat, name: "Updated" };
      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(existingCat);
      mockCategoryRepository.update.mockResolvedValue(updatedCat);

      await request(app)
        .put("/api/categories/cat-1")
        .send({ name: "Updated" })
        .expect(200);

      expect(mockBusinessAuditService.logUpdate).toHaveBeenCalledTimes(1);
    });

    it("should create audit entry for category deletion", async () => {
      const existingCat = { id: "cat-1", name: "Cat", householdId: "house-123", isArchived: false };
      const archivedCat = { ...existingCat, isArchived: true };
      mockCategoryRepository.findByIdAndHousehold.mockResolvedValue(existingCat);
      mockCategoryRepository.update.mockResolvedValue(archivedCat);

      await request(app)
        .delete("/api/categories/cat-1")
        .expect(200);

      expect(mockBusinessAuditService.logDelete).toHaveBeenCalledTimes(1);
    });

    it("should create audit entry for group restore", async () => {
      const archivedGroup = { id: "group-1", name: "Group", isArchived: true, householdId: "house-123" };
      const restoredGroup = { ...archivedGroup, isArchived: false };
      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(archivedGroup);
      mockCategoryGroupRepository.update.mockResolvedValue(restoredGroup);

      await request(app)
        .put("/api/categories/groups/group-1/restore")
        .expect(200);

      expect(mockBusinessAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "RESTORE",
          entityType: "category_group",
        })
      );
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================

  describe("Edge Cases - Special Characters", () => {
    it("should allow special characters in group name", async () => {
      const mockGroup = {
        id: "group-special",
        name: "Group with Special & Chars! (2024)",
        type: "expense",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: "Group with Special & Chars! (2024)",
          type: "expense",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.name).toBe("Group with Special & Chars! (2024)");
    });

    it("should allow unicode characters in category name", async () => {
      const mockGroup = { id: "550e8400-e29b-41d4-a716-446655440001", householdId: "house-123" };
      const mockCategory = {
        id: "cat-unicode",
        name: "Groceries • Food & Beverages",
        groupId: "550e8400-e29b-41d4-a716-446655440001",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(mockGroup);
      mockCategoryRepository.findByGroup.mockResolvedValue([]);
      mockCategoryRepository.create.mockResolvedValue(mockCategory);

      const res = await request(app)
        .post("/api/categories")
        .send({
          groupId: "550e8400-e29b-41d4-a716-446655440001",
          name: "Groceries • Food & Beverages",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe("Edge Cases - Validation", () => {
    it("should reject name exceeding 100 characters", async () => {
      const longName = "a".repeat(101);
      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: longName,
          type: "expense",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept max length names (100 characters)", async () => {
      const maxLengthName = "a".repeat(100);
      const mockGroup = {
        id: "group-max",
        name: maxLengthName,
        type: "income",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByHousehold.mockResolvedValue([]);
      mockCategoryGroupRepository.create.mockResolvedValue(mockGroup);

      const res = await request(app)
        .post("/api/categories/groups")
        .send({
          name: maxLengthName,
          type: "income",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.group.name).toBe(maxLengthName);
    });

    it("should create category with minimal data (only required fields)", async () => {
      const mockGroup = { id: "550e8400-e29b-41d4-a716-446655440001", householdId: "house-123" };
      const mockCategory = {
        id: "cat-minimal",
        name: "Minimal Category",
        groupId: "550e8400-e29b-41d4-a716-446655440001",
        householdId: "house-123",
        displayOrder: 1,
      };

      mockCategoryGroupRepository.findByIdAndHousehold.mockResolvedValue(mockGroup);
      mockCategoryRepository.findByGroup.mockResolvedValue([]);
      mockCategoryRepository.create.mockResolvedValue(mockCategory);

      const res = await request(app)
        .post("/api/categories")
        .send({
          groupId: "550e8400-e29b-41d4-a716-446655440001",
          name: "Minimal Category",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.category.name).toBe("Minimal Category");
    });
  });
});
