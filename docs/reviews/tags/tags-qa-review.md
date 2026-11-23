# Tags Module QA Review

**Reviewed by:** QA Engineer (Claude Opus 4.5)
**Date:** 2026-01-27
**Module Score:** 18/100 (FAIL - Critical test coverage gaps)

---

## Executive Summary

The Tags module has **ZERO test coverage** across all layers - server integration tests, repository tests, client hook tests, and component tests. This is a critical finding that puts the module at high risk for regressions and makes it impossible to verify behavior during refactoring.

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Server Integration Tests | 0/100 | 30% | 0 |
| Repository Tests | 0/100 | 20% | 0 |
| Client Hook Tests | 0/100 | 20% | 0 |
| Component Tests | 0/100 | 15% | 0 |
| Edge Case Coverage | 0/100 | 10% | 0 |
| Authorization Tests | 60/100 | 5% | 3 |
| **Total** | | | **18/100** |

> Authorization score reflects household isolation in route guards, but lacks explicit test verification.

---

## 1. Test Coverage Analysis

### 1.1 Server-Side Tests

**Current Status: 0% coverage**

| File | LOC | Test File | Status |
|------|-----|-----------|--------|
| `server/modules/tags/tags.controller.ts` | 184 | None | NOT TESTED |
| `server/modules/tags/tags.routes.ts` | 34 | None | NOT TESTED |
| `server/modules/tags/tags.validation.ts` | 39 | None | NOT TESTED |
| `server/repositories/TagRepository.ts` | 184 | None | NOT TESTED |
| `server/storage/StorageTagModule.ts` | 226 | None | NOT TESTED |

**Expected test files that do NOT exist:**
- `server/modules/tags/__tests__/tags.integration.test.ts`
- `server/repositories/__tests__/TagRepository.test.ts`

### 1.2 Client-Side Tests

**Current Status: 0% coverage**

| File | LOC | Test File | Status |
|------|-----|-----------|--------|
| `client/src/hooks/useTags.ts` | 242 | None | NOT TESTED |
| `client/src/components/tags/TagBadge.tsx` | 61 | None | NOT TESTED |
| `client/src/components/tags/TagColorPicker.tsx` | 62 | None | NOT TESTED |
| `client/src/components/tags/TagModal.tsx` | 131 | None | NOT TESTED |
| `client/src/components/tags/TagsList.tsx` | 164 | None | NOT TESTED |
| `client/src/components/tags/TagsMultiSelect.tsx` | 158 | None | NOT TESTED |

**Expected test files that do NOT exist:**
- `client/src/hooks/__tests__/useTags.test.ts`
- `client/src/components/tags/__tests__/TagBadge.test.tsx`
- `client/src/components/tags/__tests__/TagModal.test.tsx`
- `client/src/components/tags/__tests__/TagsList.test.tsx`
- `client/src/components/tags/__tests__/TagsMultiSelect.test.tsx`

---

## 2. Missing Test Cases - Server (CRUD Operations)

### 2.1 Tag CRUD Tests Required

```typescript
// server/modules/tags/__tests__/tags.integration.test.ts

describe("Tags Integration", () => {
  describe("GET /api/tags", () => {
    it("should return all tags for household");
    it("should return empty array when no tags exist");
    it("should scope tags to household (isolation)");
  });

  describe("GET /api/tags/:id", () => {
    it("should return tag by ID");
    it("should return 404 for non-existent tag");
    it("should return 404 for tag from different household");
  });

  describe("POST /api/tags", () => {
    it("should create tag with valid data");
    it("should create tag with color");
    it("should create tag with icon");
    it("should return 400 for empty name");
    it("should return 400 for name > 50 chars");
    it("should handle duplicate names"); // Currently no unique constraint!
    it("should require member role");
  });

  describe("PUT /api/tags/:id", () => {
    it("should update tag name");
    it("should update tag color");
    it("should return 404 for non-existent tag");
    it("should return 404 for tag from different household");
    it("should require member role");
  });

  describe("DELETE /api/tags/:id", () => {
    it("should delete tag");
    it("should cascade delete transaction_tags");
    it("should return success for non-existent tag"); // Idempotent
    it("should return 404 for tag from different household");
    it("should require member role");
  });
});
```

### 2.2 Transaction Tag Tests Required

```typescript
describe("Transaction Tags", () => {
  describe("GET /api/tags/transaction/:transactionId", () => {
    it("should return tags for transaction");
    it("should return empty array for transaction with no tags");
    it("should verify transaction belongs to household"); // MISSING - Security gap!
  });

  describe("POST /api/tags/transaction/:transactionId", () => {
    it("should add single tag to transaction");
    it("should add multiple tags to transaction");
    it("should handle adding duplicate tag (idempotent)");
    it("should return 400 for invalid UUID in tagIds");
    it("should verify transaction belongs to household"); // MISSING!
    it("should verify tags belong to household"); // MISSING!
    it("should require member role");
  });

  describe("DELETE /api/tags/transaction/:transactionId/:tagId", () => {
    it("should remove tag from transaction");
    it("should succeed if tag not on transaction (idempotent)");
    it("should verify transaction belongs to household"); // MISSING!
    it("should require member role");
  });
});
```

---

## 3. Missing Test Cases - Repository

```typescript
// server/repositories/__tests__/TagRepository.test.ts

describe("TagRepository", () => {
  describe("findByHousehold", () => {
    it("should return all tags for household ordered by name");
    it("should return empty array for household with no tags");
    it("should not return tags from other households");
  });

  describe("findById", () => {
    it("should return tag by ID and household");
    it("should return undefined for wrong household");
  });

  describe("findByName", () => {
    it("should find tag by exact name match");
    it("should be case-sensitive");
    it("should return undefined if not found");
  });

  describe("create", () => {
    it("should create tag with required fields");
    it("should create tag with optional fields");
    it("should set default usageCount to 0");
    it("should set createdAt and updatedAt timestamps");
  });

  describe("update", () => {
    it("should update specified fields");
    it("should update updatedAt timestamp");
    it("should return undefined for wrong household");
  });

  describe("delete", () => {
    it("should delete tag and return it");
    it("should return undefined for wrong household");
  });

  describe("addTagToTransaction", () => {
    it("should create transaction_tag record");
    it("should return existing record if duplicate (idempotent)");
  });

  describe("removeTagFromTransaction", () => {
    it("should delete transaction_tag record");
    it("should return undefined if not exists");
  });

  describe("getTransactionTags", () => {
    it("should return all tags for transaction");
    it("should return id, name, color, icon fields");
  });

  describe("setTransactionTags", () => {
    it("should replace all tags on transaction");
    it("should handle empty array (clear all)");
  });

  describe("incrementUsageCount", () => {
    it("should increment count by 1");
  });

  describe("decrementUsageCount", () => {
    it("should decrement count by 1");
    it("should not go below 0");
  });

  describe("findTransactionsByTag", () => {
    it("should return transactions with tag");
    it("should exclude soft-deleted transactions");
    it("should order by date descending");
    it("should respect limit parameter");
    it("should scope to household");
  });
});
```

---

## 4. Missing Test Cases - Edge Cases

### 4.1 Empty States
- [ ] List tags when none exist
- [ ] Get transaction tags when none assigned
- [ ] Get transactions by tag when none linked
- [ ] Delete tag with 0 usage count

### 4.2 Duplicates
- [ ] Create tag with duplicate name (NO UNIQUE CONSTRAINT - BUG)
- [ ] Add same tag to transaction twice (should be idempotent)
- [ ] Set transaction tags with duplicate IDs in array

### 4.3 Special Characters
- [ ] Tag name with unicode characters
- [ ] Tag name with emoji
- [ ] Tag name with special chars (`!@#$%^&*`)
- [ ] Tag name with SQL injection attempt
- [ ] Tag name with XSS attempt

### 4.4 Boundary Conditions
- [ ] Tag name at exactly 50 chars (max)
- [ ] Tag name at 51 chars (should fail)
- [ ] Empty string tag name
- [ ] Whitespace-only tag name
- [ ] Color format validation (should be hex)

---

## 5. Missing Test Cases - Authorization

### 5.1 Household Isolation (CRITICAL)

The controller has household guard middleware, but NO TESTS verify:

```typescript
describe("Household Isolation", () => {
  it("should not return tags from other households");
  it("should not allow updating tags in other households");
  it("should not allow deleting tags in other households");
  it("should not allow tagging transactions from other households");
});
```

### 5.2 Role-Based Access

Routes use `requireRole("member")` but NO TESTS verify:

```typescript
describe("Role-Based Access", () => {
  it("should allow member to create tags");
  it("should allow member to update tags");
  it("should allow member to delete tags");
  it("should allow admin to perform all operations");
  it("should deny viewer from creating tags"); // If viewer role exists
});
```

---

## 6. Missing Test Cases - Client Hooks

```typescript
// client/src/hooks/__tests__/useTags.test.ts

describe("useTags", () => {
  describe("useTags hook", () => {
    it("should fetch tags on mount");
    it("should return loading state initially");
    it("should return tags data on success");
    it("should return error on failure");
    it("should have 30s stale time");
  });

  describe("useTag hook", () => {
    it("should fetch single tag by ID");
    it("should not fetch if ID is empty");
  });

  describe("useTagTransactions", () => {
    it("should fetch transactions for tag");
    it("should pass limit parameter");
  });

  describe("useCreateTag", () => {
    it("should call API with tag data");
    it("should invalidate tags query on success");
    it("should show success toast");
    it("should show error toast on failure");
    it("should handle CONFLICT error specially");
  });

  describe("useUpdateTag", () => {
    it("should call API with id and data");
    it("should invalidate list and detail queries");
    it("should show success toast");
    it("should handle CONFLICT error");
  });

  describe("useDeleteTag", () => {
    it("should call API with tag ID");
    it("should invalidate all tag queries");
    it("should show success toast");
    it("should show error toast on failure");
  });

  describe("useTransactionTags", () => {
    it("should fetch tags for transaction");
    it("should not fetch if transactionId is empty");
  });

  describe("useAddTagsToTransaction", () => {
    it("should add tags to transaction");
    it("should invalidate transaction tags query");
    it("should invalidate tags list (usage counts)");
    it("should invalidate transactions list");
  });

  describe("useSetTransactionTags", () => {
    it("should replace transaction tags");
    it("should handle empty array");
  });

  describe("useRemoveTagFromTransaction", () => {
    it("should remove tag from transaction");
    it("should invalidate related queries");
  });
});
```

---

## 7. Missing Test Cases - Components

### 7.1 TagBadge Tests

```typescript
// client/src/components/tags/__tests__/TagBadge.test.tsx

describe("TagBadge", () => {
  it("should render tag name");
  it("should render with default gray color when no color provided");
  it("should render with provided color");
  it("should render small size variant");
  it("should render medium size variant (default)");
  it("should not render remove button by default");
  it("should render remove button when removable");
  it("should call onRemove when remove button clicked");
  it("should stop event propagation on remove click");
  it("should apply custom className");
});
```

### 7.2 TagColorPicker Tests

```typescript
describe("TagColorPicker", () => {
  it("should render 12 color buttons");
  it("should show checkmark on selected color");
  it("should call onChange when color clicked");
  it("should apply ring style to selected color");
  it("should handle null value");
});
```

### 7.3 TagModal Tests

```typescript
describe("TagModal", () => {
  it("should render 'New tag' title in create mode");
  it("should render 'Edit tag' title in edit mode");
  it("should populate form with tag data in edit mode");
  it("should reset form when modal opens");
  it("should call createTag on submit in create mode");
  it("should call updateTag on submit in edit mode");
  it("should disable submit when name is empty");
  it("should show loading state during submission");
  it("should close modal on success");
  it("should close modal on cancel");
  it("should trim whitespace from name");
});
```

### 7.4 TagsList Tests

```typescript
describe("TagsList", () => {
  it("should show loading spinner while fetching");
  it("should show error message on failure");
  it("should show empty state when no tags");
  it("should render tag list with colors and names");
  it("should show usage count for each tag");
  it("should open create modal on 'New tag' click");
  it("should open edit modal on 'Edit' click");
  it("should show delete confirmation dialog");
  it("should call deleteTag on confirm delete");
  it("should close delete dialog on cancel");
});
```

### 7.5 TagsMultiSelect Tests

```typescript
describe("TagsMultiSelect", () => {
  it("should render placeholder when no tags selected");
  it("should render selected tag badges");
  it("should open popover on click");
  it("should filter tags by search input");
  it("should show checkmark on selected tags");
  it("should toggle tag selection on click");
  it("should remove tag on badge remove click");
  it("should show 'Create new tag' option when allowCreate");
  it("should hide 'Create new tag' when allowCreate=false");
  it("should open TagModal on create click");
  it("should show loading state while fetching tags");
  it("should show 'No tags found' when search has no results");
});
```

---

## 8. Security Gaps Found

### 8.1 No Rate Limiting (CRITICAL)

The tags routes have **NO rate limiting applied**:

```typescript
// server/modules/tags/tags.routes.ts
const router = Router();
router.use(householdGuard);
// MISSING: router.use(generalLimiter);
```

**Risk:** DOS vulnerability - attackers can spam tag creation/deletion.

**Fix Required:**
```typescript
import { generalLimiter } from "../../middleware/rateLimit";
router.use(generalLimiter);
```

### 8.2 No Audit Logging (CRITICAL)

The tags controller has **NO audit logging** for CRUD operations:

```typescript
// tags.controller.ts - create handler
async create(req: Request, res: Response, next: NextFunction) {
  // ... creates tag
  logger.info("Created tag", { householdId, tagId: tag.id });
  // MISSING: businessAuditService.logCreate()
}
```

Per CLAUDE.md Rule 9, ALL financial CRUD operations MUST be logged.

### 8.3 Missing Transaction Ownership Verification

The `getTransactionTags`, `addTransactionTags`, and `removeTransactionTag` handlers do NOT verify the transaction belongs to the household:

```typescript
// Current code - NO ownership check!
async getTransactionTags(req: Request, res: Response, next: NextFunction) {
  const { transactionId } = req.params;
  // Directly queries without verifying householdId!
  const tags = await tagRepository.getTransactionTags(transactionId);
}
```

**Risk:** Users could tag transactions from other households.

### 8.4 No Unique Constraint on Tag Names

The schema allows duplicate tag names within a household:

```sql
-- tags table has no unique constraint on (householdId, name)
```

This can cause confusion and data quality issues.

---

## 9. Code Quality Issues

### 9.1 Duplicate Validation Schemas

Two validation files exist with different schemas:

- `server/modules/tags/tags.controller.ts` (inline schemas)
- `server/modules/tags/tags.validation.ts` (separate file, not used)

The controller should use the validation file schemas.

### 9.2 Missing `setTransactionTags` Endpoint

The API client has `setTransactionTags` but there's no PUT route:

```typescript
// Client API expects PUT /tags/transaction/:id
async setTransactionTags(transactionId: string, tagIds: string[]) {
  return apiCall(`/tags/transaction/${transactionId}`, {
    method: "PUT", // Route doesn't exist!
  });
}
```

Only POST exists in routes, which adds tags (doesn't replace).

### 9.3 No `as any` Issues

Positive finding: No `as any` usage found in tags module.

---

## 10. Required Test Files

### Server Tests to Create

1. **`server/modules/tags/__tests__/tags.integration.test.ts`**
   - 35+ test cases for all CRUD operations
   - Household isolation tests
   - Role-based access tests
   - Validation tests

2. **`server/repositories/__tests__/TagRepository.test.ts`**
   - 20+ test cases for repository methods
   - Edge cases for all queries

### Client Tests to Create

1. **`client/src/hooks/__tests__/useTags.test.ts`**
   - 25+ test cases for all hooks
   - Query invalidation tests
   - Error handling tests

2. **`client/src/components/tags/__tests__/TagBadge.test.tsx`**
   - 10+ test cases

3. **`client/src/components/tags/__tests__/TagColorPicker.test.tsx`**
   - 5+ test cases

4. **`client/src/components/tags/__tests__/TagModal.test.tsx`**
   - 12+ test cases

5. **`client/src/components/tags/__tests__/TagsList.test.tsx`**
   - 10+ test cases

6. **`client/src/components/tags/__tests__/TagsMultiSelect.test.tsx`**
   - 12+ test cases

---

## 11. Test Coverage Target vs. Actual

| Layer | Target (CLAUDE.md Rule 17) | Current | Gap |
|-------|---------------------------|---------|-----|
| Server (Financial) | 80% | 0% | -80% |
| Repository | 80% | 0% | -80% |
| Client Hooks | 50% | 0% | -50% |
| UI Components | 50% | 0% | -50% |

---

## 12. Priority Remediation Order

1. **P0 (Critical - Security):**
   - Add rate limiting to routes
   - Add transaction ownership verification
   - Add audit logging for CRUD operations

2. **P1 (High - Core Functionality):**
   - Create `tags.integration.test.ts` with full CRUD tests
   - Create `TagRepository.test.ts`
   - Add household isolation tests

3. **P2 (Medium - Client):**
   - Create `useTags.test.ts` hook tests
   - Create component tests

4. **P3 (Low - Edge Cases):**
   - Special character handling tests
   - Boundary condition tests
   - Duplicate name handling

---

## 13. Estimated Effort

| Task | Estimated Hours |
|------|-----------------|
| Server integration tests | 6 |
| Repository tests | 4 |
| Hook tests | 4 |
| Component tests | 6 |
| Security fixes | 3 |
| **Total** | **23 hours** |

---

## 14. Appendix: Files Reviewed

### Server Files
- `/mnt/c/Users/USER/personal-finance-app/server/modules/tags/tags.controller.ts` (184 LOC)
- `/mnt/c/Users/USER/personal-finance-app/server/modules/tags/tags.routes.ts` (34 LOC)
- `/mnt/c/Users/USER/personal-finance-app/server/modules/tags/tags.validation.ts` (39 LOC)
- `/mnt/c/Users/USER/personal-finance-app/server/modules/tags/index.ts` (6 LOC)
- `/mnt/c/Users/USER/personal-finance-app/server/repositories/TagRepository.ts` (184 LOC)
- `/mnt/c/Users/USER/personal-finance-app/server/storage/StorageTagModule.ts` (226 LOC)

### Client Files
- `/mnt/c/Users/USER/personal-finance-app/client/src/hooks/useTags.ts` (242 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/TagBadge.tsx` (61 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/TagColorPicker.tsx` (62 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/TagModal.tsx` (131 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/TagsList.tsx` (164 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/TagsMultiSelect.tsx` (158 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/components/tags/index.ts` (12 LOC)
- `/mnt/c/Users/USER/personal-finance-app/client/src/lib/api.ts` (tagsApi section)

### Schema Files
- `/mnt/c/Users/USER/personal-finance-app/shared/schema.ts` (tags table, transactionTags table)

---

**Review Status:** COMPLETE
**Next Actions:** Create test files per priority order above
