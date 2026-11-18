# Test Infrastructure Fix - 2026-01-28

**Status:** ✅ TEST DISCOVERY FIXED
**Remaining:** ⚠️ Test implementation issues to resolve

---

## Problem Summary

All server integration tests were failing with "No test suite found in file" error when run via npm scripts, despite test files being syntactically correct.

---

## Root Cause

The npm script `test:server:run` was running vitest from the root directory with `--config server/vitest.config.ts`, which caused vitest to be unable to properly discover test suites in the server subdirectory.

---

## Solution Applied

### 1. Updated npm Scripts ([package.json](../../package.json))

**Before:**
```json
"test:server": "vitest --config server/vitest.config.ts",
"test:server:run": "vitest run --config server/vitest.config.ts",
"test:coverage:server": "vitest run --coverage --config server/vitest.config.ts"
```

**After:**
```json
"test:server": "cd server && vitest",
"test:server:run": "cd server && vitest run",
"test:coverage:server": "cd server && vitest run --coverage"
```

**Rationale:** Running vitest from the server directory allows it to properly discover and execute test suites using the local vitest.config.ts.

### 2. Updated [server/vitest.config.ts](../../server/vitest.config.ts)

**Added dotenv configuration:**
```typescript
import dotenv from "dotenv";

// Load .env from parent directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });
```

**Rationale:** When running from the server directory, environment variables from the root `.env` file (including `DATABASE_URL`) weren't being loaded. This fix ensures tests have access to the database connection.

---

## Verification

### Test Discovery - ✅ WORKING

```bash
$ cd server && npx vitest run
```

**Result:** Tests are discovered and executed successfully. Example output shows goals integration tests running with proper test suite detection.

### Three New Security Tests Created

| Test File | Purpose | Status |
|-----------|---------|--------|
| [categories-security.integration.test.ts](../../server/modules/categories/__tests__/categories-security.integration.test.ts) | SEC-CRITICAL-003: Verify household ownership checks on category mutations | ⚠️ Runs but fails (implementation issues) |
| [tags-security.integration.test.ts](../../server/modules/tags/__tests__/tags-security.integration.test.ts) | TAGS-SEC-003: Verify tag household verification before linking | ⚠️ Runs but fails (implementation issues) |
| [weekly-recap-guard.integration.test.ts](../../server/modules/weekly-recap/__tests__/weekly-recap-guard.integration.test.ts) | WEEKLY-GUARD-001: Verify householdGuard on feedback endpoint | ⚠️ Runs but fails (implementation issues) |

---

## Remaining Test Implementation Issues

The tests are now **discovered and executed**, but they fail due to test code issues:

### Issue 1: Authentication Status Code Mismatch

**Error:**
```
AssertionError: expected 403 to be 401
```

**Location:** [weekly-recap-guard.integration.test.ts:72](../../server/modules/weekly-recap/__tests__/weekly-recap-guard.integration.test.ts#L72)

**Fix needed:** Tests expect `401 Unauthorized` for missing auth, but the application returns `403 Forbidden`. Update test assertions to match actual behavior or fix application to return 401.

### Issue 2: Duplicate Key Violations

**Error:**
```
duplicate key value violates unique constraint "users_username_unique"
```

**Location:** Test setup in all three files

**Fix needed:** Tests use hardcoded usernames/emails that conflict with existing data or previous test runs:
- `usera@test.com`, `userb@test.com`, `testuser@test.com`
- `usera`, `userb`, `testuser`

**Solution:** Use randomized or timestamped test data (see [budgets.integration.test.ts:57-60](../../server/modules/budgets/__tests__/budgets.integration.test.ts#L57-L60) for correct pattern):
```typescript
const timestamp = Date.now();
testUser = createTestUser({
  email: `test-${timestamp}@example.com`,
  username: `test-user-${timestamp}`,
});
```

### Issue 3: Failed Login Returns Undefined Cookie

**Error:**
```
TypeError: Invalid value "undefined" for header "Cookie"
```

**Cause:** Login attempts fail (returning 401), so `cookie` variable remains undefined when tests try to use it.

**Fix needed:**
1. Fix duplicate key issue (Issue #2) so users can be created
2. Use proper password hashing in test setup (see [budgets.integration.test.ts:67-68](../../server/modules/budgets/__tests__/budgets.integration.test.ts#L67-L68)):
```typescript
const passwordHash = await hashPassword("TestPassword123");
testUser.passwordHash = passwordHash;
```
3. Ensure login endpoint receives matching credentials

---

## Commands to Run Tests

### Run all server tests:
```bash
npm run test:server:run
```

### Run specific test:
```bash
cd server && npx vitest run modules/categories/__tests__/categories-security.integration.test.ts
```

### Run with verbose output:
```bash
cd server && npx vitest run --reporter=verbose
```

---

## Files Modified

| File | Change |
|------|--------|
| [package.json](../../package.json) | Updated test:server scripts to run from server directory |
| [server/vitest.config.ts](../../server/vitest.config.ts) | Added dotenv configuration to load parent .env file |

**Files Created:**
- [server/modules/categories/__tests__/categories-security.integration.test.ts](../../server/modules/categories/__tests__/categories-security.integration.test.ts)
- [server/modules/tags/__tests__/tags-security.integration.test.ts](../../server/modules/tags/__tests__/tags-security.integration.test.ts)
- [server/modules/weekly-recap/__tests__/weekly-recap-guard.integration.test.ts](../../server/modules/weekly-recap/__tests__/weekly-recap-guard.integration.test.ts)

---

## Next Steps

1. ✅ **DONE:** Fix test discovery infrastructure (this document)
2. **TODO:** Fix test implementation issues (Issues #1-3 above)
3. **TODO:** Re-run tests to verify security fixes work as expected
4. **TODO:** Update [registry-status-update-2026-01-28.md](./registry-status-update-2026-01-28.md) with test results

---

**Summary:** The core test infrastructure issue (test discovery) is resolved. Tests now run but need implementation fixes for proper test data management and assertion expectations.
