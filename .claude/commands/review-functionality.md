---
name: review-functionality
description: Product Manager Functionality Review for end-to-end feature verification, business logic validation, and cross-module integration. Use when reviewing modules for functional correctness, data integrity, API completeness, and Monarch Money benchmark comparison.
---

# Product Manager Functionality Review

Review functional correctness, business logic, and feature completeness. Benchmark against Monarch Money.

## Context

$ARGUMENTS

## App Constraints

Manual-input finance app (no automatic bank sync). Skip Monarch features for: account sync, institution connections, Zillow integration.

## Process

1. Identify module(s) from Module Reference
2. Run anti-pattern scans
3. Trace Create/Update/Delete/List flows end-to-end
4. Verify cross-module impacts
5. Score and report

## Module Reference

| Module | Server | Client |
|--------|--------|--------|
| Accounts | `server/modules/accounts/` | `client/src/features/accounts/` |
| Transactions | `server/modules/transactions/` | `client/src/features/transactions/` |
| Budgets | `server/services/budget/` | `client/src/features/budgets/` |
| Goals | `server/modules/goals/` | `client/src/features/goals/` |
| Recurring | `server/modules/recurring/` | `client/src/features/recurring/` |
| Investments | `server/modules/investments/` | `client/src/features/investments/` |
| Reports | `server/modules/reports/` | `client/src/features/reports/` |
| Receipts | `server/modules/receipts/` | `client/src/pages/Receipts.tsx` |

**Module-specific checklists:** See [references/functionality-modules.md](references/functionality-modules.md)

## Anti-Pattern Scans

Run these on the module under review:

```bash
# Money handling (Rule 1)
rg -n "parseFloat|Math\.round|\.toNumber\(\)" <path>

# Type safety (Rule 16)
rg -n "as any|: any" <path>

# Audit logging (Rule 9)
rg -n "businessAuditService" <path>

# Rate limiting (Rule 12)
rg -n "Limiter" <path>/*.routes.ts

# Race conditions (Rule 10)
rg -n "withTransaction|for.*update" <path>
```

## Scoring Rubric (100 Points)

| Category | Points | Criteria |
|----------|--------|----------|
| Functional Correctness | 30 | Features work end-to-end, state changes persist |
| Data Integrity | 20 | Money class, no precision loss, atomic ops |
| Security/Isolation | 15 | Household scoping, visibility, rate limiting |
| API Completeness | 15 | Client hooks have working endpoints, types match |
| Error Handling | 10 | Proper error classes, user-friendly messages |
| Test Coverage | 10 | Integration tests, edge cases covered |

**Interpretation:** 90+: Production ready | 80-89: Minor issues | 70-79: Address before release | 60-69: Needs work | <60: Critical issues

## Core Checklist

### Business Logic

- [ ] Mutations update data they claim to
- [ ] Side effects happen (BUY increases quantity)
- [ ] Calculations correct (totals, balances, percentages)
- [ ] Multi-step operations atomic (complete or rollback)
- [ ] Domain rules enforced (cannot sell more than owned)

### API Coverage

- [ ] Endpoints exist for all client hooks
- [ ] Parameters match what client sends
- [ ] Response shapes match client types
- [ ] No UI buttons call missing APIs

### Data Flow

- [ ] Create: persistence verified
- [ ] Read: scoped data returned
- [ ] Update: all fields updated
- [ ] Delete: removed correctly
- [ ] Relationships: related entities updated

### Authorization

- [ ] Household scoping enforced
- [ ] Private items only visible to owner
- [ ] Cross-entity linking checks visibility

## Cross-Module Dependencies

```
Transactions -> Accounts (balance)
            -> Budgets (spent)
            -> Goals (progress)
            -> Recurring (linking)
            -> Reports (aggregations)
```

Verify changes propagate correctly. See [references/functionality-modules.md](references/functionality-modules.md) for E2E scenarios.

## Monarch Benchmark

Reference: https://www.monarch.com/

| Feature | Monarch | Verify Ours |
|---------|---------|-------------|
| Transactions | AI categorization, bulk edit, split | Bulk operations work? |
| Budgets | Flex + category budgeting | Both modes supported? |
| Goals | Visual progress, projections | Progress calculations accurate? |
| Recurring | Calendar + list, reminders | Detection patterns work? |
| Multi-user | "Yours, mine, ours" labels | Owner filtering works? |

## Output Format

```markdown
## Module: [Name]
Score: XX/100 | Status: Production Ready / Needs Work / Critical Issues

## Findings (by Severity)

### CRIT-001: [Description]
- Expected: [What should happen]
- Actual: [What happens]
- Location: [file:line]
- Trace: UI -> Hook -> API -> Controller -> Service -> Repository -> DB

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Functional Correctness | X | 30 | |
| Data Integrity | X | 20 | |
| Security/Isolation | X | 15 | |
| API Completeness | X | 15 | |
| Error Handling | X | 10 | |
| Test Coverage | X | 10 | |

## CLAUDE.md Violations

| Rule | File:Line | Violation | Fix |
|------|-----------|-----------|-----|
| Money | file.ts:XX | parseFloat() | new Money() |

## User Flows

| Flow | Status | Notes |
|------|--------|-------|
| Create | OK/PARTIAL/FAIL | |
| Update | OK/PARTIAL/FAIL | |
| Delete | OK/PARTIAL/FAIL | |

## Recommendations

P0 (Blocking): [Issues]
P1 (Major): [Issues]
P2 (Minor): [Issues]
```

## Red Flags

**Functional bugs:**
- `await db.insert(...).returning()` with no follow-up
- `return result` without updating related entities
- `// TODO` in critical paths

**Security:**
- `.where(eq(table.id, id))` without householdId
- `findById()` without visibility check for cross-entity links

**Data integrity:**
- `parseFloat()` or `Math.round()` on amounts
- Missing `withTransaction()` for multi-table ops
- Missing `FOR UPDATE` on uniqueness checks

**Contract mismatches:**
- Client type `string` vs server returns `MoneyDto`
- Client calls endpoints that don't exist

## Quick Reference

| Module | Assessment | Score |
|--------|------------|-------|
| CashFlow | `docs/reviews/CASHFLOW_MODULE_ASSESSMENT.md` | 82/100 |
| Recurring | `docs/reviews/RECURRING_MODULE_ASSESSMENT.md` | 72/100 |
| Goals | `docs/reviews/GOALS_MODULE_ASSESSMENT.md` | 68/100 |
| Receipts | `docs/reviews/RECEIPTS_MODULE_ASSESSMENT.md` | 65/100 |
| Reports | `docs/reviews/REPORTS_MODULE_ASSESSMENT.md` | 52/100 |
| Investments | `docs/reviews/INVESTMENTS_MODULE_ASSESSMENT.md` | 45/100 |

Cross-reference: `docs/issues/KNOWN_ISSUES.md`
