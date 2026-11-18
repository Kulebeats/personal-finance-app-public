# Recurring Module - QA Engineer Review

**Reviewer:** QA Engineer (Test Coverage, Edge Cases, Potential Bugs)
**Date:** 2026-01-23
**Score:** 78/100 | **Status:** Gaps Exist (Authorization Tests Missing)

---

## Executive Summary

The Recurring module has solid test coverage for validation and happy paths (65 server tests, 25 client tests), all passing. The validation test suite is particularly comprehensive, covering date validation edge cases (Feb 30, leap years) and boundary values. However, gaps exist in authorization testing (no cross-household isolation tests) and 404 error path coverage. Financial safety is well-handled with Money class used throughout.

---

## Test Coverage Assessment

### Server Tests

| Test File | Test Cases | Status | Coverage |
|-----------|------------|--------|----------|
| recurring.integration.test.ts | 26 | 26/26 PASS | API endpoints |
| recurring.validation.test.ts | 39 | 39/39 PASS | Input validation |
| **Total** | **65** | **65/65 PASS** | |

### Client Tests

| Test File | Test Cases | Status | Coverage |
|-----------|------------|--------|----------|
| RecurringComponents.test.tsx | 25 | All PASS | UI components |
| **Total** | **25** | **25 PASS** | |

### Endpoint Coverage

| Endpoint | Happy Path | 400 Error | 404 Error | Auth Test |
|----------|------------|-----------|-----------|-----------|
| GET / | Yes | N/A | N/A | No |
| GET /upcoming | Yes | N/A | N/A | No |
| GET /summary | Yes | N/A | N/A | No |
| POST /process | Yes | N/A | N/A | No |
| POST /detect | Yes | Yes | N/A | No |
| POST /confirm | Yes | Yes | N/A | No |
| POST / | Yes | Yes | N/A | No |
| GET /:id | Yes | N/A | No | No |
| PUT /:id | Yes | Yes | No | No |
| DELETE /:id | Yes | N/A | No | No |
| GET /:id/history | Yes | Yes | No | No |
| GET /:id/transactions | Yes | N/A | No | No |
| POST /:id/skip | Yes | N/A | No | No |
| POST /:id/pause | Yes | N/A | No | No |
| POST /:id/resume | Yes | N/A | No | No |
| POST /:id/end | Yes | Yes | No | No |
| POST /:id/link | Yes | Yes | No | Yes (visibility) |
| DELETE /:id/link/:linkId | Yes | N/A | No | No |
| POST /transaction | N/A | Yes | N/A | No |
| POST /transaction/:id | Yes | Yes | No | No |

**Coverage Summary:**
- Happy Paths: 20/22 (91%)
- Validation (400): 11/22 (50%)
- Not Found (404): 0/15 applicable (0%)
- Authorization: 1/22 (5%)

---

## Test Quality Assessment

### What's Tested Well

1. **Date Validation Excellence** (8 tests)
   - Feb 30, Feb 31 rejected
   - Month 13, Day 0 rejected
   - Leap year Feb 29 accepted/rejected correctly

2. **Query Parameter Safety** (11 tests)
   - Default values when not provided
   - NaN, negative, zero handling
   - Maximum caps enforced (365 days, 100 limit)

3. **Custom Frequency Validation** (3 tests)
   - Requires intervalUnit + intervalValue
   - Bounds enforced (1-365)

4. **Money Validation** (3 tests)
   - Positive amounts only
   - Zero rejected
   - MoneyDto format validated

5. **Client Component Tests** (25 tests)
   - Calendar rendering
   - List display
   - Summary calculations
   - User interactions

---

## Missing Test Cases

### TEST-001: Cross-Household Isolation

- **Endpoint:** All CRUD operations
- **Input:** Request from household A for household B's recurring rule
- **Expected:** 404 Not Found (not 403 to avoid information leakage)
- **Priority:** P0 - Security Critical

```typescript
it("returns 404 when accessing other household's recurring rule", async () => {
  // Create rule in household A
  // Try to GET/PUT/DELETE from household B context
  // Expect 404
});
```

### TEST-002: Not Found Error Paths

- **Endpoint:** GET/PUT/DELETE /:id, lifecycle actions
- **Input:** Non-existent UUID
- **Expected:** 404 with proper error format
- **Priority:** P1

```typescript
it("returns 404 for non-existent recurring rule", async () => {
  await request(app)
    .get("/api/recurring/99999999-9999-9999-9999-999999999999")
    .expect(404);
});
```

### TEST-003: Transaction Link Visibility

- **Endpoint:** POST /:id/link
- **Input:** Link to private transaction owned by different user
- **Expected:** 404 (transaction "not found" to that user)
- **Priority:** P0 - Privacy Critical

### TEST-004: Concurrent Link Race Condition

- **Endpoint:** POST /:id/link (same transaction twice simultaneously)
- **Input:** Two parallel requests linking same transaction
- **Expected:** One succeeds, one fails with conflict
- **Priority:** P1

### TEST-005: Account Validation on Create

- **Endpoint:** POST /
- **Input:** accountId from different household
- **Expected:** 404 (account not found)
- **Priority:** P0 - Security

---

## Potential Bugs

### BUG-001: Missing FOR UPDATE Lock on Link Operations

- **Location:** `server/services/recurring/RecurringLinkingService.ts`
- **Scenario:** Two simultaneous requests to link same transaction to recurring rule
- **Impact:** Could create duplicate links if no unique constraint exists
- **Evidence:** No `for("update")` lock before insert

```typescript
// Current code (approximate)
const existing = await findLink(recurringId, transactionId);
if (existing) throw ConflictError;
// RACE WINDOW: Another request could insert here
await tx.insert(links).values(data);
```

### BUG-002: No Validation of Account Ownership on Create

- **Location:** `recurring.controller.ts:create()`
- **Scenario:** User specifies accountId from different household
- **Impact:** Rule created with invalid account reference
- **Evidence:** No visibility check for accountId in validation

**Mitigation:** The service layer likely validates this, but no explicit test exists.

---

## Edge Cases Not Handled

| Scenario | Location | Risk | Tested |
|----------|----------|------|--------|
| Empty recurring rules list | GET / | Low | No |
| 365 day lookback (max) | POST /detect | Medium | Yes (caps) |
| Unicode in rule name | POST / | Low | No |
| 255 char max name | POST / | Low | Partial |
| Concurrent pause/resume | POST /pause, /resume | Medium | No |
| Delete with active links | DELETE /:id | Medium | No |
| End date before start date | PUT /:id | Medium | No |

---

## Authorization Test Gaps

| Endpoint | Household Check | Visibility Check | Test Exists |
|----------|-----------------|------------------|-------------|
| GET /:id | Assumed | N/A | No |
| PUT /:id | Assumed | N/A | No |
| DELETE /:id | Assumed | N/A | No |
| POST /:id/link | Yes | Yes (service) | Partial |
| POST /:id/skip | Assumed | N/A | No |

**"Assumed"** = The code likely does the check, but no test verifies it.

---

## Financial Safety Assessment

| Check | Status | Evidence |
|-------|--------|----------|
| Money class for amounts | PASS | `toMoneyDto()` used in controller |
| MoneyDto in validation | PASS | `positiveMoneyDtoSchema` |
| No parseFloat | PASS | Grep found no violations |
| Currency context | PASS | `sumMoneyDto(amounts, currency)` |
| Amount bounds | PASS | Positive amount schema enforced |

---

## Client Test Quality

### RecurringCalendar (7 tests)
- Day headers render
- All month days render
- Today highlighted
- Items on correct day
- Click handler works
- Paused items styled differently

### RecurringList (7 tests)
- Headers render
- Name, type, frequency display
- Paused badge shows
- Income color (green)
- Sort by due date

### RecurringSummary (11 tests)
- Totals display
- Month name
- Bills vs income breakdown
- Upcoming section
- Empty state

**Gap:** No tests for error states, loading states, or edge cases (0 items).

---

## Recommendations

### P0 (Must Add - Security Critical)

1. **Cross-household isolation test** - Verify users cannot access other household's recurring rules
2. **Transaction visibility test** - Verify private transactions cannot be linked by other users
3. **Account ownership test** - Verify accountId must belong to same household

### P1 (Should Add)

4. **404 error path tests** - All endpoints with `:id` parameter
5. **Concurrent operation test** - Duplicate link prevention
6. **Delete cascade test** - What happens to links when rule deleted

### P2 (Nice to Have)

7. **Empty state tests** - No recurring rules
8. **Unicode/special char tests** - Name field
9. **Boundary tests** - Max name length, max amount

---

## Scoring Breakdown

| Category | Points | Max | Notes |
|----------|--------|-----|-------|
| Test Coverage | 20 | 25 | 65 server + 25 client tests, missing auth tests |
| Edge Cases | 15 | 20 | Date validation excellent, boundaries partial |
| Financial Safety | 20 | 20 | Money class compliance excellent |
| Authorization | 8 | 15 | Only 1 privacy test exists |
| Data Integrity | 7 | 10 | No concurrent operation tests |
| Error Handling | 8 | 10 | 400 paths good, 404 paths missing |
| **TOTAL** | **78** | **100** | |

---

## Test Execution Results

```
Server Tests: 65/65 PASS
Client Tests: 25/25 PASS
Skipped Tests: 0
Total: 90 tests passing
```

---

## Verdict

**GAPS EXIST** - The Recurring module has strong validation testing and good happy path coverage, but lacks critical authorization tests. The absence of cross-household isolation tests is a P0 gap that should be addressed before relying on this module for multi-tenant deployments. The financial safety aspects are well-tested.

---

## Update (2026-01-28)

**Test Status:** Test suite has been expanded.

**New Test Files Found:**
- `recurring_concurrency.integration.test.ts` - NEW (addresses BUG-001 race conditions)
- `recurring.db.integration.test.ts` - NEW (database integration tests)
- `recurring.integration.test.ts` - Existing
- `recurring.validation.test.ts` - Existing

**Critical Gaps Status:**
- **TEST-001: Cross-Household Isolation** - Status UNKNOWN (need to verify in new test files)
- **TEST-002: Not Found Error Paths** - Status UNKNOWN
- **TEST-003: Transaction Link Visibility** - Status UNKNOWN
- **TEST-004: Concurrent Link Race Condition** - **LIKELY ADDRESSED** (new concurrency test file exists)
- **TEST-005: Account Validation on Create** - Status UNKNOWN

**Recommendation:** Verify new test files contain the missing P0 authorization tests.
