# Investments Module - QA Engineer Review

**Reviewer:** QA Engineer (Test Coverage, Edge Cases, Potential Bugs)
**Date:** 2026-01-27
**Score:** 55/100 | **Status:** CRITICAL GAPS (Skipped Tests, Missing Authorization Tests)

---

## Executive Summary

The Investments module has a **critical test coverage gap**: the skipped tests in `server/routes/__tests__/investments.test.ts` (4 tests for tax lot functionality) and the fact that the main integration test file focuses heavily on validation schemas with limited actual API integration testing. While 32 validation schema tests pass and provide good input validation coverage, there are **no tests verifying the core business logic requirements** specified in CLAUDE.md Rule 17:

1. **BUY transaction increases holding quantity** - NOT TESTED
2. **SELL transaction decreases holding quantity** - NOT TESTED
3. **SELL blocked if quantity > owned (overdraft)** - NOT TESTED
4. **Holdings scoped by householdId** - PARTIALLY TESTED (mocked)

The service layer code (`investments.service.ts:370-458`) implements these features correctly, but there is **zero test coverage** verifying this behavior.

---

## Test Coverage Assessment

### Server Tests

| Test File | Test Cases | Status | Coverage |
|-----------|------------|--------|----------|
| investments.integration.test.ts | 32 | 32/32 PASS | Validation schemas only |
| investments.test.ts | 4 | 0/4 (ALL SKIPPED) | Tax lot features |
| **Total** | **36** | **32/36 ACTIVE** | |

### Client Tests

| Test File | Test Cases | Status | Coverage |
|-----------|------------|--------|----------|
| HoldingsList.test.tsx | 3 | 3/3 PASS | Sort, render |
| InvestmentAllocation.test.tsx | 2 | 2/2 PASS | Chart render, empty |
| Investments.integration.test.tsx | 4 (1 skipped) | 3/4 PASS | Page integration |
| useInvestmentsData.test.tsx | 2 | 2/2 PASS | Hook state |
| **Total** | **11** | **10/11 ACTIVE** | |

### Endpoint Coverage

| Endpoint | Happy Path | 400 Error | 404 Error | Auth Test | Overdraft |
|----------|------------|-----------|-----------|-----------|-----------|
| GET /securities | Yes | No | N/A | No | N/A |
| GET /securities/:id | Yes | No | Yes | No | N/A |
| POST /securities | Yes | Yes | N/A | No | N/A |
| PUT /securities/:id/price | Yes | No | Yes | No | N/A |
| GET /holdings | Yes | No | N/A | No | N/A |
| GET /holdings/:id | Yes | No | Yes | No | N/A |
| POST /holdings | Yes | Yes | N/A | No | N/A |
| PUT /holdings/:id | Yes | No | Yes | No | N/A |
| DELETE /holdings/:id | Yes | No | Yes | No | N/A |
| GET /portfolio | Yes | No | N/A | No | N/A |
| GET /portfolio/allocation | Yes | No | N/A | No | N/A |
| GET /performance | Yes | No | N/A | No | N/A |
| GET /transactions | Yes | No | N/A | No | N/A |
| **POST /transactions (BUY)** | Yes | Yes | N/A | No | **NO** |
| **POST /transactions (SELL)** | Yes | Yes | N/A | No | **NO** |
| GET /fx-rates | Yes | No | N/A | No | N/A |
| POST /fx-rates | Yes | Yes | N/A | No | N/A |

**Coverage Summary:**
- Happy Paths: 19/19 (100%)
- Validation (400): 6/19 (32%)
- Not Found (404): 5/11 applicable (45%)
- Authorization: 0/19 (0%) - CRITICAL GAP
- Overdraft Prevention: 0/1 (0%) - CRITICAL GAP

---

## Missing Test Cases (CRITICAL)

### TEST-001: BUY Transaction Increases Holding Quantity
- **Priority:** P0 - Business Critical
- **Endpoint:** POST /investments/transactions
- **Input:** `{ type: "BUY", holdingId, quantity: 10, price: "100.00" }`
- **Expected:** Holding quantity increases by 10
- **Code Location:** `investments.service.ts:426-439`

### TEST-002: SELL Transaction Decreases Holding Quantity
- **Priority:** P0 - Business Critical
- **Endpoint:** POST /investments/transactions
- **Input:** `{ type: "SELL", holdingId, quantity: 5, price: "100.00" }`
- **Expected:** Holding quantity decreases by 5
- **Code Location:** `investments.service.ts:440-453`

### TEST-003: SELL Blocked When Quantity > Owned (Overdraft)
- **Priority:** P0 - Financial Safety Critical
- **Endpoint:** POST /investments/transactions
- **Input:** `{ type: "SELL", holdingId, quantity: 1000, price: "100.00" }` (when only 10 owned)
- **Expected:** 409 Conflict "Insufficient shares"
- **Code Location:** `investments.service.ts:394-401`

### TEST-004: Cross-Household Isolation for Holdings
- **Priority:** P0 - Security Critical
- **Endpoint:** GET /investments/holdings/:id
- **Input:** Holding ID from different household
- **Expected:** 404 Not Found
- **Code Location:** `investments.service.ts:314-345`

---

## Potential Bugs

### BUG-001: Account Ownership Not Validated on Transaction Create
- **Location:** `investments.service.ts:370-375`
- **Scenario:** User creates transaction with accountId from different household
- **Impact:** Cross-household data access
- **Severity:** P0 - Security

### BUG-002: Race Condition in BUY Quantity Update
- **Location:** `investments.service.ts:426-439`
- **Scenario:** Two concurrent BUY transactions for same holding
- **Impact:** Lost update (final quantity incorrect)
- **Severity:** P1 - Data Integrity
- **Note:** BUY path does NOT use `for("update")` lock (only SELL does)

---

## Financial Safety Assessment

| Check | Status | Evidence |
|-------|--------|----------|
| Money class for overdraft | PASS | `investments.service.ts:394-396` uses Money class |
| Overdraft validation code | PASS | `ConflictError` thrown for insufficient shares |
| Overdraft test | **FAIL** | No test verifies overdraft rejection |
| FOR UPDATE lock on SELL | PASS | `investments.service.ts:388` uses `.for("update")` |
| FOR UPDATE lock on BUY | **FAIL** | BUY path has no lock |
| Transaction atomicity | PASS | Uses `withTransaction()` wrapper |
| Audit logging | PASS | All 7 mutations logged |

---

## Scoring Breakdown

| Category | Points | Max | Notes |
|----------|--------|-----|-------|
| Test Coverage | 10 | 25 | 32 validation + 10 client tests, but ZERO business logic tests |
| Edge Cases | 10 | 20 | Date validation good, overdraft untested |
| Financial Safety | 12 | 20 | Code implements overdraft, but no test coverage |
| Authorization | 5 | 15 | No cross-household tests exist |
| Data Integrity | 8 | 10 | Transaction atomicity good, race condition on BUY |
| Error Handling | 10 | 10 | 400/404 paths well tested |
| **TOTAL** | **55** | **100** | |

---

## Recommendations

### P0 (Must Add - Critical for Production)
1. **TEST: BUY increases holding quantity** - Core business logic
2. **TEST: SELL decreases holding quantity** - Core business logic
3. **TEST: SELL blocked when quantity > owned** - Financial safety
4. **TEST: Cross-household isolation** - Security critical
5. **FIX: Account ownership validation** - Verify accountId belongs to householdId

### P1 (Should Add)
6. **TEST: Concurrent BUY transaction handling** - Data integrity
7. **FIX: Add FOR UPDATE lock to BUY path** - Race condition prevention
8. **UNSKIP: Tax lot tests** - Complete test coverage

### P2 (Nice to Have)
9. **TEST: Price update audit logging** - Compliance
10. **TEST: FX rate calculation accuracy** - Financial precision

---

## Verdict

**CRITICAL GAPS** - The Investments module has passing tests (32 server + 10 client), but they test the wrong things. The validation schemas are thoroughly tested, but the **core financial business logic is not tested at all**.

| Requirement | Code Exists | Test Exists |
|-------------|-------------|-------------|
| BUY increases quantity | YES | **NO** |
| SELL decreases quantity | YES | **NO** |
| SELL overdraft blocked | YES | **NO** |
| HouseholdId scoping | YES | **NO** |

**Recommendation:** Do not deploy to production without adding the P0 tests for BUY/SELL quantity changes and overdraft protection.

---

## Update (2026-01-28)

**Review Status:** All critical test gaps remain OPEN. No new tests have been added for:
- BUY/SELL transaction quantity changes
- Overdraft protection
- Cross-household isolation
- Account ownership validation

**Skipped Tests:** No skipped tests found in current test suite (previously reported 4 skipped tests appear to have been removed).
