---
name: review-code
description: Senior Developer code review for architecture, type safety, and CLAUDE.md compliance. Use when reviewing server modules, client features, or PRs for code quality, LOC limits, Money class usage, audit logging, and rate limiting.
---

# Senior Developer Code Review

Review code for architecture, type safety, and CLAUDE.md compliance.

## Context

$ARGUMENTS

## Process

1. Identify module(s) from Module Reference
2. Run anti-pattern scans (`rg` commands below)
3. Check LOC limits
4. Score and report

## App Module Reference

| Module | Server Location | Client Location |
|--------|-----------------|-----------------|
| Accounts | `server/modules/accounts/` | `client/src/features/accounts/` |
| Transactions | `server/modules/transactions/` | `client/src/features/transactions/` |
| Budgets | `server/services/budget/` | `client/src/features/budgets/` |
| Goals | `server/modules/goals/`, `server/services/Goal/` | `client/src/features/goals/` |
| Recurring | `server/modules/recurring/` | `client/src/features/recurring/` |
| Investments | `server/modules/investments/` | `client/src/features/investments/` |
| Reports | `server/modules/reports/` | `client/src/features/reports/` |
| Receipts | `server/modules/receipts/` | `client/src/pages/Receipts.tsx` |

## CLAUDE.md Critical Rules (MUST Check)

| Rule | Check Command |
|------|---------------|
| Rule 1: Money class | `rg -n "parseFloat\|Math\.round" <path>` |
| Rule 2: LOC limits | Server 500, Client 300, Routes 100 |
| Rule 9: Audit logging | `rg -n "businessAuditService" <path>` |
| Rule 12: Rate limiting | `rg -n "Limiter" <path>/*.routes.ts` |
| Rule 16: No `as any` | `rg -n "as any" <path>` |

## Scoring Rubric (100 Points)

| Category | Points | Criteria |
|----------|--------|----------|
| Architecture | 20 | Modular pattern, separation of concerns |
| Type Safety | 20 | No `any`, Zod schemas, proper types |
| CLAUDE.md Compliance | 20 | Money class, audit, rate limiting, LOC |
| Error Handling | 15 | Error classes, proper throws |
| Security | 15 | Validation, auth context, SQL safety |
| Code Quality | 10 | Naming, DRY, single responsibility |

## Review Checklist

### 1. Architecture & Design
- [ ] Follows modular pattern (controller/service/validation separation)
- [ ] No business logic in controllers (validate → service → respond)
- [ ] Services use repository pattern for data access
- [ ] File sizes within limits (<500 LOC server, <300 LOC client)

### 2. Type Safety
- [ ] No `any` types in production code
- [ ] Zod schemas define input validation
- [ ] Types exported from validation files (`z.infer<typeof schema>`)
- [ ] Proper null/undefined handling

### 3. Error Handling
- [ ] Uses error classes from `server/utils/errorHandler`
- [ ] Throws errors instead of returning error responses
- [ ] Async operations caught by error middleware
- [ ] Errors logged with context

### 4. API Standards
- [ ] Uses response helpers (`success()`, `created()`, `noContent()`)
- [ ] Follows V7 envelope format: `{ success: true, data: T }`
- [ ] Pagination includes `{ total, page, pageSize, hasNext, hasPrev }`
- [ ] HTTP status codes are correct

### 5. Security
- [ ] Input validated with Zod before processing
- [ ] Uses `req.householdContext!` for auth context
- [ ] WHERE clauses include `householdId`
- [ ] Rate limiting applied to all routes
- [ ] Audit logging for financial mutations

### 6. Performance
- [ ] No N+1 queries (use joins or batch)
- [ ] `withCache()` for expensive reads
- [ ] `withTransaction()` for multi-table writes
- [ ] Pagination for list endpoints

### 7. Code Style
- [ ] Meaningful variable/function names
- [ ] Single responsibility principle
- [ ] DRY (no duplicated logic)
- [ ] Comments only where logic isn't self-evident

## Output Format

```markdown
## Module: [Name] Code Review
Score: XX/100 | Status: Merge Ready / Needs Fixes / Requires Rework

## CLAUDE.md Rule Violations

| Rule | File:Line | Violation | Fix |
|------|-----------|-----------|-----|
| Money | file.ts:XX | parseFloat() | new Money() |
| Type | file.ts:XX | as any | Define interface |

## Critical Issues (Must Fix)
### CRIT-001: [Description]
- Location: [file:line]
- Problem: [What's wrong]
- Fix: [Specific change]

## Recommendations (Should Fix)
- [Suggestion with rationale]

## Positive Observations
- [What was done well]

## Files Reviewed
| File | LOC | Status |
|------|-----|--------|
| file.ts | XXX | OK / Over limit |
```

## Instructions

1. Identify scope from Module Reference
2. Run anti-pattern scans:
   ```bash
   rg -n "parseFloat|Math\.round" <path>
   rg -n "as any" <path>
   rg -n "businessAuditService" <path>
   ```
3. Check LOC limits
4. Review against checklist
5. Score and report

## Quick Reference: Existing Assessments

| Module | Score | Assessment File |
|--------|-------|-----------------|
| CashFlow | 82/100 | `docs/reviews/CASHFLOW_MODULE_ASSESSMENT.md` |
| Recurring | 72/100 | `docs/reviews/RECURRING_MODULE_ASSESSMENT.md` |
| Goals | 68/100 | `docs/reviews/GOALS_MODULE_ASSESSMENT.md` |
| Reports | 52/100 | `docs/reviews/REPORTS_MODULE_ASSESSMENT.md` |
| Investments | 45/100 | `docs/reviews/INVESTMENTS_MODULE_ASSESSMENT.md` |

Cross-reference: `docs/issues/KNOWN_ISSUES.md`
