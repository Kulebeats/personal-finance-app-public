# Deep Dive: Money Class Violations - Top Offender Modules

**Generated:** 2026-01-30
**Scope:** Top 5 modules by `toNumber()` usage + critical P1 issues
**Total violations analyzed:** 57 `toNumber()` calls, 2 `Math.round()`, 2 `parseFloat()` in goals/portfolio modules

---

## Executive Summary

### Critical Findings (P1 - Immediate Fix Required)

1. **Goal Transfer Persistence Drift** ([GoalTransferService.ts:55-56](../../server/services/GoalTransferService.ts#L55-L56), [goalCalculations.ts:206](../../server/services/goalCalculations.ts#L206))
   - **Impact:** HIGH - Introduces rounding drift in goal balances over time
   - **Root cause:** `Money.toNumber()` → `toFixed(2)` → database persistence
   - **Affected operations:** All goal transfers, manual adjustments, transaction links
   - **Risk:** Cumulative precision loss in high-frequency transfers

2. **Portfolio Valuation Arithmetic** ([PortfolioValuationService.ts:49, 90](../../server/services/PortfolioValuationService.ts#L49))
   - **Impact:** MEDIUM-HIGH - Incorrect portfolio valuations and gain/loss calculations
   - **Root cause:** `Money → toNumber() → multiply()` breaks precision guarantees
   - **Affected operations:** Holdings valuation, FX conversions, performance metrics
   - **Risk:** Incorrect investment reporting, tax calculation errors

### Pattern Categories

| Pattern | Count | Risk Level | Fix Complexity |
|---------|-------|------------|----------------|
| **toNumber() before persistence** | 3 | P1 - Critical | Medium |
| **toNumber() in arithmetic** | 12 | P1 - High | Medium |
| **toNumber() for display only** | 42 | P2 - Low | Low |
| **Math.round() on financial data** | 2 | P2 - Medium | Low |
| **parseFloat() in goal calculations** | 2 | P2 - Medium | Low |

---

## Module-by-Module Analysis

### 1. GoalTransferService.ts (10 violations)

**File:** [server/services/GoalTransferService.ts](../../server/services/GoalTransferService.ts)

#### P1 - Critical: Precision Loss Before Persistence

**Lines 55-56:**
```typescript
// ❌ CRITICAL BUG: Money → toNumber() → buildGoalBalanceUpdate → toFixed(2) → DB
const fromUpdate = buildGoalBalanceUpdate(fromGoal, finalFromBalanceMoney.toNumber());
const toUpdate = buildGoalBalanceUpdate(toGoal, newToBalanceMoney.toNumber());
```

**Propagates to goalCalculations.ts:206:**
```typescript
currentAmount: newBalance.toFixed(2),  // Stores rounded value
```

**Impact:**
- Every transfer converts `Money → number → toFixed(2) → string`
- Example precision loss:
  - Transfer 1: 100.00 - 33.33 = 66.67 (exact in Money: 66.666...)
  - Transfer 2: 66.67 - 33.33 = 33.34 (exact: 33.336...)
  - After 3 transfers: 0.01 drift per cycle
  - 100 transfers = **1.00 currency unit drift**

**Fix Strategy:**
```typescript
// ✅ GOOD: Pass Money objects to buildGoalBalanceUpdate
const fromUpdate = buildGoalBalanceUpdate(fromGoal, finalFromBalanceMoney);
const toUpdate = buildGoalBalanceUpdate(toGoal, newToBalanceMoney);

// Update buildGoalBalanceUpdate signature to accept Money | number
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money | number
): { ... } {
  const balanceMoney = newBalance instanceof Money
    ? newBalance
    : new Money(newBalance);

  return {
    currentAmount: balanceMoney.toString(),  // Preserves precision
    // ...
  };
}
```

**Effort:** Medium (requires signature change + 5 call sites updated)
**Verification:** Unit tests for repeated transfers with fractional amounts

---

#### P2 - Safe: Display-only conversions

**Lines 103-120:** Activity logging (Safe - only for audit logs, not persisted balances)
```typescript
amount: transferAmount.toNumber(),  // Safe - display only
previousBalance: fromBalanceMoney.toNumber(),  // Safe - snapshot
newBalance: finalFromBalanceMoney.toNumber(),  // Safe - snapshot
```

**Analysis:** These `toNumber()` calls are acceptable because:
1. Activity log amounts are snapshots for display
2. Not used in further calculations
3. Not persisted as source-of-truth balances

---

### 2. goalCalculations.ts (P1 - Persistence Entry Point)

**File:** [server/services/goalCalculations.ts](../../server/services/goalCalculations.ts)

#### P1 - Critical: toFixed(2) Bottleneck

**Lines 184-214: `buildGoalBalanceUpdate()`**
```typescript
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: number  // ❌ Receives number from toNumber()
): {
  currentAmount: string;  // Returns string for DB
  // ...
} {
  return {
    currentAmount: newBalance.toFixed(2),  // ❌ PRECISION LOSS HERE
    monthlyProjection: monthlyProjection?.toFixed(2) ?? null,
    // ...
  };
}
```

**Impact:**
- **Single point of failure** for all goal balance updates
- Used by:
  - GoalTransferService (transfers)
  - GoalCrudService (manual adjustments)
  - TransactionGoalLinkService (transaction links)
- Converts `Money → number → toFixed(2)` at every write

**Fix (Option A - Preferred):**
```typescript
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money  // Accept Money directly
): {
  currentAmount: string;
  // ...
} {
  const status = calculateStatus(goal, newBalance.toNumber());  // Only for logic
  const monthlyProjection = calculateMonthlyProjection(goal, newBalance.toNumber());

  return {
    currentAmount: newBalance.toString(),  // ✅ Preserves precision
    monthlyProjection: monthlyProjection
      ? new Money(monthlyProjection).toString()
      : null,
    // ...
  };
}
```

**Fix (Option B - Backward Compatible):**
```typescript
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money | number  // Accept both
): {
  currentAmount: string;
  // ...
} {
  const balanceMoney = newBalance instanceof Money
    ? newBalance
    : new Money(String(newBalance));

  return {
    currentAmount: balanceMoney.toString(),
    // ...
  };
}
```

**Effort:** Medium (signature change + 8 call sites)
**Verification:** Integration tests comparing Money vs number paths

---

#### P2 - Low Risk: Helper functions using toNumber()

**Lines 15-53:** Getter helpers (Safe - used for logic, not persistence)
```typescript
export function getGoalTargetAmount(goal: Goal): number {
  const val = new Money(goal.targetAmount).toNumber();
  return Number.isFinite(val) ? Math.max(0, val) : 0;
}
```

**Analysis:** Acceptable because:
- Used for comparison logic, not persistence
- Returns sanitized numbers for calculations
- Called by status/projection functions (read-only paths)

---

### 3. PortfolioValuationService.ts (15 violations)

**File:** [server/services/PortfolioValuationService.ts](../../server/services/PortfolioValuationService.ts)

#### P1 - High: Arithmetic Before Precision Loss

**Line 49:**
```typescript
// ❌ BAD: Money → toNumber() → multiply() defeats Money class
const currentValueLocal = quantity.multiply(currentPrice.toNumber());
```

**Analysis:**
- `quantity` is Money (line 47)
- `currentPrice` is Money (line 48)
- But `quantity.multiply(currentPrice.toNumber())` converts price to number **before** multiply
- This defeats the purpose of using `Money.multiply()` for precision

**Correct implementation:**
```typescript
// ✅ GOOD: Keep Money through calculation
const currentValueLocal = quantity.multiply(currentPrice);
// or if multiply() doesn't accept Money:
const currentValueLocal = quantity.multiply(currentPrice.toFullString());
```

---

**Lines 89-91: Percentage calculation**
```typescript
const gainLossPercent =
  costBasisBase.toNumber() > 0
    ? (gainLoss.toNumber() / costBasisBase.toNumber()) * 100  // ❌ toNumber before divide
    : 0;
```

**Fix:**
```typescript
// ✅ GOOD: Use Money.divide() for precision
const gainLossPercent = costBasisBase.isZero()
  ? 0
  : gainLoss.divide(costBasisBase.toFullString()).multiply(100).toNumber();
```

---

**Lines 97-101: Return values (P2 - Acceptable)**
```typescript
return {
  currentValueLocal: currentValueLocal.toNumber(),  // Safe - final output
  currentValueBase: currentValueBase.toNumber(),
  costBasisBase: costBasisBase.toNumber(),
  gainLoss: gainLoss.toNumber(),
  gainLossPercent,
};
```

**Analysis:** These are acceptable because:
- Return values for external API (HoldingMetrics interface expects numbers)
- All calculations completed in Money before conversion
- Not used in further arithmetic

---

**Lines 170-184: Aggregation return (P2 - Acceptable)**
```typescript
return {
  totalValue: totalValue.toNumber(),
  totalCostBasis: totalCostBasis.toNumber(),
  totalGainLoss: totalGainLoss.toNumber(),
  totalGainLossPercent,
  byType: byTypeNumbers,
  holdingsCount: allHoldings.length,
};
```

**Analysis:** Safe - final API boundary conversion after all Money calculations

---

### 4. weekly-recap.service.ts (11 toNumber(), 2 Math.round)

**File:** [server/modules/weekly-recap/weekly-recap.service.ts](../../server/modules/weekly-recap/weekly-recap.service.ts)

#### P2 - Medium: Math.round on financial percentages

**Lines 143, 161:**
```typescript
changePercent: Math.round(netWorthChangePercent * 100) / 100,  // ❌ Math.round
changePercent: Math.round(spendingChangePercent * 100) / 100,  // ❌ Math.round
```

**Impact:** Low (percentages, not currency amounts)
**Fix:**
```typescript
// ✅ GOOD: Use toFixed for rounding
changePercent: Number(netWorthChangePercent.toFixed(2)),
```

---

#### P2 - Safe: Display conversions

**Lines 124-199:** All other `toNumber()` calls
```typescript
const changeNum = netWorthChange.toNumber();  // Line 124 - Safe (display calc)
value: toMoney(d.y).toNumber(),  // Line 199 - Safe (chart data)
amount: toMoney(item.value).toNumber(),  // Line 255 - Safe (UI display)
```

**Analysis:** All are final conversions for UI/API response, not used in further calculations

---

### 5. AccountReportingService.ts (11 violations)

**File:** [server/services/account/AccountReportingService.ts](../../server/services/account/AccountReportingService.ts)

#### All P2 - Safe (API boundary conversions)

**Lines 105-107, 189-191, 340-342, 386, 393:**
```typescript
return {
  totalAssets: totalAssets.toNumber(),  // Safe - final API response
  totalLiabilities: totalLiabilities.toNumber(),
  netWorth: totalAssets.subtract(totalLiabilities).toNumber(),
  currency: baseCurrency,
};
```

**Analysis:** All `toNumber()` calls are:
1. At API response boundary (return statements)
2. After all Money calculations completed
3. Not used in further arithmetic
4. **Safe and acceptable**

---

### 6. GoalQueryService.ts (10 violations)

**File:** [server/services/goal/GoalQueryService.ts](../../server/services/goal/GoalQueryService.ts)

#### P2 - Low Risk: Mixed safe/unsafe patterns

**Line 34:** Safe (comparison after calculation)
```typescript
const remaining = remainingMoney.isNegative() ? 0 : remainingMoney.toNumber();
```

**Lines 118-122:** Unsafe (toNumber before arithmetic)
```typescript
// ❌ BAD: toNumber before divide
const overallProgress = saveUpTotalTarget.isZero()
  ? 0
  : Math.round(
      saveUpTotalSaved
        .divide(saveUpTotalTarget.toFullString())  // ✅ GOOD: divide keeps Money
        .multiply(100)
        .toNumber()  // ✅ GOOD: toNumber at the end
    );
```

**Analysis:** Actually SAFE - despite using `toNumber()`, it's called after all Money operations

**Lines 145-217:** Safe (debtPayoffCalculator boundary)
```typescript
const scenario = debtPayoffCalculator.calculatePayoff(
  balanceMoney.toNumber(),  // Safe - legacy API boundary
  apr,
  monthlyPaymentMoney.toNumber(),
  oneTimePaymentMoney.toNumber()
);
```

**Analysis:** Safe - converting to number for external API (debtPayoffCalculator)

**Lines 319-355:** Safe (final return values)
```typescript
totalSaved: Number(saveUpTotalSaved.toString()),  // Safe - API response
amount: activity.amount ? new Money(activity.amount).toNumber() : 0,
```

---

## Summary by Risk Level

### P1 - Critical (Fix Immediately)

| Issue | Location | Impact | Fix Effort |
|-------|----------|--------|------------|
| Goal transfer persistence drift | [GoalTransferService.ts:55-56](../../server/services/GoalTransferService.ts#L55-L56) | High - cumulative precision loss | Medium |
| buildGoalBalanceUpdate toFixed(2) | [goalCalculations.ts:206](../../server/services/goalCalculations.ts#L206) | High - single point of failure | Medium |
| Portfolio multiply with toNumber | [PortfolioValuationService.ts:49](../../server/services/PortfolioValuationService.ts#L49) | Medium - incorrect valuations | Low |
| Portfolio percentage calc | [PortfolioValuationService.ts:90](../../server/services/PortfolioValuationService.ts#L90) | Medium - incorrect gain/loss % | Low |

**Total P1 violations:** 4
**Estimated fix time:** 4-6 hours (with tests)

---

### P2 - Medium (Plan for next sprint)

| Issue | Location | Count | Risk |
|-------|----------|-------|------|
| Math.round on percentages | weekly-recap.service.ts | 2 | Low - percentages only |
| toNumber for chart data | weekly-recap.service.ts | 9 | None - display only |
| toNumber for API responses | AccountReportingService.ts | 11 | None - boundary conversions |
| toNumber for UI display | GoalQueryService.ts | 10 | None - read-only paths |

**Total P2 violations:** 32 (safe patterns)
**Action:** Document as acceptable use cases

---

### P3 - Safe (No action required)

All remaining `toNumber()` calls (42 total) are at API boundaries or for display/logging only.

**Criteria for "safe":**
1. Final return value (not used in further calculations)
2. Display/UI data (charts, tables)
3. Audit logs (snapshots)
4. External API boundaries (debtPayoffCalculator, logger)

---

## Recommended Fix Order

### Phase 1 (This sprint - 4-6 hours)
1. ✅ Fix `buildGoalBalanceUpdate()` to accept Money
2. ✅ Update 3 call sites: GoalTransferService, GoalCrudService, TransactionGoalLinkService
3. ✅ Fix PortfolioValuationService arithmetic (lines 49, 90)
4. ✅ Add unit tests for precision preservation

### Phase 2 (Next sprint - 2 hours)
1. Replace `Math.round()` with `toFixed()` in weekly-recap.service.ts
2. Document safe `toNumber()` patterns in CLAUDE.md
3. Add linting rule for `toNumber()` before arithmetic

### Phase 3 (Technical debt)
1. Create Money-aware TypeScript lint rule
2. Add pre-commit hook to detect new violations
3. Update developer guidelines with examples

---

## Testing Strategy

### Unit Tests Required

```typescript
describe('Goal Transfer Precision', () => {
  it('should preserve precision after 100 transfers', () => {
    // Transfer 33.33 repeatedly, verify no drift
  });

  it('should match Money calculation vs toFixed(2)', () => {
    // Compare old vs new implementation
  });
});

describe('Portfolio Valuation Precision', () => {
  it('should calculate holdings value without precision loss', () => {
    // Test quantity * price with fractional values
  });
});
```

### Integration Tests Required

```typescript
describe('Goal Transfers E2E', () => {
  it('should maintain balance integrity across 1000 transfers', async () => {
    // High-frequency transfer simulation
  });
});
```

---

## Appendix: Grep Results

```bash
# Top offenders (production code only)
rg -n "toNumber\(\)" server --type ts | grep -v test | wc -l
# 174 matches

# By file (top 5):
# PortfolioValuationService.ts: 15
# weekly-recap.service.ts: 11
# AccountReportingService.ts: 11
# GoalQueryService.ts: 10
# GoalTransferService.ts: 10
```

---

**Next Step:** Proceed to Phase 2 (Full Remediation Plan)
