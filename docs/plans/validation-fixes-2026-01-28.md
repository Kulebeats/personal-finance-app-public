# Validation Fixes - Task B

**Date:** 2026-01-28
**Status:** ✅ Complete

---

## Summary

Fixed rules and tags validation issues identified in Phase 1-3 implementation review.

**Results:**
- RULES-VAL-001: ✅ Already fixed (verified)
- TAGS-VAL-001: ✅ Fixed (duplicate schemas removed)
- TAGS-VAL-002: ✅ Fixed (unique name validation added)
- BONUS: ✅ Fixed non-existent `description` field in tags validation

---

## Issues Fixed

### 1. RULES-VAL-001: Missing Action Types (Already Fixed)

**Status:** ✅ Verified - No changes needed

**Verification:**
- Checked [rules.validation.ts:57-71](../../server/modules/rules/rules.validation.ts)
- Confirmed action type enum includes:
  - `set_merchant` (line 68)
  - `set_category_from_merchant` (line 69)
  - `set_review_status` (line 70)

**Conclusion:** This issue was already fixed in a previous update.

---

### 2. TAGS-VAL-001: Duplicate Validation Schemas (Fixed)

**Problem:**
- Validation schemas defined in TWO locations:
  - `shared/schema.ts` → `insertTagSchema`, `updateTagSchema`
  - `server/modules/tags/tags.validation.ts` → `createTagSchema`, `updateTagSchema` (DUPLICATE)
- Controllers were using module-level duplicates instead of shared schemas
- Created maintenance burden and potential inconsistencies

**Fix:**
- ✅ Removed duplicate `createTagSchema` and `updateTagSchema` from tags.validation.ts
- ✅ Now re-exports shared schemas from `@shared/schema`:
  ```typescript
  export const createTagSchema = insertTagSchema;
  export const updateTagSchema = sharedUpdateTagSchema;
  ```
- ✅ Controller imports unchanged (still uses `tags.validation.ts` - no breaking changes)
- ✅ Single source of truth for tag validation

**Files Modified:**
- [tags.validation.ts](../../server/modules/tags/tags.validation.ts) - Removed duplicates, added re-exports

---

### 3. TAGS-VAL-002: No Unique Name Validation (Fixed)

**Problem:**
- Tags could be created with duplicate names in same household
- No uniqueness constraint in validation or database
- Could lead to user confusion ("Which 'Food' tag should I use?")

**Fix:**
- ✅ Added uniqueness check in `create` method:
  ```typescript
  const existingTag = await tagRepository.findByName(householdId, parseResult.data.name);
  if (existingTag) {
    throw new ConflictError("A tag with this name already exists in your household");
  }
  ```
- ✅ Added uniqueness check in `update` method (when name changes):
  ```typescript
  if (parseResult.data.name && parseResult.data.name !== existingTag.name) {
    const duplicateTag = await tagRepository.findByName(householdId, parseResult.data.name);
    if (duplicateTag) {
      throw new ConflictError("A tag with this name already exists in your household");
    }
  }
  ```
- ✅ Returns 409 Conflict status code (not 400 Validation)
- ✅ Uses existing `tagRepository.findByName()` method (no new code needed)

**Files Modified:**
- [tags.controller.ts](../../server/modules/tags/tags.controller.ts) - Added uniqueness checks, imported `ConflictError`

---

### 4. BONUS: Non-Existent Description Field (Fixed)

**Problem:**
- `tags.validation.ts` included `description: z.string().max(200).optional()`
- Tags table has NO `description` column in database schema
- Validation accepted data that would be ignored/lost

**Fix:**
- ✅ Removed by using shared `insertTagSchema` (which correctly matches database schema)
- ✅ No `description` field in validation anymore

**Tags Table Actual Schema:**
- id, householdId, name, color, icon, memberSpecific, memberId, usageCount, createdAt, updatedAt
- NO `description` field

---

## Verification

### Type Check

```bash
npm run check
```

**Result:** ✅ PASS (exit code 0)

### Files Modified

| File | Changes | LOC Change |
|------|---------|------------|
| [tags.validation.ts](../../server/modules/tags/tags.validation.ts) | Removed duplicate schemas, added re-exports | -18 lines |
| [tags.controller.ts](../../server/modules/tags/tags.controller.ts) | Added uniqueness validation, imported ConflictError | +18 lines |

**Total:** 2 files modified, net 0 LOC change

---

## Testing Recommendations

### Manual Testing

1. **Test duplicate tag creation:**
   ```bash
   # Create tag
   POST /api/tags
   {"name": "Food", "color": "#ff0000"}
   # Expected: 201 Created

   # Try to create duplicate
   POST /api/tags
   {"name": "Food", "color": "#00ff00"}
   # Expected: 409 Conflict
   ```

2. **Test duplicate tag update:**
   ```bash
   # Create two tags
   POST /api/tags {"name": "Food"}
   POST /api/tags {"name": "Transport"}

   # Try to rename Transport → Food
   PUT /api/tags/{transport-id}
   {"name": "Food"}
   # Expected: 409 Conflict
   ```

### Integration Tests Needed

- [ ] Tags: Create with duplicate name returns 409
- [ ] Tags: Update to duplicate name returns 409
- [ ] Tags: Update to same name succeeds (no duplicate check)
- [ ] Tags: Create/update with description field is ignored (no error)

---

## Impact Assessment

### Breaking Changes

**None** - All changes are internal:
- Controller imports unchanged
- API responses unchanged (except new 409 for duplicates)
- Type exports unchanged

### Behavior Changes

1. **Tags API:**
   - Creating duplicate tag name → Now returns 409 (was 201, silently created duplicate)
   - Renaming to existing tag name → Now returns 409 (was 200, allowed duplicate)

2. **Validation:**
   - `description` field in request body → Now ignored (was accepted but not saved)
   - `color` field → Now validated with regex `#[0-9A-Fa-f]{6}` (was max length only)

### Performance Impact

**Minimal:**
- One additional database query per tag create/update (to check uniqueness)
- Query is indexed (householdId + name) → Fast lookup
- Only runs when name is provided/changed

---

## Compliance

### CLAUDE.md Rules

- ✅ **Rule 8 (Validation):** Used Zod schemas, re-exported from shared schema
- ✅ **Rule 7 (Error Handling):** Used `ConflictError` class for 409 responses
- ✅ **Rule 5 (Controller Pattern):** Validation → Service → Response maintained
- ✅ **Rule 2 (LOC Limits):** All files under 500 LOC

### Code Quality

- ✅ No `as any` types added
- ✅ Proper error classes used
- ✅ Single source of truth (shared schema)
- ✅ Type check passes

---

## Related Documents

- [registry-status-update-2026-01-28.md](./registry-status-update-2026-01-28.md)
- [security-tests-status-2026-01-28.md](./security-tests-status-2026-01-28.md)
- [master-issues-registry.md](./master-issues-registry.md)

---

**Prepared by:** Task B (Rules & Tags Validation Fixes)
**Type Check:** ✅ PASS
**Ready for:** Deployment to development environment
