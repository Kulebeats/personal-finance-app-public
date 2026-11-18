# FINAL REFACTORING PACKAGE

> Generated on: 2026-01-09

This document consolidates:

1. **Strategic Recommendations** (What & Why)
2. **Technical Specification** (How - Part A)
3. **Security Audit Report** (Why - Part B)

---

# PART 1: STRATEGIC REFACTORING RECOMMENDATIONS

> Original Document: `CODEBASE_REFACTORING_RECOMMENDATIONS.md`

## Executive Summary

This refactoring plan modernizes the codebase with clear domain boundaries, deterministic money handling, and fintech-grade security controls. It combines internal code analysis with external industry standards.

### Key Outcomes

| Outcome              | Target    |
| -------------------- | --------- |
| Largest server file  | < 500 LOC |
| Largest client file  | < 300 LOC |
| Core test coverage   | > 80%     |
| Report response time | < 150 ms  |
| Cache hit rate       | > 70%     |

### Priority Matrix

| Area                       | Priority  | Impact | Effort | Notes                                  |
| -------------------------- | --------- | ------ | ------ | -------------------------------------- |
| ReportRepository split     | 🔴 High   | High   | Medium | Reduce God object (2975 LOC → 6 files) |
| Route handler extraction   | 🔴 High   | High   | Medium | Clear domain boundaries                |
| Transaction domain service | 🔴 High   | High   | Medium | Fintech correctness, idempotency       |
| Modular monolith structure | 🔴 High   | High   | High   | Industry-standard architecture         |
| Centralized validation     | 🟡 Medium | Medium | Low    | Consistent API contracts               |
| Event-driven + outbox      | 🟡 Medium | High   | High   | Decouple workflows                     |
| Caching layer              | 🟡 Medium | High   | Medium | Performance                            |
| Client decomposition       | 🔴 High   | High   | Medium | Maintainable UI                        |
| Shared money utilities     | 🔴 High   | High   | Low    | Deterministic calculations             |
| Security controls          | 🔴 High   | High   | Medium | Compliance readiness                   |

---

## Scope and Goals

**In Scope:**

- Improve maintainability and testability across server and client
- Reduce coupling between business workflows
- Establish security, audit, and compliance baselines
- Create clear delivery phases with measurable outcomes

**Out of Scope (this phase):**

- Major product feature changes unrelated to refactoring
- Large UI redesigns not required by refactor

---

## Current State Analysis

### Server Structure Issues

```text
server/
├── routes/        ← 30 files (some 40-57KB) 🔴 Business logic mixed in
├── services/      ← 35 files (some 20-35KB) 🟡 Good layer, but bloated
├── repositories/  ← 10 files (one 90KB!) 🔴 God Object anti-pattern
├── middleware/    ← 6 files ✅ Good separation
├── validation/    ← 7 files ✅ Good practice
├── utils/         ← 5 files ✅ Utility functions
├── core/          ← 56 files ✅ Calculation Engine (well done!)
├── jobs/          ← 4 files ✅ Background jobs
└── types/         ← 1 file ✅ Shared types
```

### Key Problem Files

| File                     | Size             | Issue                                |
| ------------------------ | ---------------- | ------------------------------------ |
| `ReportRepository.ts`    | 2,975 LOC / 90KB | God Object - 28 methods              |
| `investments.ts` (route) | 57KB             | Trading + holdings + analytics mixed |
| `settings.ts` (route)    | 40KB             | User + household + preferences mixed |
| `GoalService.ts`         | 35KB             | Too many responsibilities            |
| `RecurringService.ts`    | 30KB             | Complex workflows                    |

---

## Design Principles

1. **Domain boundaries first** - Organize around business domains (transactions, reports, investments, settings)
2. **Thin controllers** - Routes only orchestrate, no business rules
3. **Service layer owns invariants** - Single source of truth for business rules
4. **Repository layer is query-only** - Reusable data access
5. **Explicit contracts** - All inputs validated and typed
6. **Deterministic money** - Decimal math, explicit currency, stable rounding
7. **Auditability** - Record who changed what and why
8. **Observable by default** - Structured logs, metrics, trace IDs

---

## Target Architecture: Modular Monolith

Based on app size (35+ services) and industry best practices, **Modular Monolith with Feature-Based Structure** is recommended.

### Why Modular Monolith?

| Benefit              | Description                     |
| -------------------- | ------------------------------- |
| Feature isolation    | Each domain is self-contained   |
| Parallel development | Teams work on different modules |
| Easy navigation      | All related code in one place   |
| Microservices ready  | Easy to extract later           |
| Single deployment    | Simple ops                      |

### Proposed Structure

```text
server/
├── app.ts                          # Express app setup
├── index.ts                        # Entry point
├── config/                         # Environment config
│
├── core/                           # Shared infrastructure
│   ├── calculations/               # ← Already done! ✅
│   ├── database/                   # DB connection, migrations
│   ├── errors/                     # AppError, NotFoundError, etc.
│   ├── events/                     # Event emitter, handlers
│   ├── cache/                      # Caching abstraction
│   ├── http/                       # Request/response helpers
│   ├── money/                      # Money, FX, rounding utilities
│   └── validation/                 # Shared validation schemas
│
├── modules/                        # Feature modules
│   ├── auth/
│   │   ├── auth.controller.ts      # Route handlers
│   │   ├── auth.service.ts         # Business logic
│   │   ├── auth.repository.ts      # Data access
│   │   ├── auth.validation.ts      # Zod schemas
│   │   ├── auth.types.ts           # Module-specific types
│   │   ├── auth.routes.ts          # Express routes
│   │   └── __tests__/              # Module tests
│   │
│   ├── transactions/
│   │   ├── transactions.controller.ts
│   │   ├── transactions.service.ts
│   │   ├── transactions.repository.ts
│   │   ├── transactions.validation.ts
│   │   ├── transactions.events.ts  # Domain events
│   │   ├── transactions.routes.ts
│   │   └── __tests__/
│   │
│   ├── accounts/
│   │   └── ... (same pattern)
│   │
│   ├── goals/
│   │   ├── goals.controller.ts
│   │   ├── goals.service.ts        # Uses core/calculations/goals
│   │   ├── goal-assignments.service.ts
│   │   ├── goal-activity.service.ts
│   │   ├── goals.repository.ts
│   │   ├── goals.routes.ts
│   │   └── __tests__/
│   │
│   ├── budgets/
│   │   └── ...
│   │
│   ├── investments/
│   │   ├── holdings/               # Sub-module
│   │   │   ├── holdings.controller.ts
│   │   │   ├── holdings.service.ts
│   │   │   └── holdings.routes.ts
│   │   ├── portfolio/              # Sub-module
│   │   ├── analytics/              # Sub-module
│   │   └── index.ts                # Re-exports all routes
│   │
│   ├── reports/
│   │   ├── spending/               # Split the God Object!
│   │   │   ├── spending.service.ts
│   │   │   └── spending.controller.ts
│   │   ├── cashflow/
│   │   ├── networth/
│   │   ├── annual/
│   │   └── index.ts
│   │
│   ├── recurring/
│   ├── notifications/
│   ├── merchants/
│   └── settings/
│       ├── user-settings/          # Sub-module
│       ├── household-settings/     # Sub-module
│       └── ...
│
├── shared/                         # Cross-cutting concerns
│   ├── middleware/                 # Express middleware
│   ├── decorators/                 # Custom decorators
│   └── guards/                     # Auth guards
│
└── jobs/                           # Background jobs
    ├── price-update.job.ts
    ├── recurring-sync.job.ts
    └── ...
```

---

## Global Requirements

### Architecture Requirements

- No business logic inside route handlers
- Every domain has controllers, services, repositories, and validation schemas
- Cross-domain workflows must be event-driven or background jobs
- Shared utilities live in `shared/` or `server/core`

### Code Quality Requirements

- Max file sizes:
  - Server route files < 500 LOC
  - Client page files < 300 LOC
  - React components < 200 LOC (unless purely presentational)
- Avoid `any` in new code; use types or guards
- Prefer pure functions for transforms; no in-place mutation
- No direct DOM manipulation in React

### Fintech Correctness Requirements

- Monetary values use decimal-safe types with explicit currency
- FX conversions are deterministic and reference rate source + timestamp
- Idempotency for retryable write endpoints
- Audit trail for critical operations (create/update/delete transactions, imports)

### Operational Requirements

- Structured logging with correlation IDs
- Error responses are consistent and machine-readable
- Background jobs are retryable and observable
- Backups and data retention policies are documented

---

## Implementation Roadmap

### Phase 0: Security Remediation (Immediate)

Fix critical security issues before architectural refactoring.

### Phase 1: Foundation (Week 1-2)

- [ ] Create core/errors, events, http, money
- [ ] Split ReportRepository
- [ ] Create modules/ directory structure

### Phase 2: Pilot Modules (Week 3-4)

- [ ] Migrate auth module
- [ ] Add TransactionService with invariants
- [ ] Centralized validation registry

### Phase 3: Critical Modules (Week 5-8)

- [ ] Migrate transactions, accounts, goals
- [ ] Event-driven + outbox pattern
- [ ] Caching abstraction

### Phase 4: Remaining Modules (Week 9-12)

- [ ] Migrate reports, investments, settings
- [ ] Background jobs refactor

### Phase 5: Client & Cleanup (Week 13-16)

- [ ] Client refactor: Transactions, Recurring, Investments pages
- [ ] Cleanup legacy code
- [ ] Final docs

---

# PART 2: TECHNICAL SPECIFICATION

> Original Document: `REFACTORING_TECHNICAL_SPEC.md`

## 1. Summary

This document is the technical specification for implementing the refactoring plan. It defines component boundaries, interfaces, data model changes, migration steps, and acceptance criteria.

## 2. Workstreams

| #   | Workstream                             | Priority    | Description                                  |
| --- | -------------------------------------- | ----------- | -------------------------------------------- |
| 0   | **Security Remediation**               | 🔴 CRITICAL | Fix authorization gaps, remove debug logging |
| 1   | Server domain decomposition            | 🟡 HIGH     | Split God objects, extract modules           |
| 2   | Shared libraries and utilities         | 🟡 HIGH     | Money, validation, error handling            |
| 3   | Eventing, caching, and background jobs | 🟡 MEDIUM   | Decouple workflows                           |
| 4   | Client feature modularization          | 🟡 MEDIUM   | Split large pages                            |
| 5   | Security hardening & observability     | 🟢 ONGOING  | Audit logging, structured logs               |

### Workstream 0: Security Remediation

> [!CAUTION]
> These security issues must be fixed **before** other refactoring work begins.
> See Part 3 for full details.

**Critical Fixes (Complete within 24 hours):**

| ID      | Issue                       | File                                          | Action                               |
| ------- | --------------------------- | --------------------------------------------- | ------------------------------------ |
| CRIT-01 | Unprotected admin endpoint  | `server/routes/admin.ts`                      | Add `requireAuth` + admin role check |
| CRIT-02 | Debug logging with user IDs | `server/middleware/householdGuard.ts:52-64`   | Replace with structured logger       |
| HIGH-03 | File-based error logging    | `server/middleware/householdGuard.ts:101-112` | Remove file logging                  |

---

## 3. Server Refactoring Specifications

### A1. ReportRepository Split (High)

**Problem:** `ReportRepository.ts` is 2,975 lines with 28 methods mixing multiple domains.

**Target state:**

```text
server/repositories/reports/
├── index.ts                    # Re-exports all
├── BaseReportRepository.ts     # Common query builders, FX conversion
├── SpendingReportRepository.ts # Breakdown, trends
├── CashflowReportRepository.ts # Cashflow, income, savings rate
├── NetWorthReportRepository.ts # Net worth, changes
├── TransactionReportRepository.ts # Drilldown, pagination
├── CompositeReportRepository.ts # Annual, Sankey
└── __tests__/
```

**Requirements:**

- Each repository exports only its domain methods
- Shared query primitives live in BaseReportRepository
- No file exceeds 400 LOC

### A2. Route Handler Extraction (High)

**Target state:** Controller → Service → Repository pattern.

**Requirements:**

- Controllers call services only
- Services call repositories only
- Validation happens at the controller boundary

### A3. Transaction Domain Service (High)

**Requirements:**

- All transaction writes go through TransactionService
- Invariants enforced:
  - Sign conventions (expenses negative, income positive)
  - Currency consistency
  - Account ownership validation
  - Duplicate protection (idempotency keys)

### A5. Event-Driven Architecture + Outbox (Medium)

**Target pattern (loose coupling):**

```typescript
async createTransaction(data) {
  const tx = await db.insert(...);
  appEvents.emit('transaction:created', tx);  // Event
  return tx;
}

// GoalService listens
appEvents.on('transaction:created', (tx) => {
  this.syncGoalsForAccount(tx.accountId);
});
```

---

## 4. API Endpoint Mapping

### /api/accounts (accounts.ts)

Target: AccountsController -> AccountsService
| Method | Endpoint | Suggested Action |
| --- | --- | --- |
| GET | /api/accounts | list |
| GET | /api/accounts/summary | getSummary |
| POST | /api/accounts | create |
| PUT | /api/accounts/:id | update |
| DELETE | /api/accounts/:id | delete |

### /api/admin (admin.ts)

Target: AdminController -> AdminService
| Method | Endpoint | Suggested Action |
| --- | --- | --- |
| GET | /api/admin/calculation-shadow-status | getCalculationShadowStatus |

### /api/auth (auth.ts)

Target: AuthController -> AuthService
| Method | Endpoint | Suggested Action |
| --- | --- | --- |
| POST | /api/auth/register | createRegister |
| POST | /api/auth/login | createLogin |
| POST | /api/auth/logout | createLogout |

---

# PART 3: SECURITY AUDIT REPORT

> Original Document: `docs/reviews/security-audit-report-2026-01-13-v3.md`

## Executive Summary

| Category           | Status       | Score  |
| ------------------ | ------------ | ------ |
| Authentication     | Good         | 7.5/10 |
| Authorization      | **CRITICAL** | 4/10   |
| Session Management | Good         | 8/10   |
| Input Validation   | Good         | 7/10   |
| Rate Limiting      | Excellent    | 9/10   |
| Security Headers   | Good         | 7/10   |
| Error Handling     | Good         | 7/10   |
| Logging & Audit    | Partial      | 5/10   |
| Cryptography       | Good         | 8/10   |
| SQL Injection      | Excellent    | 9/10   |

**Overall Security Score: 6.8/10** - Critical issues require immediate attention.

### Risk Summary

| Severity | Count | Description                                                                          |
| -------- | ----- | ------------------------------------------------------------------------------------ |
| CRITICAL | 2     | Unauthenticated admin access, Debug logging exposure                                 |
| HIGH     | 4     | CORS misconfiguration, Missing auth on import, PII in logs, File-based error logging |
| MEDIUM   | 6     | No MFA, No account lockout, Console.log usage, Dev secrets in responses              |
| LOW      | 5     | Session duration, CSP disabled in dev, Password hash fetched unnecessarily           |

---

## Critical Findings

### CRITICAL-01: Unauthenticated Admin Endpoint Access

**Severity:** CRITICAL
**CVSS Score:** 9.1 (Critical)
**Issue:** The `/api/admin/calculation-shadow-status` endpoint is completely unprotected.

**Remediation:**

```typescript
import { requireAuth } from "../auth";
import { requireAdminRole } from "../middleware/adminGuard";

router.use(requireAuth);
router.use(requireAdminRole); // New middleware needed

router.get("/calculation-shadow-status", async (req, res) => {
  // Protected endpoint
});
```

### CRITICAL-02: Sensitive Information in Debug Logs

**Severity:** CRITICAL
**CVSS Score:** 7.5 (High)
**Issue:** The householdGuard middleware logs user IDs and household information directly to console.

**Remediation:**

Replace with structured logger using ID hashing:

```typescript
import { logger, hashId } from "../utils/logger";

logger.debug("Household guard check", {
  userId: hashId(userId),
  householdFound: !!household,
});
```

---

## Security Component Specs (for Refactoring)

### J1. Admin Role Middleware

**Problem:** Admin endpoints are unprotected (CRIT-01)
**Target File:** `server/middleware/adminGuard.ts`

```typescript
export async function requireAdminRole(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Check auth and admin role
  if (!user?.isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN" } });
  }
  next();
}
```

### J2. Structured Logger Service

**Problem:** Console.log exposes user IDs and PII (CRIT-02)
**Target File:** `server/core/logger/index.ts`

```typescript
class Logger {
  // Automatic PII redaction and ID hashing
  info(message: string, context?: LogContext) { ... }
  error(message: string, context?: LogContext, error?: Error) { ... }
}
export const logger = new Logger();
```

### J3. Audit Log Service

**Problem:** No comprehensive audit trail for write operations
**Target File:** `server/core/audit/index.ts`

**Schema:**

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

### J4. CORS Configuration Fix

**Problem:** Permissive CORS fallback (HIGH-01)
**Target File:** `server/app.ts`

```typescript
const corsOrigin = process.env.CLIENT_URL;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  throw new Error("CLIENT_URL environment variable is required in production");
}
// ...
```
