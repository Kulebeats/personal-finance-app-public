# Security Code Review Report

> **Date:** 2026-01-13 (Updated)
> **Version:** 3.0
> **Auditor:** Security Review Team
> **Scope:** Full-stack security assessment - Authentication, Authorization, Data Protection, API Security
> **Standards:** OWASP API Security Top 10 (2023), OWASP ASVS 4.0.3, NIST CSF 2.0, ISO 27001:2022, **Zambia Data Protection Act No. 3 of 2021**
> **Status:** Complete - Critical Financial Security Issues RESOLVED

---

> **Action Required:** For implementation steps to fix remaining findings, see the consolidated **[Security Fixes Guide](phase-0-security-fixes.md)** which includes production-ready code and prioritized fix instructions.

---

## Executive Summary

| Category              | Status       | Score  | Change (v3.0) |
| --------------------- | ------------ | ------ | ------------- |
| Authentication        | Good         | 7.5/10 | --            |
| Authorization         | **CRITICAL** | 4/10   | --            |
| Session Management    | Good         | 8/10   | --            |
| Input Validation      | Good         | 7/10   | --            |
| Rate Limiting         | Excellent    | 9/10   | --            |
| Security Headers      | Good         | 7/10   | --            |
| Error Handling        | Good         | 7/10   | --            |
| Logging & Audit       | Good         | 7/10   | **+2**        |
| Cryptography          | Good         | 8/10   | --            |
| SQL Injection         | Excellent    | 9/10   | --            |
| File Upload Security  | Good         | 7/10   | --            |
| Supply Chain Security | Good         | 7/10   | --            |
| Secrets Management    | Partial      | 6/10   | --            |
| **Financial Security** | **Excellent** | **9/10** | **NEW**     |
| **Data Protection (Zambia DPA)** | **In Progress** | **6/10** | **NEW**     |

**Overall Security Score: 7.4/10** - Critical financial issues resolved; admin access issues remain; Zambia DPA compliance in progress.

### Risk Summary

| Severity | Count | Description                                                                          |
| -------- | ----- | ------------------------------------------------------------------------------------ |
| CRITICAL | 2     | Unauthenticated admin access, Debug logging exposure                                 |
| HIGH     | 4     | CORS misconfiguration, Missing auth on import, PII in logs, File-based error logging |
| MEDIUM   | 6     | No MFA, No account lockout, Console.log usage, Dev secrets in responses              |
| LOW      | 5     | Session duration, CSP disabled in dev, Password hash fetched unnecessarily           |
| **RESOLVED** | **4** | **Double-spend vulnerability, Floating point math, Controller patterns, Type safety** |

---

## RESOLVED: Financial Security Issues (v3.0 Update)

### RESOLVED-01: Double-Spend Vulnerability in Goal Transfers

**Previous Severity:** CRITICAL
**Resolution Date:** 2026-01-13
**Status:** FIXED

**Original Issue:** The GoalTransferService read goal balances OUTSIDE the database transaction, then wrote updated balances inside the transaction. This created a race condition where concurrent transfers could result in:
- Negative balances
- Money creation (double-spend)
- Inconsistent state

**Fix Applied:**

```typescript
// server/services/GoalTransferService.ts - FIXED

// NEW: Method to acquire row lock
private async getGoalForUpdate(
  tx: TransactionType,
  goalId: string,
  householdId: string
): Promise<Goal> {
  const result = await tx
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
    .for("update")  // Acquire exclusive row lock
    .limit(1);

  if (!result.length) {
    throw new NotFoundError("Goal not found");
  }
  return result[0];
}

// FIXED: All operations inside transaction with locks
async transfer(householdId: string, userId: string, data: TransferData) {
  return await withTransaction(async (tx) => {
    // Read with lock INSIDE transaction
    const fromGoal = await this.getGoalForUpdate(tx, data.fromGoalId, householdId);
    const toGoal = await this.getGoalForUpdate(tx, data.toGoalId, householdId);

    // Money class arithmetic
    const transferAmount = new Money(data.amount);
    const fromBalance = new Money(fromGoal.currentAmount);
    const newFromBalance = fromBalance.subtract(transferAmount);

    // Validate and update
    if (newFromBalance.isNegative()) {
      throw new ValidationError("Insufficient funds");
    }

    // All writes inside same transaction
    await tx.update(goals).set({ ... });
    await tx.insert(goalTransfers).values({ ... });

    return { ... };
  });
}
```

**Verification:** TypeScript compiles, FOR UPDATE locking prevents concurrent modification.

---

### RESOLVED-02: Floating Point Math in Financial Operations

**Previous Severity:** HIGH
**Resolution Date:** 2026-01-13
**Status:** FIXED

**Original Issue:** Multiple services used JavaScript floating-point arithmetic for currency calculations:
- `parseFloat()` for parsing amounts
- `+` and `-` operators for currency math
- `Math.max(0, ...)` for balance floors
- Direct number addition with `+=`

**Files Fixed:**

| File | Issue | Fix |
|------|-------|-----|
| `GoalTransferService.ts` | `parseFloat()`, arithmetic operators | Money class throughout |
| `TransactionGoalLinkService.ts` | `Math.max(0, balance - amount)` | `Money.subtract()` + `isNegative()` |
| `assignment.service.ts` | `Math.max(0, ...)` pattern | Money class arithmetic |
| `AccountReportingService.ts` | `+=` for summing balances | `Money.zero()` + `.add()` |

**Example Fix (AccountReportingService.ts):**

```typescript
// BEFORE (Vulnerable):
let totalAssets = 0;
let totalLiabilities = 0;
for (const account of balances) {
  const balance = new Money(account.balance).toNumber();  // Lost precision
  if (account.isAsset) {
    totalAssets += balance;  // Floating point addition
  } else {
    totalLiabilities += Math.abs(balance);
  }
}
return {
  totalAssets: Math.round(totalAssets * 100) / 100,  // Rounding errors
  ...
};

// AFTER (Fixed):
let totalAssets = Money.zero();
let totalLiabilities = Money.zero();
for (const account of balances) {
  const balance = new Money(account.balance);
  if (account.isAsset) {
    totalAssets = totalAssets.add(balance);  // Precise decimal math
  } else {
    totalLiabilities = totalLiabilities.add(balance.abs());
  }
}
return {
  totalAssets: totalAssets.toNumber(),  // Convert only at boundary
  totalLiabilities: totalLiabilities.toNumber(),
  netWorth: totalAssets.subtract(totalLiabilities).toNumber(),
};
```

**Money Class Methods Added:**

```typescript
// server/core/money.ts - New helper methods
isNegativeOrZero(): boolean {
  return this._amount.isNegative() || this._amount.isZero();
}

isPositiveOrZero(): boolean {
  return this._amount.isPositive() || this._amount.isZero();
}
```

---

### RESOLVED-03: Controller Pattern Violations (Direct DB Access)

**Previous Severity:** MEDIUM (Architecture)
**Resolution Date:** 2026-01-13
**Status:** FIXED

**Original Issue:** `rules.controller.ts` imported `db` directly and executed SQL queries, violating the 3-layer architecture pattern (Controller → Service → Repository).

**Fix Applied:**

```typescript
// BEFORE (server/modules/rules/rules.controller.ts):
import { db } from "../../db";
import { rules, transactions } from "@shared/schema";

// Direct DB queries in controller
const rulesList = await db
  .select()
  .from(rules)
  .where(eq(rules.householdId, householdId));

// AFTER (Fixed):
import { ruleRepository } from "../../repositories/RuleRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";

// Delegate to repository
const rulesList = await ruleRepository.findByHousehold(householdId);
```

**Repository Methods Added:**

```typescript
// server/repositories/RuleRepository.ts - New methods
async updateByHousehold(
  id: string,
  householdId: string,
  data: Partial<Rule>
): Promise<Rule | undefined> {
  const result = await db
    .update(rules)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
    .returning();
  return result[0];
}

async deleteByHousehold(
  id: string,
  householdId: string
): Promise<Rule | undefined> {
  const result = await db
    .delete(rules)
    .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
    .returning();
  return result[0];
}
```

---

### RESOLVED-04: Type Safety Improvements

**Previous Severity:** LOW
**Resolution Date:** 2026-01-13
**Status:** FIXED

**Issues Fixed:**

| File | Issue | Fix |
|------|-------|-----|
| `rules.controller.ts` | `error: any` in validationError | `error: z.ZodError` |
| `tags.controller.ts` | `error: any` in validationError | `error: z.ZodError` |
| `investments.service.ts` | `filters.type as any` | Proper enum types in validation schema |
| `investments.validation.ts` | `z.string()` for enum fields | `z.enum(securityTypes)` |

**Validation Schema Fix:**

```typescript
// server/modules/investments/investments.validation.ts

// Enum values matching database schema
const securityTypes = [
  "stock", "bond", "etf", "mutual_fund", "unit_trust",
  "term_deposit", "tbill", "forex", "crypto", "other",
] as const;

const securityExchanges = [
  "luse", "nyse", "nasdaq", "jse", "otc", "boz", "manual",
] as const;

export const listSecuritiesQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(securityTypes).optional(),      // Was: z.string()
  exchange: z.enum(securityExchanges).optional(), // Was: z.string()
  currency: z.string().optional(),
});
```

---

## Financial Security Section (NEW)

### Financial Security Controls Matrix

| Control | Implementation | Status | Evidence |
|---------|----------------|--------|----------|
| **Currency Precision** | Money class (decimal.js) | Implemented | `server/core/money.ts` |
| **Race Condition Prevention** | FOR UPDATE row locking | Implemented | `GoalTransferService.ts:179-199` |
| **Audit Trail** | BusinessAuditService | Implemented | All financial controllers |
| **Household Isolation** | All queries filter by householdId | Implemented | Repository layer |
| **Input Validation** | Zod schemas with proper types | Implemented | Validation files |

### Money Class Usage Requirements

**CRITICAL RULE:** All monetary calculations MUST use the Money class.

```typescript
// NEVER do this:
const total = parseFloat(amount1) + parseFloat(amount2);
const result = Math.round(total * 100) / 100;

// ALWAYS do this:
const amount1Money = new Money(amount1);
const amount2Money = new Money(amount2);
const total = amount1Money.add(amount2Money);
const result = total.toNumber(); // Only at API boundary
```

### Transaction Locking Pattern

**CRITICAL RULE:** Financial mutations must use FOR UPDATE locking.

```typescript
// Required pattern for concurrent-safe updates:
return await withTransaction(async (tx) => {
  // 1. Acquire locks on all affected rows
  const entity = await tx
    .select()
    .from(table)
    .where(eq(table.id, id))
    .for("update")  // REQUIRED for financial data
    .limit(1);

  // 2. Perform calculations with Money class
  const newBalance = new Money(entity.balance).subtract(amount);

  // 3. Update within same transaction
  await tx.update(table).set({ balance: newBalance.toString() });

  return result;
});
```

---

## Critical Findings (Remaining)

### CRITICAL-01: Unauthenticated Admin Endpoint Access

**Severity:** CRITICAL
**CVSS Score:** 9.1 (Critical)
**Location:** [server/routes/admin.ts](../../server/routes/admin.ts)
**CWE:** CWE-306 (Missing Authentication for Critical Function)
**Status:** OPEN

**Issue:** The `/api/admin/calculation-shadow-status` endpoint is completely unprotected. Any unauthenticated user can access internal system metrics and calculation logs.

**Remediation Required:**

```typescript
import { requireAuth } from "../auth";

const router = Router();

// Add authentication and admin role check
router.use(requireAuth);
router.use(requireAdminRole); // New middleware needed

router.get("/calculation-shadow-status", async (req, res) => {
  // Protected endpoint
});
```

---

### CRITICAL-02: Sensitive Information in Debug Logs

**Severity:** CRITICAL
**CVSS Score:** 7.5 (High)
**Location:** [server/middleware/householdGuard.ts:52](../../server/middleware/householdGuard.ts#L52)
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
**Status:** OPEN

**Issue:** The householdGuard middleware logs user IDs and household information directly to console.

**Remediation Required:**

```typescript
import { logger, hashId } from "../utils/logger";

logger.debug("Household guard check", {
  userId: hashId(userId),
  householdFound: !!household,
});
```

---

## High Priority Findings (Remaining)

### HIGH-01: CORS Misconfiguration

**Status:** OPEN
**Location:** [server/app.ts:52-57](../../server/app.ts#L52-L57)

**Remediation Required:**

```typescript
const corsOrigin = process.env.CLIENT_URL;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  throw new Error("CLIENT_URL environment variable is required in production");
}
```

### HIGH-02: Missing Authentication on Import Parse Endpoint

**Status:** OPEN
**Location:** [server/routes/import.ts:10](../../server/routes/import.ts#L10)

**Remediation Required:**

```typescript
router.post("/parse", requireAuth, upload.single("file"), async (req, res) => {
  // Now protected
});
```

---

## Updated OWASP API Security Top 10 Compliance

| #     | Vulnerability                                   | Status   | Notes                              |
| ----- | ----------------------------------------------- | -------- | ---------------------------------- |
| API1  | Broken Object Level Authorization               | Covered  | householdGuard + FOR UPDATE locking |
| API2  | Broken Authentication                           | Covered  | bcrypt, secure sessions            |
| API3  | Broken Object Property Level Authorization      | Partial  | Need field-level restrictions      |
| API4  | Unrestricted Resource Consumption               | Covered  | Multi-tier rate limiting           |
| API5  | Broken Function Level Authorization             | **FAIL** | Admin routes still unprotected     |
| API6  | Unrestricted Access to Sensitive Business Flows | **IMPROVED** | FOR UPDATE locking prevents race conditions |
| API7  | Server Side Request Forgery                     | N/A      | No external URL fetching           |
| API8  | Security Misconfiguration                       | Partial  | CORS fallback issue remains        |
| API9  | Improper Inventory Management                   | Partial  | No OpenAPI spec                    |
| API10 | Unsafe Consumption of APIs                      | N/A      | No third-party API consumption     |

---

## Remediation Status Summary

### Completed (v3.0)

| ID | Issue | Resolution |
|----|-------|------------|
| FIN-01 | Double-spend vulnerability | FOR UPDATE locking in transactions |
| FIN-02 | Floating point math | Money class for all currency ops |
| FIN-03 | Controller DB access | Repository pattern enforcement |
| FIN-04 | Type safety (`any` types) | Zod schemas with proper enums |

### Closed - Immediate Priority (2026-02-06)

| ID | Issue | Owner | Due |
|----|-------|-------|-----|
| CRIT-01 | Admin endpoint auth | Security | Closed 2026-02-06 |
| CRIT-02 | Debug logging with PIIs | Security | Closed 2026-02-06 |
| HIGH-03 | File-based error logging | Security | Closed 2026-02-06 |

Code evidence:
- `server/routes/admin.ts` applies `requireAuth` and `requireAnySystemRole` at router level.
- `server/middleware/householdGuard.ts` logs masked identifiers only (`substring(0,8) + "..."`).
- `server/utils/logger.ts` centralizes structured logging to stdout/stderr (no active file sink in runtime logger).

### Closed - This Sprint (2026-02-06)

| ID | Issue | Owner | Due |
|----|-------|-------|-----|
| HIGH-01 | CORS fallback | Security | Closed 2026-02-06 |
| HIGH-02 | Import parse auth | Security | Closed 2026-02-06 |
| MED-01 | Account lockout | Security | Closed 2026-02-06 |

Code evidence:
- `server/app.ts` enforces `CLIENT_URL` in production and only falls back to localhost in non-production.
- `server/routes/import.ts` applies `requireAuth`, `householdGuard`, and `uploadLimiter` to all import routes.
- `server/modules/auth/auth.service.ts` enforces lockout after 5 failed attempts with 15-minute lock duration.

---

## Compliance Checklist for Developers (Updated)

### Before Each PR

- [ ] No `console.log` in new code (use `logger`)
- [ ] All endpoints use `requireAuth` middleware (unless intentionally public)
- [ ] All household resources use `householdGuard`
- [ ] All request bodies validated with Zod
- [ ] No sensitive data in error responses
- [ ] Rate limiting applied to new endpoints
- [ ] Audit log entries for write operations
- [ ] No secrets or tokens in code or comments
- [ ] **NEW:** All currency calculations use Money class
- [ ] **NEW:** Financial mutations use FOR UPDATE locking
- [ ] **NEW:** Controllers delegate to services/repositories (no direct DB)
- [ ] **NEW:** No `any` type assertions without justification

### Before Each Release

- [ ] Dependency audit: `npm audit`
- [ ] Security scan: `npx snyk test`
- [ ] Environment variables documented
- [ ] CORS origins verified
- [ ] Rate limits appropriate
- [ ] Error messages reviewed
- [ ] **NEW:** Money class usage verified in financial code
- [ ] **NEW:** Transaction locking verified in concurrent operations

---

**Document Version:** 3.1
**Last Updated:** 2026-02-07
**Next Review:** 2026-02-20
**Reviewer:** Security Review Team
**Approved By:** [Pending]

---

## Appendix A: Security Debt Tracking (Updated)

| ID     | Description             | Priority | Sprint  | Owner | Status      |
| ------ | ----------------------- | -------- | ------- | ----- | ----------- |
| SD-001 | Admin endpoint auth     | CRITICAL | Current | Security | Closed (2026-02-06) |
| SD-002 | Console.log cleanup     | HIGH     | Current | Security | Closed (2026-02-06) |
| SD-003 | Audit logging           | MEDIUM   | Next    | Security | Closed (2026-02-06) |
| SD-004 | MFA implementation      | MEDIUM   | Backlog | Security | Closed (2026-02-06) |
| SD-005 | Double-spend prevention | CRITICAL | -       | -     | **CLOSED**  |
| SD-006 | Float math fixes        | HIGH     | -       | -     | **CLOSED**  |
| SD-007 | Controller patterns     | MEDIUM   | -       | -     | **CLOSED**  |
| SD-008 | Type safety             | LOW      | -       | -     | **CLOSED**  |
| SD-009 | ODPC registration       | CRITICAL | Current | DPO   | Closed in engineering tracker (moved to compliance workstream, owner DPO, target 2026-02-28) |
| SD-010 | DPO appointment         | CRITICAL | Current | Mgmt  | Closed in engineering tracker (moved to compliance workstream, owner Mgmt, target 2026-02-21) |
| SD-011 | Data localization       | HIGH     | Current | Ops   | Closed in engineering tracker (moved to infrastructure compliance workstream, owner Ops, target 2026-03-15) |
| SD-012 | Data subject rights     | MEDIUM   | Next    | Eng   | Closed in engineering tracker (moved to product/compliance backlog, owner Eng, target 2026-03-31) |

## Appendix B: Zambia Data Protection Act Compliance

### Regulatory Overview

**Act:** Data Protection Act No. 3 of 2021
**Authority:** Office of the Data Protection Commissioner (ODPC)
**Website:** https://www.dataprotection.gov.zm/
**Enforcement:** Commenced March 2025
**Registration Deadline:** 30 April 2025

### Compliance Status Matrix

| Requirement | Status | Evidence/Gap |
|-------------|--------|--------------|
| **ODPC Registration** | ⚠️ Required | Must register as Data Controller by 30 April 2025 |
| **Data Protection Officer** | ⚠️ Required | Appointment in progress |
| **Privacy Notice** | ✅ Implemented | Privacy policy at registration |
| **Data Minimization** | ✅ Compliant | Only essential data collected |
| **Security Measures** | ✅ Implemented | Encryption, access control, audit logs |
| **Data Localization** | ⚠️ Review | Verify Zambian hosting or obtain approval |
| **Breach Notification (24hr)** | ⚠️ Process | Incident response plan needed |
| **Data Subject Rights** | 🔄 Partial | Access/rectification: yes; Full portability: gap |
| **Records of Processing** | ✅ Implemented | Audit logs via BusinessAuditService |
| **DPIA (High Risk)** | ⚠️ Required | Data Protection Impact Assessment needed |

### Data Protection Principles Compliance

Per Section 12 of the DPA:

1. **Lawfulness, Fairness, Transparency** - ✅ Privacy policy, user consent
2. **Purpose Limitation** - ✅ Financial management only, no secondary use
3. **Data Minimization** - ✅ Essential fields only
4. **Accuracy** - ✅ User can update profile and transactions
5. **Storage Limitation** - 🔄 Partial: 7-year retention documented, formal policy needed
6. **Integrity and Confidentiality** - ✅ Encryption, access controls, audit logging

### Critical Compliance Gaps

1. **ODPC Registration (CRITICAL)**
   - Deadline: 30 April 2025
   - Action: Submit registration application
   - Owner: Data Protection Officer (to be appointed)

2. **Data Protection Officer Appointment (CRITICAL)**
   - Required: Per Section 42-43
   - Action: Appoint qualified DPO, register with ODPC
   - Owner: Management

3. **Data Localization Review (HIGH)**
   - Requirement: Data processed and stored in Zambia (Section 70-71)
   - Action: Verify hosting location or obtain ministerial approval
   - Owner: Operations

4. **Data Subject Rights Implementation (MEDIUM)**
   - Gap: Full data portability not implemented
   - Action: Implement "Download My Data" feature (all personal data)
   - Owner: Engineering

5. **Data Protection Impact Assessment (MEDIUM)**
   - Requirement: For high-risk processing (Section 48-49)
   - Action: Conduct DPIA for financial data processing
   - Owner: Data Protection Officer

### Reference Documentation

- **Full Compliance Guide:** `docs/compliance/ZAMBIA_DPA_compliance-summary.md`
- **Personal Data Inventory:** See compliance guide Appendix A
- **Processing Activities Record:** See compliance guide Appendix B
- **Breach Notification Process:** See compliance guide Appendix D

## Appendix C: Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-01 | Initial security review |
| 2.0 | 2026-01-09 | Comprehensive audit with OWASP alignment |
| 3.0 | 2026-01-13 | Added Financial Security section; Documented fixes for double-spend, floating point, controller patterns, type safety; Updated compliance matrix; **Added Zambia Data Protection Act compliance section** |
