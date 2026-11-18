# Remaining Audit Fixes - Status Update

## Just Fixed (2026-01-30)

### ✅ AUTH-GOAL-ASSIGN-001 - COMPLETE
**Issue**: List endpoints leaked private account names/balances
**Fix Applied**:
- Updated `getAssignments()` to filter by `userId` ([assignment.queries.ts:72-88](../../server/services/goal/assignment.queries.ts#L72-L88))
- Updated `getAssignmentsForHousehold()` to filter by `userId` ([assignment.queries.ts:93-115](../../server/services/goal/assignment.queries.ts#L93-L115))
- Updated controller calls to pass `userId` ([goals.assignments.controller.ts](../../server/modules/goals/goals.assignments.controller.ts))

**Verification**: Private accounts not owned by requesting user are now filtered from assignment lists.

---

## Remaining Open Issues (6/7)

### 1. AUTH-GRZ-ACC-001 (P1) - NEEDS VERIFICATION
**Claim**: Fixed in grz-securities.ts lines 84-93, 205-212, 284-293
**User says**: Still open
**Action**: Verify fix completeness

### 2. AUTH-SESSION-001 (P2) - NEEDS VERIFICATION
**Claim**: `requireAuthWithUser` middleware exists (auth.ts:33-88)
**User says**: Still open
**Possible issue**: Middleware exists but not used everywhere that accesses `req.user!`
**Action**: Audit all `req.user!` usage and migrate to `requireAuthWithUser`

### 3. DATA-GOAL-004 (P2) - NEEDS VERIFICATION
**Claim**: Unique constraint added to schema (schema.ts:1407-1411)
**User says**: Still open
**Possible issue**: Schema change made but migration not run, or application-level check still needed
**Action**: Verify constraint exists in database

### 4. AUTH-LEGACY-001 (P2) - PARTIAL
**Status**: Deprecation warnings in place (security.mfa.login.ts:193-199)
**Remaining**: Full removal of legacy endpoints or complete refactor
**Action**: Either delete legacy endpoints or complete refactor to use authSessionService

### 5. INT-RULES-001 (P2) - COMPLEX
**Issue**: Rule splits not persisted to transaction_splits table (actions.ts:138-214)
**Impact**: UI/reporting inconsistency
**Status**: Requires significant refactoring
**Action**: Schedule for future sprint

### 6. DATA-ACCOUNT-001 (P2) - NEEDS VERIFICATION
**Claim**: All three locations use Money strings (accounts.controller.ts:297-306, AccountCoreService.ts:335-343, AccountImportService.ts:190-196)
**User says**: Still open
**Action**: Verify no `toNumber()` calls in balance update paths

---

## Next Steps

1. Re-verify claimed fixes with actual code inspection
2. Run database migrations if schema changes weren't applied
3. Audit `req.user!` usage for AUTH-SESSION-001
4. Consider INT-RULES-001 complexity vs priority trade-off

**Current Status**: 1/7 confirmed fixed, 6 require verification or additional work
