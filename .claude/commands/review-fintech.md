---
name: review-fintech
description: Fintech compliance review for financial accuracy and regulatory compliance. Use when auditing Money class usage (Rule 1), audit logging (Rule 9), transaction integrity (Rule 10), and privacy controls (Rule 11). Critical for financial modules like Goals, Investments, Recurring, Reports.
---

# Fintech Compliance Review

Review financial accuracy and CLAUDE.md Rules 1, 9, 10, 11 compliance.

## Context

$ARGUMENTS

## Process

1. Run Money class violation scans
2. Check audit logging coverage
3. Verify transaction integrity and privacy
4. Score and report

## CLAUDE.md Financial Rules Reference

| Rule | Requirement | Check Command |
|------|-------------|---------------|
| Rule 1 | Money class for all financial calculations | `rg -n "parseFloat\|Math\.round" <path>` |
| Rule 9 | Audit logging for all financial CRUD | `rg -n "businessAuditService" <path>` |
| Rule 10 | `withTransaction()` + `FOR UPDATE` for atomic ops | `rg -n "withTransaction\|for.*update" <path>` |
| Rule 11 | `findByIdWithVisibility()` for privacy | `rg -n "findByIdWithVisibility" <path>` |

## Scoring Rubric (100 Points)

| Category | Points | Criteria |
|----------|--------|----------|
| Money Class Compliance | 30 | No parseFloat/Math.round on amounts |
| Audit Logging | 25 | All CRUD operations logged |
| Transaction Integrity | 20 | Atomic operations, no race conditions |
| Privacy Controls | 15 | Visibility checks, no PII leaks |
| Currency Handling | 10 | Consistent currency context |

**Risk Level:**
- 90-100: LOW risk, compliant
- 70-89: MEDIUM risk, minor gaps
- 50-69: HIGH risk, significant gaps
- <50: CRITICAL risk, major compliance failures

## Fintech Review Checklist

### 1. Money Handling (CRITICAL - Rule 1)

- [ ] Uses `Money` class from `server/core/money.ts`
- [ ] NO `parseFloat()` on financial amounts
- [ ] NO `Math.round()` on financial amounts (except final display)
- [ ] NO `Number()` coercion on amounts
- [ ] Currency always specified from `goal.currency`, `account.currency`, `household.currency`
- [ ] Decimal precision preserved through calculations

**Common Antipatterns:**

```typescript
// BAD: Central utility using parseFloat
const numeric = parseFloat(String(amount || "0"));

// GOOD: Use Money class
const money = new Money(String(amount || "0"));

// BAD: Money → number → arithmetic
const value = new Money(x).toNumber();
const result = value + otherValue;

// GOOD: Keep Money through calculations
const result = money.add(new Money(otherValue));
```

### 2. Audit Trail (Rule 9 - Zambia DPA Compliance)

- [ ] All financial writes logged to `audit_logs`
- [ ] Uses `BusinessAuditService` methods:
  - `logCreate()` for POST
  - `logUpdate()` for PUT/PATCH
  - `logDelete()` for DELETE
  - `log()` with action for TRANSFER, LINK
- [ ] Includes: userId, householdId, entityType, entityId
- [ ] Includes: action (CREATE/UPDATE/DELETE/TRANSFER)
- [ ] Includes: IP address via `getIpAddress(req)`
- [ ] Changes are traceable and non-repudiable

**Entity Types:** `transaction`, `budget`, `goal`, `account`, `recurring_rule`, `holding`, `receipt`

### 3. Transaction Integrity (Rule 10)

- [ ] `withTransaction()` for multi-table operations
- [ ] `FOR UPDATE` locks for race-prone operations
- [ ] Account balances updated atomically
- [ ] Transfer operations use single transaction
- [ ] No partial state on failure (rollback)

**Race Condition Pattern:**

```typescript
// BAD: Read outside transaction, then write
const existing = await findDuplicate(goalId, transactionId);
if (existing) throw new ConflictError("Already linked");
await tx.insert(links).values(data);  // Race!

// GOOD: Lock inside transaction
return await withTransaction(async (tx) => {
  const [goal] = await tx
    .select().from(goals)
    .where(eq(goals.id, goalId))
    .for("update");  // Lock!
  // Now safe to check and insert
});
```

### 4. Data Privacy (Rule 11)

- [ ] Private transactions/goals only visible to owner
- [ ] Uses `findByIdWithVisibility(id, householdId, userId)`
- [ ] Cross-entity linking checks visibility
- [ ] No PII in logs or error messages
- [ ] Sensitive data not exposed in API responses

### 5. Currency Handling

- [ ] Multi-currency support where needed
- [ ] Currency conversion uses `FxRate` table
- [ ] Currency displayed with correct symbol/format
- [ ] No mixing currencies in calculations
- [ ] FX rate fallback logged (not silent)

### 6. Balance Integrity

- [ ] Holdings updated on BUY/SELL
- [ ] Overdraft validation before SELL
- [ ] Goal currentAmount updated on contribution
- [ ] Account balance reflects transaction sum

### 7. Regulatory Considerations

- [ ] Rate limiting prevents abuse (Rule 12)
- [ ] Consent tracking for data processing
- [ ] Data retention policies followed
- [ ] Export/deletion capabilities exist

### 8. Investment-Specific (if applicable)

- [ ] Holdings quantity updated on BUY/SELL
- [ ] SELL blocked if quantity > owned
- [ ] Cost basis calculations use Money class
- [ ] Unrealized vs realized gains distinguished

## Module-Specific Financial Checks

### Goals

- [ ] `targetAmount`, `currentAmount` use Money class
- [ ] Contribution adds to currentAmount correctly
- [ ] Transfer between goals maintains total
- [ ] Progress % calculated without precision loss

### Investments

- [ ] BUY increases holding quantity
- [ ] SELL decreases holding quantity
- [ ] SELL blocked if insufficient shares
- [ ] Portfolio valuation uses proper FX rates

### Recurring

- [ ] `amount` field uses Money class
- [ ] Monthly totals aggregated with Money
- [ ] Amount variance calculations accurate

### Reports

- [ ] All aggregations use Money class
- [ ] Currency conversions preserve precision
- [ ] Sankey totals match transaction sums

## Output Format

```markdown
## Module: [Name] Fintech Review
Score: XX/100 | Risk Level: LOW / MEDIUM / HIGH / CRITICAL

## Money Class Compliance

| File | Line | Violation | Fix |
|------|------|-----------|-----|
| file.ts | XX | parseFloat(amount) | new Money(amount) |

Total violations: X

## Audit Logging Coverage

| Endpoint | Method | Entity Type | Has Logging? |
|----------|--------|-------------|--------------|
| POST /x | Create | entity | OK/MISSING |

Coverage: X/Y endpoints (XX%)

## Transaction Integrity Issues

### INTEGRITY-001: [Description]

- **Location:** [file:line]
- **Risk:** Race condition / Partial state / etc.
- **Fix:** Use withTransaction() + FOR UPDATE

## Privacy Violations

### PRIVACY-001: [Description]

- **Location:** [file:line]
- **Issue:** [What's exposed]
- **Fix:** Use findByIdWithVisibility()

## Compliance Checklist Status

| Control | Status | Notes |
|---------|--------|-------|
| Money class usage | PASS/FAIL | X violations |
| Audit logging | PASS/FAIL | X% coverage |
| Transaction integrity | PASS/FAIL | X issues |
| Privacy controls | PASS/FAIL | X gaps |
| Rate limiting | PASS/FAIL | Applied to routes? |

## Recommendations

P0 (Critical - Compliance Risk):
1. [Issue]: [Fix]

P1 (High - Financial Risk):
1. [Issue]: [Fix]
```

## Instructions

1. Run violation scans:

   ```bash
   rg -n "parseFloat|Math\.round" <path>
   rg -n "businessAuditService" <path>
   rg -n "withTransaction" <path>
   rg -n "findByIdWithVisibility" <path>
   ```

2. Check audit logging in controller
3. Verify transaction wrappers in service
4. Review privacy in cross-entity operations
5. Score and report

## Quick Reference: Existing Assessments

| Module | Score | Key Fintech Issues |
|--------|-------|-------------------|
| CashFlow | 82/100 | Minor type docs |
| Recurring | 72/100 | Fixed: Money, privacy |
| Goals | 68/100 | Fixed: parseFloat, races |
| Reports | 52/100 | 130+ parseFloat (partial fix) |
| Investments | 45/100 | Fixed: holdings, overdraft |

Cross-reference: `docs/issues/KNOWN_ISSUES.md`
