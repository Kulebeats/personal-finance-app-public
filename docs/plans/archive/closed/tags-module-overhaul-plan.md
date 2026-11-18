# Tags Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (49/100 - CRITICAL FAILURE)
**Status:** Closed and Archived (2026-02-07)

---
## Re-Audit 2026-02-07

The plan's original deployment blocker is no longer applicable.

- Security-critical tagging authorization is implemented via service-layer transaction visibility checks.
- Route guards and rate limiting are present.
- Audit logging is present for tag CRUD and transaction tag link/unlink operations.
- API completeness items (`merge`, archive route, set transaction tags) are implemented.
- Integration tests exist and are active.
- Plan archived at `docs/plans/archive/closed/tags-module-overhaul-plan.md`.

No active security-blocking backlog items from this plan remain after code verification.

Historical plan content below is retained for traceability and includes original unchecked implementation checklist items.

---

## Executive Summary

The Tags module has **CRITICAL SECURITY VULNERABILITIES** requiring immediate remediation. The authorization bypass (SEC-001) allows any authenticated user to access tags on ANY transaction in ANY household. This plan addresses all 38 issues identified across the 5-skill reviews, with security fixes prioritized as blocking for deployment.

---

## Issue Registry

### Phase 1: Security Critical (P0) - 5 Issues - BLOCK DEPLOYMENT

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| SEC-001 | Authorization bypass: no household verification on transaction tag ops | `controller.ts:143-182` | **DATA BREACH** | 2 hours |
| SEC-002 | No visibility check for private transactions | `controller.ts:143-182` | Privacy violation | 1 hour |
| SEC-003 | No cross-household validation on tag-transaction link | `TagRepository.ts` | Data tampering | 1 hour |
| RATE-001 | Zero rate limiting on all 8 endpoints | `tags.routes.ts` | DOS vulnerability | 15 min |
| AUDIT-001 | Zero audit logging for create/update/delete | `controller.ts` | Compliance failure | 1.5 hours |

**Phase 1 Total Effort:** ~6 hours

### Phase 2: Architecture & Error Handling (P1) - 8 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| ARCH-001 | No service layer - controller directly accesses repository | `controller.ts` | Architecture violation | 3 hours |
| ERR-001 | Manual 404 response instead of NotFoundError | `controller.ts:113` | Inconsistent errors | 15 min |
| ERR-002 | Manual 404 response instead of NotFoundError | `controller.ts:136` | Inconsistent errors | 15 min |
| ERR-003 | Custom success() function instead of core/http import | `controller.ts:8-10` | Code duplication | 15 min |
| VAL-001 | Duplicate validation schemas in controller vs validation file | `controller.ts:12-30` | Maintenance burden | 30 min |
| VAL-002 | No unique name validation - duplicates allowed | `controller.ts` | Data quality | 30 min |
| RACE-001 | Race condition in addTagToTransaction (no FOR UPDATE) | `TagRepository.ts` | Duplicate links | 1 hour |
| DATA-001 | Usage count methods exist but never called | `TagRepository.ts` | Counts always 0 | 30 min |

**Phase 2 Total Effort:** ~6 hours

### Phase 3: Test Coverage (P1) - 6 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | Server integration tests | - | 35 | 5 hours |
| TEST-002 | Repository tests | - | 20 | 3 hours |
| TEST-003 | Controller validation tests | - | 15 | 2 hours |
| TEST-004 | Authorization boundary tests | - | 10 | 2 hours |
| TEST-005 | Client hook tests | - | 25 | 4 hours |
| TEST-006 | Component tests | - | 74 | 10 hours |

**Phase 3 Total Effort:** ~26 hours (179 test cases)

### Phase 4: API Completeness (P2) - 4 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| API-001 | Missing GET /tags/:id/transactions endpoint | `routes.ts` | Client expects it | 1.5 hours |
| API-002 | Missing PUT /tags/transaction/:id (set all) | `routes.ts` | Bulk replace missing | 2 hours |
| FUNC-001 | Tag merge not implemented | - | Feature gap | 4 hours |
| FUNC-002 | Tag archive not implemented | - | Feature gap | 2 hours |

**Phase 4 Total Effort:** ~9.5 hours

### Phase 5: Accessibility (P2) - 6 Issues

| ID | Issue | Location | WCAG | Effort |
|----|-------|----------|------|--------|
| A11Y-001 | Color buttons lack accessible names | `TagColorPicker.tsx` | 4.1.2 | 30 min |
| A11Y-002 | White checkmark on yellow fails contrast | `TagColorPicker.tsx` | 1.4.3 | 30 min |
| A11Y-003 | Remove button missing aria-label | `TagBadge.tsx` | 4.1.2 | 15 min |
| A11Y-004 | No keyboard navigation in color picker | `TagColorPicker.tsx` | 2.1.1 | 1 hour |
| A11Y-005 | TagsMultiSelect lacks descriptive aria-label | `TagsMultiSelect.tsx` | 4.1.2 | 15 min |
| A11Y-006 | Error state missing in TagsMultiSelect | `TagsMultiSelect.tsx` | 3.3.1 | 30 min |

**Phase 5 Total Effort:** ~3 hours

### Phase 6: Code Quality (P3) - 9 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| CODE-001 | Duplicate repository implementation | `TagRepository.ts` vs `StorageTagModule` | Maintenance | 2 hours |
| CODE-002 | userId not used in transaction tag ops for audit | `controller.ts` | Audit gap | 30 min |
| CODE-003 | No default tags seeded for new households | - | User experience | 2 hours |
| CODE-004 | No member-specific tag UI (schema supports) | - | Feature gap | 4 hours |
| CODE-005 | No tag reports/analytics | - | Feature gap | 8 hours |
| CODE-006 | Color hex format not validated in controller | `controller.ts` | Data quality | 20 min |
| CODE-007 | Decorative color preview is focusable | `TagModal.tsx` | Minor a11y | 15 min |
| CODE-008 | Loading spinner lacks sr-only label | `TagsList.tsx` | Minor a11y | 10 min |
| CODE-009 | No ARIA live region for loading/error | `TagsList.tsx` | Minor a11y | 20 min |

**Phase 6 Total Effort:** ~17 hours

---

## Total Issue Count: 38

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Security Critical | 5 | P0 | 6 hours |
| Phase 2: Architecture | 8 | P1 | 6 hours |
| Phase 3: Test Coverage | 6 | P1 | 26 hours |
| Phase 4: API Completeness | 4 | P2 | 9.5 hours |
| Phase 5: Accessibility | 6 | P2 | 3 hours |
| Phase 6: Code Quality | 9 | P3 | 17 hours |
| **TOTAL** | **38** | | **67.5 hours** |

---

## Implementation Details

### Phase 1: Security Critical (MUST COMPLETE FIRST)

#### SEC-001, SEC-002, SEC-003: Fix Authorization Bypass

**File:** `server/modules/tags/tags.controller.ts`

This is the most critical fix. ALL transaction-tag operations must verify:
1. Transaction belongs to the user's household
2. Transaction is visible to the user (not someone else's private transaction)
3. Tags belong to the same household as the transaction

```typescript
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ForbiddenError } from "../../core/errors";

// ADD this helper function at the top
async function verifyTransactionAccess(
  transactionId: string,
  householdId: string,
  userId: string
): Promise<void> {
  const transaction = await transactionRepository.findByIdWithVisibility(
    transactionId,
    householdId,
    userId
  );
  if (!transaction) {
    throw new NotFoundError("Transaction not found");
  }
}

// MODIFY getTransactionTags
async function getTransactionTags(req: Request, res: Response, next: NextFunction) {
  try {
    const { transactionId } = req.params;
    const { householdId, userId } = req.householdContext!;

    // âœ… ADD: Verify access before reading tags
    await verifyTransactionAccess(transactionId, householdId, userId);

    const tags = await tagRepository.getTransactionTags(transactionId);
    success(res, tags);
  } catch (error) {
    next(error);
  }
}

// MODIFY addTransactionTags
async function addTransactionTags(req: Request, res: Response, next: NextFunction) {
  try {
    const { transactionId } = req.params;
    const { householdId, userId } = req.householdContext!;
    const { tagIds } = req.body;

    // âœ… ADD: Verify transaction access
    await verifyTransactionAccess(transactionId, householdId, userId);

    // âœ… ADD: Verify all tags belong to the same household
    const tags = await tagRepository.findByIds(tagIds, householdId);
    if (tags.length !== tagIds.length) {
      throw new NotFoundError("One or more tags not found");
    }

    const result = await tagRepository.addTagsToTransaction(tagIds, transactionId, userId);
    success(res, result);
  } catch (error) {
    next(error);
  }
}

// MODIFY removeTransactionTag
async function removeTransactionTag(req: Request, res: Response, next: NextFunction) {
  try {
    const { transactionId, tagId } = req.params;
    const { householdId, userId } = req.householdContext!;

    // âœ… ADD: Verify access
    await verifyTransactionAccess(transactionId, householdId, userId);

    await tagRepository.removeTagFromTransaction(tagId, transactionId);
    success(res, { removed: true });
  } catch (error) {
    next(error);
  }
}
```

**Also add to TagRepository:**

```typescript
// TagRepository.ts - ADD method to find multiple tags
async findByIds(ids: string[], householdId: string): Promise<Tag[]> {
  if (ids.length === 0) return [];

  return db
    .select()
    .from(tags)
    .where(
      and(
        inArray(tags.id, ids),
        eq(tags.householdId, householdId)
      )
    );
}
```

#### RATE-001: Add Rate Limiting

**File:** `server/modules/tags/tags.routes.ts`

```typescript
// BEFORE
import { Router } from "express";
import { requireAuth, householdGuard } from "../../middleware";
import * as controller from "./tags.controller";

const router = Router();
router.use(requireAuth);
router.use(householdGuard);

// AFTER
import { Router } from "express";
import { requireAuth, householdGuard } from "../../middleware";
import { generalLimiter } from "../../middleware/rateLimit";
import * as controller from "./tags.controller";

const router = Router();
router.use(requireAuth);
router.use(householdGuard);
router.use(generalLimiter);  // âœ… ADD THIS LINE
```

#### AUDIT-001: Add Audit Logging

**File:** `server/modules/tags/tags.controller.ts`

```typescript
import { businessAuditService } from "../../core/audit";

// In createTag (after successful creation):
await businessAuditService.logCreate({
  householdId,
  userId,
  entityType: "tag",
  entityId: tag.id,
  details: { name: tag.name, color: tag.color },
  ipAddress: businessAuditService.getIpAddress(req),
});

// In updateTag (after successful update):
await businessAuditService.logUpdate({
  householdId,
  userId,
  entityType: "tag",
  entityId: tag.id,
  details: { name: tag.name, color: tag.color },
  ipAddress: businessAuditService.getIpAddress(req),
});

// In deleteTag (after successful deletion):
await businessAuditService.logDelete({
  householdId,
  userId,
  entityType: "tag",
  entityId: id,
  details: {},
  ipAddress: businessAuditService.getIpAddress(req),
});

// In addTransactionTags (after successful linking):
await businessAuditService.log({
  householdId,
  userId,
  action: "CREATE",
  entityType: "transaction_tag",
  entityId: transactionId,
  details: { tagIds, action: "add_tags" },
  ipAddress: businessAuditService.getIpAddress(req),
});

// In removeTransactionTag (after successful removal):
await businessAuditService.log({
  householdId,
  userId,
  action: "DELETE",
  entityType: "transaction_tag",
  entityId: transactionId,
  details: { tagId, action: "remove_tag" },
  ipAddress: businessAuditService.getIpAddress(req),
});
```

**Note:** You may need to add `"tag"` and `"transaction_tag"` to the `AuditEntityType` union in `server/core/audit/types.ts`.

### Phase 2: Architecture & Error Handling

#### ARCH-001: Create Service Layer

**Create:** `server/services/tags/TagService.ts`

```typescript
import { TagRepository } from "../../repositories/TagRepository";
import { TransactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ConflictError } from "../../core/errors";
import { businessAuditService } from "../../core/audit";
import { withTransaction } from "../../utils/withTransaction";

export class TagService {
  constructor(
    private tagRepo = new TagRepository(),
    private transactionRepo = new TransactionRepository()
  ) {}

  async createTag(
    householdId: string,
    userId: string,
    data: { name: string; color: string },
    ipAddress: string
  ) {
    // Check for duplicate name
    const existing = await this.tagRepo.findByName(data.name, householdId);
    if (existing) {
      throw new ConflictError(`Tag "${data.name}" already exists`);
    }

    const tag = await this.tagRepo.create({
      ...data,
      householdId,
      createdBy: userId,
    });

    await businessAuditService.logCreate({
      householdId,
      userId,
      entityType: "tag",
      entityId: tag.id,
      details: { name: tag.name, color: tag.color },
      ipAddress,
    });

    return tag;
  }

  async getTransactionTags(
    transactionId: string,
    householdId: string,
    userId: string
  ) {
    // Verify access
    const transaction = await this.transactionRepo.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    return this.tagRepo.getTransactionTags(transactionId);
  }

  async addTagsToTransaction(
    transactionId: string,
    tagIds: string[],
    householdId: string,
    userId: string,
    ipAddress: string
  ) {
    // Verify transaction access
    const transaction = await this.transactionRepo.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    // Verify all tags exist in household
    const tags = await this.tagRepo.findByIds(tagIds, householdId);
    if (tags.length !== tagIds.length) {
      throw new NotFoundError("One or more tags not found");
    }

    const result = await this.tagRepo.addTagsToTransaction(tagIds, transactionId, userId);

    await businessAuditService.log({
      householdId,
      userId,
      action: "CREATE",
      entityType: "transaction_tag",
      entityId: transactionId,
      details: { tagIds, action: "add_tags" },
      ipAddress,
    });

    return result;
  }

  // ... more methods
}

export const tagService = new TagService();
```

#### ERR-001, ERR-002, ERR-003: Fix Error Handling

```typescript
// BEFORE (controller.ts:8-10)
const success = (res: Response, data: any) => {
  res.json({ success: true, data });
};

// AFTER - DELETE the local function and import from core
import { success, created, noContent } from "../../core/http";

// BEFORE (controller.ts:113)
if (!tag) {
  res.status(404).json({ success: false, error: { message: "Tag not found" } });
  return;
}

// AFTER
if (!tag) {
  throw new NotFoundError("Tag not found");
}
```

#### VAL-002: Add Unique Name Validation

```typescript
// In TagService.createTag or controller
const existing = await tagRepository.findByName(data.name, householdId);
if (existing) {
  throw new ConflictError(`Tag with name "${data.name}" already exists`);
}
```

**Add to TagRepository:**

```typescript
async findByName(name: string, householdId: string): Promise<Tag | undefined> {
  const [result] = await db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.householdId, householdId),
        eq(tags.name, name)
      )
    )
    .limit(1);
  return result;
}
```

### Phase 3: Test Coverage

#### TEST-001: Server Integration Tests

**Create:** `server/modules/tags/__tests__/tags.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestUser, createTestHousehold, createTestTag } from "../../../test/factories";

describe("Tags API", () => {
  describe("POST /api/tags", () => {
    it("should create a tag with valid data", async () => { });
    it("should reject duplicate names in same household", async () => { });
    it("should allow same name in different households", async () => { });
    it("should validate color format", async () => { });
    it("should require authentication", async () => { });
    it("should require household membership", async () => { });
  });

  describe("GET /api/tags", () => {
    it("should return only household tags", async () => { });
    it("should not return other household tags", async () => { });
  });

  describe("PUT /api/tags/:id", () => {
    it("should update tag name", async () => { });
    it("should update tag color", async () => { });
    it("should reject update to duplicate name", async () => { });
    it("should reject update of other household tag", async () => { });
  });

  describe("DELETE /api/tags/:id", () => {
    it("should delete tag", async () => { });
    it("should reject deletion of other household tag", async () => { });
  });

  // CRITICAL: Authorization boundary tests
  describe("GET /api/tags/transaction/:id (Authorization)", () => {
    it("should return tags for own household transaction", async () => { });
    it("should reject reading tags from other household transaction", async () => { });
    it("should reject reading tags from other user private transaction", async () => { });
  });

  describe("POST /api/tags/transaction/:id (Authorization)", () => {
    it("should add tags to own transaction", async () => { });
    it("should reject adding tags to other household transaction", async () => { });
    it("should reject adding other household tags", async () => { });
    it("should reject adding tags to other user private transaction", async () => { });
  });

  describe("DELETE /api/tags/transaction/:transactionId/:tagId (Authorization)", () => {
    it("should remove tag from own transaction", async () => { });
    it("should reject removing from other household transaction", async () => { });
  });

  // ... 35 total test cases
});
```

### Phase 5: Accessibility

#### A11Y-001: Add Accessible Names to Color Buttons

**File:** `client/src/components/tags/TagColorPicker.tsx`

```tsx
// BEFORE
<button
  onClick={() => onChange(color)}
  className={cn("w-8 h-8 rounded-full", ...)}
  style={{ backgroundColor: color }}
>
  {selected && <Check className="h-4 w-4 text-white" />}
</button>

// AFTER
const colorNames: Record<string, string> = {
  "#EF4444": "Red",
  "#F97316": "Orange",
  "#EAB308": "Yellow",
  "#22C55E": "Green",
  "#14B8A6": "Teal",
  "#3B82F6": "Blue",
  "#8B5CF6": "Purple",
  "#EC4899": "Pink",
  "#6B7280": "Gray",
  "#1F2937": "Dark gray",
  "#FFFFFF": "White",
  "#000000": "Black",
};

<button
  onClick={() => onChange(color)}
  aria-label={`${colorNames[color] || color}${selected ? " (selected)" : ""}`}
  aria-pressed={selected}
  className={cn("w-8 h-8 rounded-full", ...)}
  style={{ backgroundColor: color }}
>
  {selected && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
</button>
```

#### A11Y-002: Fix Contrast on Yellow

```tsx
// For yellow (#EAB308), use a dark check icon instead of white
{selected && (
  <Check
    className={cn(
      "h-4 w-4",
      color === "#EAB308" || color === "#FFFFFF" ? "text-gray-900" : "text-white"
    )}
    aria-hidden="true"
  />
)}
```

#### A11Y-004: Add Keyboard Navigation

```tsx
// Wrap colors in a roving tabindex group
const [focusIndex, setFocusIndex] = useState(0);

const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
  const cols = 6; // Number of colors per row
  let newIndex = index;

  switch (e.key) {
    case "ArrowRight":
      newIndex = (index + 1) % colors.length;
      break;
    case "ArrowLeft":
      newIndex = (index - 1 + colors.length) % colors.length;
      break;
    case "ArrowDown":
      newIndex = Math.min(index + cols, colors.length - 1);
      break;
    case "ArrowUp":
      newIndex = Math.max(index - cols, 0);
      break;
    case "Home":
      newIndex = 0;
      break;
    case "End":
      newIndex = colors.length - 1;
      break;
  }

  if (newIndex !== index) {
    e.preventDefault();
    setFocusIndex(newIndex);
    // Focus the new button
    const buttons = e.currentTarget.parentElement?.querySelectorAll("button");
    buttons?.[newIndex]?.focus();
  }
};

// On each button:
tabIndex={index === focusIndex ? 0 : -1}
onKeyDown={(e) => handleKeyDown(e, index)}
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify rate limiter
grep -n "generalLimiter" server/modules/tags/tags.routes.ts
# Should return 1 match

# Verify audit logging
grep -n "businessAuditService" server/modules/tags/tags.controller.ts
# Should return 5+ matches (one per mutation)

# Verify authorization checks
grep -n "findByIdWithVisibility\|verifyTransactionAccess" server/modules/tags/tags.controller.ts
# Should return 3+ matches (one per transaction-tag operation)
```

### Security Test (Manual)
```bash
# 1. Create two test users in different households
# 2. User A creates a transaction
# 3. User B tries to read User A's transaction tags
# Expected: 404 Not Found (not 200 with empty array)
```

### After Phase 3
```bash
# Run security tests
npm run test:server:run -- --grep "Authorization"
# All authorization boundary tests should pass
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
- [ ] Transaction tag operations verify household ownership
- [ ] Transaction tag operations verify visibility (private transactions)
- [ ] Tag-transaction linking verifies both entities in same household
- [ ] Rate limiter applied to all routes
- [ ] Audit logging on all 5 mutations
- [ ] Security tests pass (cross-household access blocked)

### Phase 2 Complete When:
- [ ] Service layer created and used by controller
- [ ] Zero manual `res.status()` calls in controller
- [ ] `success()` imported from `core/http`
- [ ] Unique name validation with ConflictError
- [ ] FOR UPDATE lock prevents race conditions

### Phase 3 Complete When:
- [ ] 35+ integration tests created
- [ ] 20+ repository tests created
- [ ] 10+ authorization boundary tests created
- [ ] All tests pass
- [ ] Coverage reaches 80%

### Phase 4 Complete When:
- [ ] GET /tags/:id/transactions endpoint implemented
- [ ] PUT /tags/transaction/:id endpoint implemented

### Phase 5 Complete When:
- [ ] All color buttons have accessible names
- [ ] Contrast ratio >= 4.5:1 on all colors
- [ ] Keyboard navigation works with arrow keys

---

## Dependencies

| Phase | Depends On |
|-------|------------|
| Phase 1 | None (START IMMEDIATELY - SECURITY) |
| Phase 2 | Phase 1 (security must be fixed first) |
| Phase 3 | Phase 2 (architecture should be clean before testing) |
| Phase 4 | Phase 2 |
| Phase 5 | None (can be done in parallel) |
| Phase 6 | Phase 1-3 |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Security fix introduces regression | Medium | Critical | Add comprehensive authorization tests FIRST |
| Service layer changes break API | Low | Medium | Maintain same request/response contracts |
| Rate limiting blocks legitimate use | Low | Low | Use reasonable limits (100 req/min) |

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 6 hours | Day 1 (PRIORITY) |
| Phase 2 | 6 hours | Day 2 |
| Phase 3 | 26 hours | Days 3-6 |
| Phase 4 | 9.5 hours | Day 7 |
| Phase 5 | 3 hours | Day 7 |
| Phase 6 | 17 hours | Days 8-9 |
| **Total** | **67.5 hours** | **~9 days** |

---

## References

- [Tags Module Assessment](../../../reviews/tags/tags-module-assessment.md)
- [Senior Developer Review](../../../reviews/tags/tags-senior-dev-review.md)
- [QA Engineer Review](../../../reviews/tags/tags-qa-review.md)
- [Fintech Compliance Review](../../../reviews/tags/tags-fintech-review.md)
- [Functionality Review](../../../reviews/tags/tags-functionality-review.md)
- [UI/UX Review](../../../reviews/tags/tags-ux-review.md)

