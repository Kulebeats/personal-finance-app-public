---
name: review-qa
description: QA Engineer review for test coverage, edge cases, and potential bugs. Use when auditing test files, identifying untested paths, checking authorization boundaries, and verifying CLAUDE.md Rule 17 compliance (80% financial, 60% reports, 50% UI).
---

# QA Engineer Review

Review test coverage, edge cases, and potential bugs per CLAUDE.md Rule 17.

## Context

$ARGUMENTS

## Process

1. Locate test files for module
2. Calculate coverage and identify gaps
3. Check edge cases and authorization tests
4. Score and report

## Test Coverage Requirements (CLAUDE.md Rule 17)

| Module Type | Minimum | Check Files |
|-------------|---------|-------------|
| Financial operations | 80% | Goals, Budgets, Transactions |
| Reports/Analytics | 60% | Reports, CashFlow |
| UI Components | 50% | Client components |

## Test File Locations

| Module | Server Tests | Client Tests |
|--------|-------------|--------------|
| Accounts | `server/modules/accounts/__tests__/` | `client/src/features/accounts/__tests__/` |
| Transactions | `server/modules/transactions/__tests__/` | `client/src/features/transactions/__tests__/` |
| Goals | `server/routes/__tests__/goals.integration.test.ts` | `client/src/features/goals/__tests__/` |
| Recurring | `server/modules/recurring/__tests__/` | `client/src/features/recurring/__tests__/` |
| Investments | `server/routes/__tests__/investments.test.ts` | `client/src/features/investments/__tests__/` |
| Reports | `server/repositories/reports/__tests__/` | `client/src/features/reports/__tests__/` |

## Scoring Rubric (100 Points)

| Category | Points | Criteria |
|----------|--------|----------|
| Test Coverage | 25 | Endpoints tested, coverage % |
| Edge Cases | 20 | Boundaries, nulls, empty states |
| Financial Safety | 20 | Money class, currency, precision |
| Authorization | 15 | Household isolation, visibility |
| Data Integrity | 10 | Transactions, constraints |
| Error Handling | 10 | Error paths tested |

## QA Review Checklist

### 1. Test Coverage

- [ ] Unit tests exist for new/modified functions
- [ ] Integration tests for API endpoints (per CLAUDE.md: 5 tests per endpoint)
- [ ] Edge cases covered (empty arrays, nulls, boundaries)
- [ ] Error paths tested (400, 404, 403 responses)
- [ ] Happy path tested

**Required tests per endpoint:**
1. Happy path - valid input returns expected output
2. Validation failure - invalid input returns 400
3. Not found - missing resource returns 404
4. Authorization - wrong household returns 403/404
5. Privacy - private items not visible to other users

### 2. Input Validation

- [ ] All user inputs validated with Zod
- [ ] Boundary values handled (min/max amounts)
- [ ] Invalid data rejected with clear errors
- [ ] Date validation checks actual date existence (not just regex)
- [ ] Amount max bounds enforced (MAX_MONEY_AMOUNT)

### 3. Edge Cases to Verify

- [ ] Empty collections (no transactions, no budgets)
- [ ] Single item collections
- [ ] Maximum allowed values (9,999,999,999,999.99)
- [ ] Zero values where applicable
- [ ] Null/undefined optional fields
- [ ] Unicode characters in text fields
- [ ] Very long strings (255 char limit)
- [ ] Concurrent operations (race conditions)
- [ ] Invalid dates ("2025-02-30", "2025-13-45")

### 4. Financial Calculations

- [ ] Money class used (no parseFloat/Math.round)
- [ ] Currency consistently applied from goal/account/household
- [ ] Rounding handled correctly (display only)
- [ ] Negative amounts where appropriate
- [ ] Zero division prevented
- [ ] Overflow prevented

### 5. Data Integrity

- [ ] `withTransaction()` for multi-step operations
- [ ] `FOR UPDATE` locks for race-prone operations
- [ ] Foreign key constraints respected
- [ ] Cascading deletes handled
- [ ] Unique constraints validated

### 6. Authorization

- [ ] Household isolation (users can't access other households)
- [ ] Private items only visible to owner (`findByIdWithVisibility`)
- [ ] Cross-entity linking checks visibility
- [ ] Deleted/archived items handled

### 7. API Behavior

- [ ] Pagination returns correct total count
- [ ] Sorting works on all sortable columns
- [ ] Filtering returns correct results
- [ ] Search finds expected matches

## Module-Specific Test Requirements

### Investments

- [ ] BUY transaction increases holding quantity
- [ ] SELL transaction decreases holding quantity
- [ ] SELL blocked if quantity > owned (overdraft)
- [ ] Holdings scoped by householdId

### Goals

- [ ] Assignment constraints (one full_balance per account)
- [ ] Contribution updates currentAmount
- [ ] Progress calculation accurate
- [ ] Private goals not visible to others

### Recurring

- [ ] Pattern detection finds actual patterns
- [ ] Linking respects transaction visibility
- [ ] Calendar dates calculated correctly

### Reports

- [ ] Date ranges filter correctly
- [ ] Currency conversions accurate
- [ ] Sankey data sums correctly

## Output Format

```markdown
## Module: [Name] QA Review
Score: XX/100 | Status: Well Tested / Gaps Exist / Critical Gaps

## Test Coverage Assessment

| Test Type | Files | Tests | Passing | Coverage |
|-----------|-------|-------|---------|----------|
| Unit | X | X | X | X% |
| Integration | X | X | X | X% |

## Missing Test Cases

### TEST-001: [Scenario]

- **Endpoint/Function:** [What to test]
- **Input:** [Specific input]
- **Expected:** [Expected result]
- **Priority:** P0/P1/P2

## Potential Bugs

### BUG-001: [Description]

- **Location:** [file:line]
- **Scenario:** [How to trigger]
- **Impact:** [What could go wrong]
- **Evidence:** [Code snippet]

## Edge Cases Not Handled

| Scenario | Location | Risk |
|----------|----------|------|
| [Case] | [file:line] | High/Medium/Low |

## Authorization Gaps

| Endpoint | Household Check | Visibility Check | Status |
|----------|-----------------|------------------|--------|
| GET /x/:id | OK/MISSING | OK/MISSING/N/A | OK/FAIL |

## Recommendations

P0 (Must Add):
1. [Test case]: [Brief description]

P1 (Should Add):
1. [Test case]: [Brief description]
```

## Instructions

1. Locate test files for module
2. Count existing tests and coverage
3. Review code for untested paths
4. Check edge case handling
5. Verify authorization tests exist
6. Score and report

## Quick Reference: Existing Test Gaps (from KNOWN_ISSUES.md)

| Module | Coverage | Gap |
|--------|----------|-----|
| Goals | Partial | 16/28 tests failing (schema drift) |
| Receipts | 14% | 0/7 endpoints tested |
| Investments | 0% | All tests skipped |
| Reports | Repository only | No controller tests |

Cross-reference: `docs/issues/KNOWN_ISSUES.md`
