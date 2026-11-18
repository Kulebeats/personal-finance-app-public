# Categories Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (74/100)
**Status:** Closed (Re-audited 2026-02-07)

---
## Re-Audit 2026-02-07

This plan is closed and retained for historical context.

- Security items from this plan are implemented:
- Household scoping/authorization checks on group/category mutations.
- `includeArchived` query support is implemented.
- Missing API endpoints (`/seed`, `/reorder`, archive/restore) are implemented.
- Rate limiting and audit logging are present.
- Integration/security tests exist in `server/modules/categories/__tests__/`.

No active backlog items from this plan remain after code verification.

---

## Executive Summary

The Categories module has good architecture and excellent audit logging/rate limiting compliance, but has a **critical security flaw**: group mutations don't verify household ownership, enabling cross-tenant data modification. Additionally, all 27 integration tests are stubs with 0% actual coverage. This plan addresses all 18 issues identified.

---

## Issue Registry

### Phase 1: Security Critical (P0) - 2 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| SEC-001 | Missing household authorization on `updateGroup` | `controller.ts:109` | Cross-tenant modification | 30 min |
| SEC-002 | Missing household authorization on `deleteGroup`, `restoreGroup` | `controller.ts:141,167` | Cross-tenant modification | 30 min |

**Phase 1 Total Effort:** ~1 hour

### Phase 2: Validation & Type Safety (P1) - 4 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| VAL-001 | Duplicate validation schemas with different enums | `controller.ts` vs `validation.ts` | Inconsistent validation | 1 hour |
| VAL-002 | `includeArchived` query param not implemented | `controller.ts:getAll` | Client expects it | 30 min |
| TYPE-001 | Missing `CategoryType` import in controller | `controller.ts` | Type safety | 15 min |
| TYPE-002 | Inconsistent error messages | Multiple locations | UX inconsistency | 30 min |

**Phase 2 Total Effort:** ~2.25 hours

### Phase 3: Test Coverage (P1) - 3 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | 27 integration tests are stubs | `categories.integration.test.ts` | 27 | 5 hours |
| TEST-002 | Missing repository tests | - | 15 | 3 hours |
| TEST-003 | Missing client component tests | `CategoriesSection/` | 20 | 4 hours |

**Phase 3 Total Effort:** ~12 hours (62 test cases)

### Phase 4: API Completeness (P1) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| API-001 | Missing `/seed` endpoint | `routes.ts` | Client hook expects it | 2 hours |
| API-002 | Missing `/reorder` endpoint | `routes.ts` | Drag-drop reorder broken | 2 hours |
| API-003 | Missing `PATCH /:id/archive` endpoint | `routes.ts` | Soft delete not exposed | 1 hour |

**Phase 4 Total Effort:** ~5 hours

### Phase 5: Accessibility (P2) - 3 Issues

| ID | Issue | Location | WCAG | Effort |
|----|-------|----------|------|--------|
| A11Y-001 | Missing aria-label on color picker | `CategoryDialog.tsx` | 4.1.2 | 20 min |
| A11Y-002 | No keyboard reorder support | `DraggableCategoryItem.tsx` | 2.1.1 | 1 hour |
| A11Y-003 | Focus not returned after dialog close | `CategoryDialog.tsx` | 2.4.3 | 30 min |

**Phase 5 Total Effort:** ~2 hours

### Phase 6: Code Quality (P2) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| CODE-001 | Audit logging records incorrect householdId (due to SEC-001) | `controller.ts` | Forensics issue | Fixed by SEC-001 |
| CODE-002 | Missing JSDoc on public functions | `controller.ts` | Documentation | 1 hour |
| CODE-003 | Hardcoded default categories list | `controller.ts` | Should be configurable | 2 hours |

**Phase 6 Total Effort:** ~3 hours

---

## Total Issue Count: 18

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Security | 2 | P0 | 1 hour |
| Phase 2: Validation | 4 | P1 | 2.25 hours |
| Phase 3: Test Coverage | 3 | P1 | 12 hours |
| Phase 4: API Completeness | 3 | P1 | 5 hours |
| Phase 5: Accessibility | 3 | P2 | 2 hours |
| Phase 6: Code Quality | 3 | P2 | 3 hours |
| **TOTAL** | **18** | | **25.25 hours** |

---

## Implementation Details

### Phase 1: Security Critical

#### SEC-001 & SEC-002: Add Household Authorization on Group Mutations

**File:** `server/modules/categories/categories.controller.ts`

The issue is that group mutations fetch the group by ID but don't verify it belongs to the requesting user's household.

```typescript
// CURRENT CODE (VULNERABLE)
export async function updateGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = updateGroupSchema.parse(req.body);

  // âŒ NO CHECK: Does this group belong to the user's household?
  const group = await categoryRepository.updateGroup(id, data);
  // ...
}

// FIXED CODE
export async function updateGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { householdId, userId } = req.householdContext!;
  const data = updateGroupSchema.parse(req.body);

  // âœ… ADD: Verify group belongs to household
  const existingGroup = await categoryRepository.findGroupById(id);
  if (!existingGroup || existingGroup.householdId !== householdId) {
    throw new NotFoundError("Category group not found");
  }

  const group = await categoryRepository.updateGroup(id, data);

  await businessAuditService.logUpdate({
    householdId,
    userId,
    entityType: "category_group",
    entityId: id,
    details: { name: group.name },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, mapGroupToDto(group));
}
```

Apply the same pattern to `deleteGroup` and `restoreGroup`:

```typescript
// deleteGroup - line 141
export async function deleteGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { householdId, userId } = req.householdContext!;

  // âœ… ADD: Verify group belongs to household
  const existingGroup = await categoryRepository.findGroupById(id);
  if (!existingGroup || existingGroup.householdId !== householdId) {
    throw new NotFoundError("Category group not found");
  }

  await categoryRepository.deleteGroup(id);
  // ... audit logging
}

// restoreGroup - line 167
export async function restoreGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { householdId, userId } = req.householdContext!;

  // âœ… ADD: Verify group belongs to household
  const existingGroup = await categoryRepository.findGroupById(id);
  if (!existingGroup || existingGroup.householdId !== householdId) {
    throw new NotFoundError("Category group not found");
  }

  const group = await categoryRepository.restoreGroup(id);
  // ... audit logging
}
```

**Also add to CategoryRepository if missing:**

```typescript
async findGroupById(id: string): Promise<CategoryGroup | undefined> {
  const [group] = await db
    .select()
    .from(categoryGroups)
    .where(eq(categoryGroups.id, id))
    .limit(1);
  return group;
}
```

### Phase 2: Validation & Type Safety

#### VAL-001: Consolidate Validation Schemas

**Issue:** Controller has inline schemas with different enums than the validation file.

```typescript
// BEFORE: controller.ts has inline schemas
const createCategorySchema = z.object({
  type: z.enum(["income", "expense"]),  // Different from validation.ts
  // ...
});

// AFTER: Import from validation file
import {
  createCategorySchema,
  updateCategorySchema,
  createGroupSchema,
  updateGroupSchema
} from "./categories.validation";
```

**Update validation.ts to be the single source of truth:**

```typescript
// categories.validation.ts
import { z } from "zod";

export const categoryTypeSchema = z.enum(["income", "expense", "transfer"]);

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  type: categoryTypeSchema,
  groupId: z.string().uuid().optional(),
  icon: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  type: categoryTypeSchema,
});

export const updateGroupSchema = createGroupSchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
```

#### VAL-002: Implement `includeArchived` Query Param

```typescript
// categories.controller.ts - getAll function
export async function getAll(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;
  const includeArchived = req.query.includeArchived === "true";

  const categories = await categoryRepository.findAll(householdId, { includeArchived });
  success(res, categories.map(mapCategoryToDto));
}
```

### Phase 3: Test Coverage

#### TEST-001: Replace Stub Tests with Real Tests

**File:** `server/modules/categories/__tests__/categories.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestUser, createTestHousehold, cleanupTestData } from "../../../test/factories";

describe("Categories API", () => {
  let authCookie: string;
  let householdId: string;

  beforeEach(async () => {
    const { user, household, cookie } = await createTestUser();
    authCookie = cookie;
    householdId = household.id;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("POST /api/categories", () => {
    it("should create a category with valid data", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Cookie", authCookie)
        .send({ name: "Groceries", type: "expense" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Groceries");
    });

    it("should reject invalid type", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Cookie", authCookie)
        .send({ name: "Test", type: "invalid" });

      expect(response.status).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/categories")
        .send({ name: "Test", type: "expense" });

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /api/categories/groups/:id (Authorization)", () => {
    it("should reject update of group from other household", async () => {
      // Create group in different household
      const { household: otherHousehold } = await createTestUser();
      const otherGroup = await createCategoryGroup(otherHousehold.id, "Other");

      // Try to update from our household
      const response = await request(app)
        .put(`/api/categories/groups/${otherGroup.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Hacked" });

      expect(response.status).toBe(404);  // Should not find it
    });
  });

  // ... 27 total test cases
});
```

### Phase 4: API Completeness

#### API-001: Add Seed Endpoint

```typescript
// categories.routes.ts
router.post("/seed", generalLimiter, controller.seedDefaults);

// categories.controller.ts
export async function seedDefaults(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  // Check if already seeded
  const existing = await categoryRepository.findAll(householdId);
  if (existing.length > 0) {
    throw new ConflictError("Categories already exist for this household");
  }

  const defaults = getDefaultCategories();
  const created = await categoryRepository.seedDefaults(householdId, defaults);

  await businessAuditService.log({
    householdId,
    userId,
    action: "CREATE",
    entityType: "category",
    entityId: "seed",
    details: { count: created.length, action: "seed_defaults" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  success(res, created.map(mapCategoryToDto));
}
```

#### API-002: Add Reorder Endpoint

```typescript
// categories.routes.ts
router.put("/reorder", generalLimiter, controller.reorder);

// categories.controller.ts
const reorderSchema = z.object({
  categoryIds: z.array(z.string().uuid()),
});

export async function reorder(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { categoryIds } = reorderSchema.parse(req.body);

  // Verify all categories belong to household
  const categories = await categoryRepository.findByIds(categoryIds, householdId);
  if (categories.length !== categoryIds.length) {
    throw new NotFoundError("One or more categories not found");
  }

  await categoryRepository.reorder(categoryIds);

  await businessAuditService.log({
    householdId,
    userId,
    action: "UPDATE",
    entityType: "category",
    entityId: "reorder",
    details: { categoryIds, action: "reorder" },
    ipAddress: businessAuditService.getIpAddress(req),
  });

  noContent(res);
}
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify authorization checks added
grep -n "householdId !== householdId\|findGroupById" server/modules/categories/categories.controller.ts
# Should find authorization checks in updateGroup, deleteGroup, restoreGroup

# Security test (manual)
# 1. Create two users in different households
# 2. User A creates a category group
# 3. User B tries to update/delete User A's group
# Expected: 404 Not Found
```

### After Phase 2
```bash
# Verify single validation source
grep -n "z.object" server/modules/categories/categories.controller.ts
# Should return 0 (all schemas imported from validation.ts)

# Verify includeArchived works
curl -X GET "http://localhost:5000/api/categories?includeArchived=true" -H "Cookie: ..."
```

### After Phase 3
```bash
# Run tests
npm run test:server:run -- --grep "Categories"

# Verify no stub tests remain
grep -rn "expect(true).toBe(true)" server/modules/categories/__tests__/
# Should return 0 matches
```

### Full Verification
```bash
npm run check              # TypeScript must pass
npm run test:run           # Client tests must pass
npm run test:server:run    # Server tests must pass
```

---

## Success Criteria

### Phase 1 Complete When:
- [ ] `updateGroup` verifies group belongs to household before mutation
- [ ] `deleteGroup` verifies group belongs to household before mutation
- [ ] `restoreGroup` verifies group belongs to household before mutation
- [ ] Cross-household mutation test fails with 404
- [ ] Audit logs record correct householdId

### Phase 2 Complete When:
- [ ] All validation schemas imported from `categories.validation.ts`
- [ ] `includeArchived` query param works on GET /categories
- [ ] CategoryType properly imported and used
- [ ] Error messages consistent across endpoints

### Phase 3 Complete When:
- [ ] Zero stub tests remain
- [ ] 27 real integration tests pass
- [ ] 15 repository tests pass
- [ ] Coverage reaches 50%+

### Phase 4 Complete When:
- [ ] `/seed` endpoint creates default categories
- [ ] `/reorder` endpoint updates category order
- [ ] Client drag-drop reorder works end-to-end

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 1 hour | Day 1 (PRIORITY) |
| Phase 2 | 2.25 hours | Day 1 |
| Phase 3 | 12 hours | Days 2-3 |
| Phase 4 | 5 hours | Day 4 |
| Phase 5 | 2 hours | Day 4 |
| Phase 6 | 3 hours | Day 5 |
| **Total** | **25.25 hours** | **~5 days** |

---

## References

- [Categories Module Assessment](../../../reviews/categories/categories-module-assessment.md)

