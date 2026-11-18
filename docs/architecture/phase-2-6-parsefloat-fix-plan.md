# Phase 2.6: parseFloat to Money Class Migration Plan

**Status:** ✅ COMPLETE
**Created:** 2026-01-13
**Completed:** 2026-01-13
**Priority Files:** Goal services (highest financial risk)

## Summary

Replace `parseFloat()` calls with `Money` class for financial amounts to prevent floating-point precision errors.

## Categories

| Category | Action | Example |
|----------|--------|---------|
| **Money amounts** | MUST FIX | `currentAmount`, `targetAmount`, `monthlyPayment`, `amount` |
| **Interest rates** | KEEP parseFloat | `interestRate` - percentages, not currency |
| **Quantities** | KEEP parseFloat | `holding.quantity` - share counts |
| **Time calculations** | KEEP Math.round | Days/months remaining |

---

## File-by-File Fix Plan

### 1. goalCalculations.ts (4 instances) - HIGH PRIORITY

| Line | Current Code | Fix |
|------|--------------|-----|
| 17-18 | `parseFloat(String(goal.originalBalance))` | `new Money(goal.originalBalance).toNumber()` |
| 22 | `parseFloat(String(goal.targetAmount))` | `new Money(goal.targetAmount).toNumber()` |
| 31 | `parseFloat(String(goal.currentAmount))` | `new Money(goal.currentAmount).toNumber()` |

**Currency context:** `goal.currency` available via Goal type

---

### 2. goal/GoalQueryService.ts (9 instances) - HIGH PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| 146 | `parseFloat(String(goal.interestRate ?? 0))` | KEEP - interest rate percentage |
| 157 | `parseFloat(String(goal.oneTimePayment))` | FIX → `new Money(goal.oneTimePayment).toNumber()` |
| 192-193 | `parseFloat(String(goal.monthlyPayment...))` | FIX → `new Money(...).toNumber()` |
| 199 | `parseFloat(String(goal.currentAmount))` | FIX → `new Money(goal.currentAmount).toNumber()` |
| 204 | `parseFloat(String(goal.interestRate...))` | KEEP - interest rate percentage |
| 205-206 | `parseFloat(String(goal.oneTimePayment))` | FIX → `new Money(...).toNumber()` |
| 239 | `parseFloat(String(goal.monthlyProjection))` | FIX → `new Money(goal.monthlyProjection).toNumber()` |
| 351 | `parseFloat(String(activity.amount))` | FIX → `new Money(activity.amount).toNumber()` |

**Currency context:** `goal.currency` available

---

### 3. goal/GoalDebtService.ts (7 instances) - HIGH PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| 19 | `parseFloat(String(goal.currentAmount))` | FIX → `new Money(goal.currentAmount).toNumber()` |
| 20 | `parseFloat(String(goal.interestRate ?? 0))` | KEEP - interest rate |
| 39 | `parseFloat(String(goal.currentAmount))` | FIX → `new Money(goal.currentAmount).toNumber()` |
| 40 | `parseFloat(String(goal.interestRate ?? 0))` | KEEP - interest rate |
| 41 | `parseFloat(String(goal.minimumPayment ?? 0))` | FIX → `new Money(...).toNumber()` |
| 42 | `parseFloat(String(goal.monthlyPayment ?? 0))` | FIX → `new Money(...).toNumber()` |
| 43-44 | `parseFloat(String(goal.oneTimePayment))` | FIX → `new Money(...).toNumber()` |

**Currency context:** `goal.currency` available

---

### 4. goal/assignment.calculations.ts (5 instances) - MEDIUM PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| 147 | `parseFloat(holding.quantity ?? "0")` | KEEP - quantity, not money |
| 148 | `parseFloat(security.currentPrice ?? "0")` | FIX → `new Money(security.currentPrice).toNumber()` |
| 155 | `parseFloat(String(holding.acquisitionFxRate))` | KEEP - FX rate, not money |
| 175 | `parseFloat(String(goal.monthlyProjection))` | FIX → `new Money(...).toNumber()` |
| 178 | `parseFloat(update.monthlyProjection)` | FIX → `new Money(...).toNumber()` |

**Currency context:** `goal.currency`, `baseCurrency` parameter available

---

### 5. TransactionGoalLinkService.ts (5 instances) - MEDIUM PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| 41 | `parseFloat(data.amount)` | FIX → `new Money(data.amount).toNumber()` |
| 42 | `parseFloat(String(transaction.amount))` | FIX → `new Money(transaction.amount).toNumber()` |
| 75 | `parseFloat(String(goal.currentAmount))` | FIX → `new Money(goal.currentAmount).toNumber()` |
| 200 | `parseFloat(String(goal.currentAmount))` | FIX → `new Money(goal.currentAmount).toNumber()` |
| 201 | `parseFloat(String(link.amount))` | FIX → `new Money(link.amount).toNumber()` |

**Currency context:** `goal.currency`, `transaction.currency` (via account)

---

### 6. PatternDetectionService.ts (5 instances) - LOW PRIORITY

Non-critical for financial accuracy - pattern detection/ML thresholds.

---

### 7. notification/service.ts (3 instances) - LOW PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| 177-178 | `parseFloat(String(prefs.thresholdAmount))` | FIX - threshold is money |

---

### 8. rule/actions.ts (2 instances) - MEDIUM PRIORITY

| Line | Current Code | Action |
|------|--------------|--------|
| Various | parseFloat for rule condition amounts | FIX - rule amounts are money |

---

### 9. GoalTransferService.ts (4 instances) - MEDIUM PRIORITY

All instances are money amounts - should use Money class.

---

### 10. account/AccountReportingService.ts (3 instances) - LOW PRIORITY

Report aggregations - should use Money for accuracy.

---

## Implementation Order

1. **goalCalculations.ts** - Foundation used by all goal services
2. **goal/GoalDebtService.ts** - High-risk debt calculations
3. **goal/GoalQueryService.ts** - Frequently accessed
4. **TransactionGoalLinkService.ts** - Transaction linking
5. **goal/assignment.calculations.ts** - Assignment math
6. **Remaining files** - Lower priority

## Verification

After each file fix:
```bash
npm run check
npm run test:server:run
```

## Notes

- The `Money` class is already imported in most files
- Currency context is available via `goal.currency` or `account.currency`
- Interest rates (`interestRate`) and quantities (`holding.quantity`) should remain as parseFloat
- FX rates should remain as parseFloat (ratios, not currency amounts)
