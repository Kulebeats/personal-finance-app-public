# Settings Module - Fintech Compliance Review

**Reviewer:** Fintech Compliance Expert (Financial Accuracy, Regulatory Compliance)
**Date:** 2026-01-23
**Score:** 65/100 | **Risk Level:** MEDIUM

---

## Executive Summary

The Settings module has MEDIUM compliance risk due to missing audit logging on security-sensitive operations (password changes, session management, account deletion) and missing rate limiting on 3 of 4 sub-modules. While there are no Money class issues (no financial calculations), the lack of audit trail for user account modifications creates regulatory compliance gaps for Zambia DPA. Categories module is well-implemented with proper audit logging.

---

## Money Class Compliance (N/A)

**Settings is a non-financial module.** No currency or amount handling occurs.

```bash
rg -n "parseFloat|Math\.round" server/modules/settings/
rg -n "parseFloat|Math\.round" server/modules/categories/
rg -n "parseFloat|Math\.round" server/modules/rules/
rg -n "parseFloat|Math\.round" server/modules/merchants/
# Result: No matches in production code
```

The only occurrences are:
- `ActionCard.tsx:121` - `parseFloat(e.target.value)` for rule percentage (acceptable)
- `ProfileCompletenessWidget.tsx:122` - `Math.round()` for progress % (acceptable)

---

## Audit Logging Coverage (15/25)

### Module Audit Status

| Module | Operations | Audit Calls | Coverage |
|--------|------------|-------------|----------|
| Settings (core) | 4 | 0 | **0%** |
| Categories | 8 | 17 | **100%** |
| Rules | 5 | 0 | **0%** |
| Merchants | 4 | 0 | **0%** |

### Categories - GOOD

```typescript
// categories.controller.ts - Proper audit logging
await businessAuditService.logCreate({
  householdId,
  userId: req.user!.id,
  entityType: "category_group",
  entityId: group.id,
  newValue: { name: group.name, type: group.type },
  ipAddress: businessAuditService.getIpAddress(req),
});
```

**Logged Operations:**
- Create group ✅
- Update group ✅
- Delete group ✅
- Restore group ✅
- Create category ✅
- Update category ✅
- Delete category ✅
- Restore category ✅

### Settings Core - MISSING

**Security-sensitive operations without audit:**

| Operation | Endpoint | Risk Level |
|-----------|----------|------------|
| Password change | PUT /settings/password | HIGH |
| Session revoke | DELETE /sessions/:id | MEDIUM |
| Revoke all sessions | POST /sessions/revoke-all | MEDIUM |
| Account deletion | POST /account/delete | HIGH |
| Profile update | PUT /settings/profile | LOW |

### Rules - MISSING

**All CRUD operations without audit:**

| Operation | Endpoint | Should Log |
|-----------|----------|------------|
| Create rule | POST /api/rules | logCreate |
| Update rule | PUT /api/rules/:id | logUpdate |
| Delete rule | DELETE /api/rules/:id | logDelete |
| Reorder rules | PUT /api/rules/reorder | logUpdate |

### Merchants - MISSING

**All CRUD operations without audit:**

| Operation | Endpoint | Should Log |
|-----------|----------|------------|
| Create merchant | POST /api/merchants | logCreate |
| Update merchant | PUT /api/merchants/:id | logUpdate |
| Delete merchant | DELETE /api/merchants/:id | logDelete |
| Merge merchants | POST /api/merchants/merge | log (MERGE action) |

---

## Transaction Integrity (15/20)

### No Atomic Operations Found

The Settings module doesn't have multi-table operations requiring transactions, except:

**INTEGRITY-001: Merchant Merge**

- **Location:** `merchants.controller.ts:136-158`
- **Issue:** Merge operation updates transactions + deletes merchant without transaction
- **Risk:** Partial merge on failure
- **Recommendation:** Wrap in `withTransaction()`

```typescript
// Current implementation (simplified)
const result = await merchantService.merge(householdId, sourceId, targetId);
// Should be wrapped in transaction in service layer
```

---

## Privacy Controls (10/10)

### Household Scoping

All settings operations are properly scoped:

```typescript
// All queries include householdId
const rulesList = await ruleRepository.findByHousehold(householdId);
const groups = await categoryGroupRepository.findByHousehold(householdId);
```

### User-Level vs Household-Level

| Setting Type | Scope | Correct |
|--------------|-------|---------|
| Profile | User | ✅ |
| Password | User | ✅ |
| Sessions | User | ✅ |
| Preferences | Household | ✅ |
| Categories | Household | ✅ |
| Rules | Household | ✅ |
| Merchants | Household | ✅ |

---

## Rate Limiting (5/10)

### Applied Limiters

| Module | Route File | Has Limiter? |
|--------|------------|--------------|
| Settings (core) | settings.routes.ts | **NO** |
| Categories | categories.routes.ts | YES |
| Rules | rules.routes.ts | **NO** |
| Merchants | merchants.routes.ts | **NO** |

### Categories - GOOD

```typescript
// categories.routes.ts
import { generalLimiter } from "../../middleware/rateLimit";
router.use(generalLimiter);
```

### Missing Rate Limiters

```typescript
// settings.routes.ts - MISSING
router.use(requireAuth);
// Should add: router.use(generalLimiter);

// rules.routes.ts - MISSING
// Should add: router.use(generalLimiter);

// merchants.routes.ts - MISSING
// Should add: router.use(generalLimiter);
```

---

## Input Validation (10/10)

### Zod Schema Coverage

| Module | Schemas | Status |
|--------|---------|--------|
| Settings | 4 | PASS |
| Categories | 4 | PASS |
| Rules | 4 | PASS |
| Merchants | 3 | PASS |

### Password Validation

```typescript
// settings.controller.ts
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
```

**Validates:**
- Current password required
- New password minimum 8 chars
- Confirmation matches

---

## Compliance Checklist Status

| Control | Status | Notes |
|---------|--------|-------|
| Money class usage | N/A | Non-financial module |
| Audit logging | PARTIAL | Only Categories (1/4) |
| Transaction integrity | PARTIAL | Merchant merge at risk |
| Privacy controls | PASS | Proper scoping |
| Rate limiting | PARTIAL | Only Categories (1/4) |
| Input validation | PASS | Comprehensive Zod |

---

## Regulatory Compliance (Zambia DPA)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Audit trail | PARTIAL | Password changes not logged |
| Data subject access | PASS | Export endpoint exists |
| Data deletion | PASS | Account deletion endpoint |
| Consent tracking | N/A | Not applicable |

### DPA Concerns

1. **Password changes** - No audit log creates gap in security audit trail
2. **Session management** - Session revocation not logged
3. **Account deletion** - Not properly logged before soft delete

---

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Money Class Compliance | N/A | N/A | Non-financial module |
| Audit Logging | 15 | 25 | Only 1/4 modules covered |
| Transaction Integrity | 15 | 20 | Merchant merge at risk |
| Privacy Controls | 10 | 10 | Proper scoping |
| Rate Limiting | 5 | 10 | Only 1/4 modules |
| Input Validation | 10 | 10 | Comprehensive |
| Password Security | 10 | 15 | Proper hashing, min length |
| **TOTAL** | **65** | **90** | |

---

## Recommendations

### P0 (Critical - Compliance Risk)

1. **Add audit logging for password changes**
   ```typescript
   await businessAuditService.log({
     action: "PASSWORD_CHANGE",
     userId,
     householdId: null,
     entityType: "user",
     entityId: userId,
     ipAddress: businessAuditService.getIpAddress(req),
   });
   ```

2. **Add audit logging for account deletion**

3. **Add rate limiting to Settings, Rules, Merchants routes**

### P1 (High - Security Risk)

4. **Add audit logging for session management**
5. **Add audit logging for Rules CRUD**
6. **Add audit logging for Merchants CRUD**
7. **Wrap merchant merge in transaction**

### P2 (Nice to Have)

8. **Add logging for profile updates**
9. **Consider stronger password requirements**

---

## Verdict

**MEDIUM RISK** - The Settings module has significant compliance gaps with audit logging missing on security-sensitive operations (password changes, account deletion, session management). Only the Categories sub-module meets audit requirements. Rate limiting is also only present on Categories. These gaps create regulatory risk under Zambia DPA and should be addressed before production deployment. The Categories module can serve as a reference implementation for the other sub-modules.
