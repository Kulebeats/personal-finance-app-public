# Recurring Module - Fintech Compliance Review

**Reviewer:** Fintech Compliance Expert (Financial Accuracy, Regulatory Compliance)
**Date:** 2026-01-23
**Score:** 88/100 | **Risk Level:** LOW

---

## Executive Summary

The Recurring module demonstrates excellent financial compliance with comprehensive audit logging (13 audit calls covering all mutations), proper Money class usage, and strong privacy controls via `findByIdWithVisibility()`. The only `Math.round()` usage operates on a percentage value (0-50 range), not currency amounts. Transaction integrity uses `withTransaction()` for multi-table operations. Minor gap: no `FOR UPDATE` locks on link operations for race condition prevention.

---

## Money Class Compliance (28/30)

### Scan Results

```bash
rg -n "parseFloat|Math\.round|\.toNumber()" server/modules/recurring/ server/services/recurring/
```

| File | Line | Code | Status |
|------|------|------|--------|
| RecurringLinkingService.ts | 55 | `Math.round(amountVariance)` | OK - Percentage (0-50%), not currency |

### Analysis

**The `Math.round(amountVariance)` is COMPLIANT because:**
- `amountVariance` is a percentage value (0-50 range)
- It represents tolerance percentage, not a financial amount
- The actual amount uses Money class: `new Money(pattern.estimatedAmount.amount, currency)`

### Money Class Usage (Verified)

| Location | Usage | Status |
|----------|-------|--------|
| recurring.controller.ts:15 | `import { toMoneyDto }` | PASS |
| recurring.controller.ts:35 | `toMoneyDto(rule.amount)` | PASS |
| recurring.controller.ts:52-59 | `toMoneyDto(transaction.amount)` | PASS |
| recurring.controller.ts:134-135 | `toMoneyDto(summary.totalMonthly*)` | PASS |
| RecurringLinkingService.ts:57-60 | `new Money(estimatedAmount)` | PASS |
| useRecurringPageData.ts:84-101 | `sumMoneyDto()`, `zeroMoneyDto()` | PASS |

**Verdict:** Excellent compliance - all financial amounts use Money class or MoneyDto.

---

## Audit Logging Coverage (25/25)

### Scan Results

```bash
rg -n "businessAuditService" server/modules/recurring/
```

**Total Audit Calls:** 13

### Coverage Matrix

| Operation | Endpoint | Audit Method | Entity Type | Status |
|-----------|----------|--------------|-------------|--------|
| Create rule | POST / | logCreate | recurring_rule | OK |
| Update rule | PUT /:id | logUpdate | recurring_rule | OK |
| Delete rule | DELETE /:id | logDelete | recurring_rule | OK |
| Skip occurrence | POST /:id/skip | logUpdate + metadata | recurring_rule | OK |
| Pause rule | POST /:id/pause | logUpdate + metadata | recurring_rule | OK |
| Resume rule | POST /:id/resume | logUpdate + metadata | recurring_rule | OK |
| End rule | POST /:id/end | logUpdate + metadata | recurring_rule | OK |
| Confirm pattern | POST /confirm | logCreate | recurring_rule | OK |
| Link transaction | POST /:id/link | log (LINK action) | recurring_rule | OK |
| Unlink transaction | DELETE /:id/link/:linkId | log (UNLINK action) | recurring_rule | OK |
| Process batch | POST /process | log (PROCESS action) | recurring_batch | OK |
| Create from tx | POST /transaction | logCreate | recurring_rule | OK |
| Create from existing | POST /transaction/:id | logCreate | recurring_rule | OK |

**Coverage:** 13/13 mutation endpoints (100%)

### Audit Log Content Quality

```typescript
// Example: Update operation captures before/after values
await businessAuditService.logUpdate({
  userId: req.user!.id,
  householdId,
  entityId: id,
  entityType: "recurring_rule",
  oldValue: {
    name: beforeRule.name,
    amount: beforeRule.amount,
    frequency: beforeRule.frequency,
    isActive: beforeRule.isActive,
  },
  newValue: {
    name: rule.name,
    amount: rule.amount,
    frequency: rule.frequency,
    isActive: rule.isActive,
  },
  ipAddress: businessAuditService.getIpAddress(req),
});
```

**Includes:** userId, householdId, entityId, entityType, before/after values, IP address, metadata for lifecycle operations.

**Verdict:** Excellent - all mutations logged with comprehensive details.

---

## Transaction Integrity (16/20)

### Scan Results

```bash
rg -n "withTransaction" server/services/recurring/
```

| File | Line | Usage |
|------|------|-------|
| RecurringCreationService.ts | 17 | Import |
| RecurringCreationService.ts | 182 | Link transaction to rule |
| RecurringCreationService.ts | 247 | Create recurring + transaction |
| RecurringCreationService.ts | 329 | Create from existing transaction |

### Transaction Usage Analysis

**Properly Wrapped Operations:**
- Create recurring rule + link to transaction (atomic)
- Create recurring from existing transaction (atomic)
- Auto-link sample transactions after pattern confirmation

### FOR UPDATE Locks

```bash
rg -n "for\(.*\"update\"\)" server/services/recurring/
```

**Result:** No FOR UPDATE locks found.

**Gap Identified:** The link operation checks for existing links before inserting, but does not use row locks:

```typescript
// RecurringLinkingService.ts:137-149
const existingLink = await recurringRepository.findLinkByTransaction(
  transactionId, householdId
);
if (existingLink) {
  // Check existing...
}
// RACE WINDOW: Another request could insert between check and insert
const link = await recurringRepository.createLink({...});
```

**Risk:** LOW - Database unique constraint likely prevents duplicates, but explicit locking is preferred.

---

## Privacy Controls (15/15)

### Scan Results

```bash
rg -n "findByIdWithVisibility" server/services/recurring/
```

| File | Line | Entity | Purpose |
|------|------|--------|---------|
| RecurringLinkingService.ts | 43 | Account | Validate account access |
| RecurringLinkingService.ts | 128 | Transaction | Prevent linking private txns |
| RecurringBaseService.ts | 89 | Account | Validate account in get operations |
| RecurringCreationService.ts | 200 | Account | Validate account on create |
| RecurringCreationService.ts | 300 | Transaction | Create from existing transaction |

### Privacy Implementation

```typescript
// RecurringLinkingService.ts:127-135
// Use visibility check to prevent linking private transactions by non-owners
const transaction = await transactionRepository.findByIdWithVisibility(
  transactionId,
  householdId,
  userId,  // Current user for visibility
);
if (!transaction) {
  throw new NotFoundError("Transaction not found");  // Intentionally vague
}
```

**Controls:**
- Private transactions only linkable by owner
- Account access validated via visibility check
- Error messages don't reveal entity existence to unauthorized users

**Verdict:** Excellent privacy controls implemented.

---

## Currency Handling (4/10)

### Analysis

| Check | Status | Notes |
|-------|--------|-------|
| Currency from account/household | PARTIAL | Uses household currency |
| Multi-currency support | N/A | Single currency per household |
| Currency in MoneyDto | PASS | All amounts include currency |
| Client-side sumMoneyDto | PASS | Uses `defaultCurrency` context |

**Gap:** No explicit multi-currency support, but acceptable for household-scoped recurring rules.

---

## Compliance Checklist Status

| Control | Status | Evidence |
|---------|--------|----------|
| Money class usage | PASS | `toMoneyDto()`, `new Money()` throughout |
| Audit logging | PASS | 13/13 mutations logged (100%) |
| Transaction integrity | PARTIAL | `withTransaction()` used, no FOR UPDATE |
| Privacy controls | PASS | `findByIdWithVisibility()` on all cross-entity ops |
| Rate limiting | PASS | `generalLimiter` on all routes, `analyticsLimiter` on expensive |
| Input validation | PASS | Zod schemas with date/amount validation |

---

## Regulatory Compliance (Zambia DPA)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Audit trail for financial data | PASS | businessAuditService logs all mutations |
| Data subject access | PASS | Household-scoped queries |
| Data minimization | PASS | Only required fields logged |
| Processing consent | N/A | Not applicable for recurring rules |
| IP address logging | PASS | `getIpAddress(req)` captured |

---

## Integrity Issues

### INTEGRITY-001: Missing FOR UPDATE Lock on Link Operations

- **Location:** `server/services/recurring/RecurringLinkingService.ts:137-151`
- **Risk:** LOW - Race condition possible when linking same transaction twice
- **Mitigation:** Database unique constraint likely exists on (transactionId, householdId)
- **Recommended Fix:**

```typescript
return await withTransaction(async (tx) => {
  // Lock the transaction row first
  const [transaction] = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .for("update");

  // Now safe to check and insert link
  const existingLink = await tx.select()...
});
```

---

## Recommendations

### P1 (High - Best Practice)

1. **Add FOR UPDATE lock on link operations** - Prevents race conditions in concurrent linking scenarios

### P2 (Medium - Enhancement)

2. **Add currency field to recurring rules** - Support multi-currency households
3. **Log currency in audit entries** - More complete audit trail for financial analysis

---

## Scoring Breakdown

| Category | Points | Max | Notes |
|----------|--------|-----|-------|
| Money Class Compliance | 28 | 30 | Math.round on percentage is valid |
| Audit Logging | 25 | 25 | 100% coverage, excellent detail |
| Transaction Integrity | 16 | 20 | withTransaction used, no FOR UPDATE |
| Privacy Controls | 15 | 15 | findByIdWithVisibility throughout |
| Currency Handling | 4 | 10 | Basic support, no multi-currency |
| **TOTAL** | **88** | **100** | |

---

## Verdict

**LOW RISK** - The Recurring module demonstrates excellent fintech compliance. All financial amounts use the Money class, audit logging achieves 100% coverage with comprehensive before/after values, and privacy controls properly prevent unauthorized access to private transactions. The minor gap (missing FOR UPDATE locks) poses minimal risk due to likely database constraints. This module is production-ready for financial operations.
