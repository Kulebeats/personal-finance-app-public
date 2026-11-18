# Money Class Violations - Full Remediation Plan

**Created:** 2026-01-30
**Status:** Planning Phase
**Target Completion:** Sprint 2026-02 (2 weeks)

**Related Documents:**
- Phase 1 Report: User-provided audit results
- Deep Dive: [docs/reviews/deep-dive-money-class-violations.md](../reviews/deep-dive-money-class-violations.md)
- CLAUDE.md Rule 1: Money/Arithmetic Rule

---

## Executive Summary

**Total violations found:** 303 instances across 4 patterns
- `toNumber()`: 174 (57 analyzed, 4 critical)
- `Math.round()`: 55 (2 on financial data)
- `parseFloat()`: 52 (10 in receipt parser)
- `as any`: 22 (2 in financial modules)

**Priority breakdown:**
- **P0 (Immediate):** 4 violations - Goal persistence, portfolio arithmetic
- **P1 (Sprint 1):** 12 violations - Financial calculations before toNumber()
- **P2 (Sprint 2):** 45 violations - Math.round, parseFloat in non-critical paths
- **P3 (Document):** 242 violations - Safe patterns at API boundaries

**Estimated effort:** 24-32 developer hours over 2 sprints

---

## Remediation Strategy

### Phase 1: Critical Fixes (Week 1 - 12 hours)

**Objective:** Eliminate P0 violations causing precision loss in persisted data

#### Task 1.1: Fix Goal Transfer Persistence [P0]
**Files affected:**
- [server/services/GoalTransferService.ts](../../server/services/GoalTransferService.ts#L55-L56)
- [server/services/goalCalculations.ts](../../server/services/goalCalculations.ts#L184-L214)
- [server/services/goal/GoalMutationService.ts](../../server/services/goal/GoalMutationService.ts) (call site)
- [server/services/TransactionGoalLinkService.ts](../../server/services/TransactionGoalLinkService.ts) (call site)

**Changes:**
```typescript
// BEFORE
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: number
): { currentAmount: string; ... } {
  return {
    currentAmount: newBalance.toFixed(2),  // ❌ Precision loss
  };
}

// AFTER
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money | number
): { currentAmount: string; ... } {
  const balanceMoney = newBalance instanceof Money
    ? newBalance
    : new Money(String(newBalance));

  return {
    currentAmount: balanceMoney.toString(),  // ✅ Preserves precision
    monthlyProjection: monthlyProjection
      ? new Money(String(monthlyProjection)).toString()
      : null,
  };
}

// Update call sites
const fromUpdate = buildGoalBalanceUpdate(fromGoal, finalFromBalanceMoney);  // Pass Money
const toUpdate = buildGoalBalanceUpdate(toGoal, newToBalanceMoney);
```

**Testing requirements:**
- Unit test: 100 repeated transfers with 33.33 amounts (verify no drift)
- Integration test: Goal transfer → read balance → verify precision
- Regression test: All existing goal transfer tests pass

**Acceptance criteria:**
- [ ] `buildGoalBalanceUpdate()` accepts Money or number
- [ ] All 5 call sites updated (GoalTransferService, GoalCrudService, TransactionGoalLinkService, tests)
- [ ] Precision test passes (100 transfers, <0.01 drift)
- [ ] No regressions in existing tests

**Estimated effort:** 4 hours

---

#### Task 1.2: Fix Portfolio Valuation Arithmetic [P0]
**Files affected:**
- [server/services/PortfolioValuationService.ts](../../server/services/PortfolioValuationService.ts#L49)
- [server/services/PortfolioValuationService.ts](../../server/services/PortfolioValuationService.ts#L89-L91)

**Changes:**
```typescript
// BEFORE (line 49)
const currentValueLocal = quantity.multiply(currentPrice.toNumber());  // ❌

// AFTER
const currentValueLocal = quantity.multiply(currentPrice);  // ✅
// OR if multiply() doesn't accept Money:
const currentValueLocal = quantity.multiply(currentPrice.toFullString());

// BEFORE (lines 89-91)
const gainLossPercent =
  costBasisBase.toNumber() > 0
    ? (gainLoss.toNumber() / costBasisBase.toNumber()) * 100  // ❌
    : 0;

// AFTER
const gainLossPercent = costBasisBase.isZero()
  ? 0
  : gainLoss
      .divide(costBasisBase.toFullString())
      .multiply(100)
      .toNumber();  // ✅
```

**Testing requirements:**
- Unit test: Holdings value with fractional prices (e.g., 123.456 * 0.789)
- Unit test: Gain/loss percentage with edge values (small basis, large gain)
- Integration test: Full portfolio valuation matches manual Money calculation

**Acceptance criteria:**
- [ ] `computeHoldingMetrics()` uses Money for all arithmetic
- [ ] Percentage calculation uses Money.divide()
- [ ] No toNumber() before arithmetic operations
- [ ] Precision tests pass (compare Money vs toNumber paths)

**Estimated effort:** 3 hours

---

#### Task 1.3: Fix AI Audit Log Type Safety [P0]
**Files affected:**
- [server/modules/ai/ai.service.ts](../../server/modules/ai/ai.service.ts#L149)
- [server/modules/ai/ai.service.ts](../../server/modules/ai/ai.service.ts#L220)
- [shared/schema.ts](../../shared/schema.ts) (audit log enum)

**Changes:**
```typescript
// BEFORE
await businessAuditService.log({
  entityType: 'ai_query' as any,  // ❌ Type bypass
  // ...
});

// AFTER
// 1. Add to audit log enum in schema.ts
export const auditLogEntityTypes = [
  // ... existing types
  'ai_query',
  'ai_conversation',
] as const;

// 2. Remove 'as any' in ai.service.ts
await businessAuditService.log({
  entityType: 'ai_query',  // ✅ Type-safe
  // ...
});
```

**Testing requirements:**
- TypeScript compilation passes
- Audit log accepts 'ai_query' without cast
- Integration test: AI query creates audit log entry

**Acceptance criteria:**
- [ ] `ai_query` added to schema enum
- [ ] Both `as any` casts removed (lines 149, 220)
- [ ] TypeScript check passes
- [ ] AI integration tests pass

**Estimated effort:** 1 hour

---

#### Task 1.4: Remove Dead Calculation Logger [P0]
**Files affected:**
- [server/utils/logger.ts](../../server/utils/logger.ts#L78-L110)

**Changes:**
```bash
# Search for usage
rg -n "calculationLogger\|logCalculation" server/

# If no usage found, delete the entire calculation logging section
# Lines 78-110 in logger.ts
```

**Decision tree:**
1. If **no usage found** → Delete code (4 lines changed)
2. If **usage found** → Rewrite with Drizzle schema (8 hours of work)

**Acceptance criteria:**
- [ ] Usage search completed
- [ ] If unused: Code deleted, tests pass
- [ ] If used: Drizzle schema created, implementation updated

**Estimated effort:** 1 hour (assuming unused) or 8 hours (if used)

---

### Phase 2: High-Priority Fixes (Week 1-2 - 12 hours)

**Objective:** Fix remaining financial arithmetic violations

#### Task 2.1: Fix Receipt Parser parseFloat [P1]
**Files affected:**
- [server/services/receiptParser.ts](../../server/services/receiptParser.ts) (10 instances)

**Pattern to fix:**
```typescript
// BEFORE
const amount = parseFloat(ocrText.match(/\d+\.\d+/)?.[0] || "0");  // ❌

// AFTER
const amountStr = ocrText.match(/\d+\.\d+/)?.[0] || "0";
const amount = new Money(amountStr);  // ✅ Returns Money object

// For final output (if number required by external API):
const amountForApi = amount.toNumber();  // Only at API boundary
```

**Testing requirements:**
- Unit test: Parse receipt with fractional amounts (e.g., "12.99")
- Unit test: Parse receipt with no decimal (e.g., "12")
- Unit test: Parse malformed OCR text (e.g., "12..99")

**Acceptance criteria:**
- [ ] All 10 `parseFloat()` calls replaced with Money
- [ ] toNumber() only at OCR service boundary (if required)
- [ ] Receipt parsing tests pass
- [ ] No precision loss in amount extraction

**Estimated effort:** 3 hours

---

#### Task 2.2: Fix Math.round on Financial Data [P1]
**Files affected:**
- [server/modules/weekly-recap/weekly-recap.service.ts](../../server/modules/weekly-recap/weekly-recap.service.ts#L143)
- [server/modules/weekly-recap/weekly-recap.service.ts](../../server/modules/weekly-recap/weekly-recap.service.ts#L161)
- [server/services/PatternDetectionService.ts](../../server/services/PatternDetectionService.ts) (4 instances)
- Other files with Math.round (51 total - need grep to identify)

**Pattern to fix:**
```typescript
// BEFORE
changePercent: Math.round(netWorthChangePercent * 100) / 100,  // ❌

// AFTER
changePercent: Number(netWorthChangePercent.toFixed(2)),  // ✅
```

**Grep command to find all:**
```bash
rg -n "Math\.round" server/ --type ts -g "!*.test.ts" -g "!__tests__"
```

**Prioritization:**
1. Fix Math.round on currency amounts (P1 - HIGH)
2. Fix Math.round on percentages (P2 - MEDIUM)
3. Document Math.round on non-financial data (P3 - LOW)

**Testing requirements:**
- Unit test: Percentage rounding matches toFixed(2)
- Regression test: Weekly recap data unchanged

**Acceptance criteria:**
- [ ] All Math.round on currency/percentages replaced
- [ ] toFixed(2) used for rounding
- [ ] Tests verify rounding behavior

**Estimated effort:** 4 hours

---

#### Task 2.3: Fix Client-Side parseFloat [P1]
**Files affected:**
- [client/src/features/transactions/components/SplitTransactionModal.tsx](../../client/src/features/transactions/components/SplitTransactionModal.tsx) (3 instances)
- [client/src/components/transactions/FiltersAmountPanel.tsx](../../client/src/components/transactions/FiltersAmountPanel.tsx) (2 instances)
- Other client files (37 total - need grep)

**Pattern to fix:**
```typescript
// BEFORE (client-side)
const amount = parseFloat(input.value);  // ❌

// AFTER
// Option 1: Use native input validation
<input type="number" step="0.01" />

// Option 2: Manual validation with regex
const amountStr = input.value.trim();
if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
  throw new Error("Invalid amount format");
}
const amount = amountStr;  // Keep as string, send to API

// API validates with Money class on backend
```

**Note:** Client-side is lower priority because backend validates with Money class. But parseFloat can cause UX issues (silent precision loss).

**Acceptance criteria:**
- [ ] Client inputs use type="number" or regex validation
- [ ] parseFloat only at display boundary (toLocaleString)
- [ ] Amount sent to API as string (not pre-converted to number)

**Estimated effort:** 3 hours

---

#### Task 2.4: Fix 'as any' Type Bypasses [P1]
**Files affected:**
- [server/modules/ai/ai.service.ts](../../server/modules/ai/ai.service.ts#L149) (covered in 1.3)
- [server/utils/logger.ts](../../server/utils/logger.ts#L78) (covered in 1.4)
- [client/src/lib/api.ts](../../client/src/lib/api.ts) (3 instances)
- [client/src/features/reports/components/CashFlowSection.tsx](../../client/src/features/reports/components/CashFlowSection.tsx) (2 instances)
- [server/middleware/sessionSanity.ts](../../server/middleware/sessionSanity.ts) (2 instances)

**Grep to find all:**
```bash
rg -n "\\bas any\\b" server client shared --type ts -g "!*.test.ts"
```

**Pattern to fix:**
```typescript
// BEFORE
const data = result.data as any;  // ❌

// AFTER
// Option 1: Define proper type
interface ExpectedResponseType {
  id: string;
  amount: MoneyDto;
}
const data = result.data as ExpectedResponseType;

// Option 2: Use Zod for runtime validation
const dataSchema = z.object({
  id: z.string(),
  amount: moneyDtoSchema,
});
const data = dataSchema.parse(result.data);
```

**Acceptance criteria:**
- [ ] All `as any` replaced with proper types or Zod schemas
- [ ] TypeScript strict mode passes
- [ ] No runtime type errors in tests

**Estimated effort:** 4 hours

---

### Phase 3: Documentation & Enforcement (Week 2 - 8 hours)

**Objective:** Prevent future violations through tooling and documentation

#### Task 3.1: Update CLAUDE.md with Safe Patterns
**File:** [CLAUDE.md](../../CLAUDE.md)

**Additions to Rule 1:**
```markdown
### 1. Money/Arithmetic Rule (HIGH RISK)

**NEVER use `parseFloat()`, `Math.round()`, or `Number()` for financial calculations.**

... (existing content)

**When toNumber() IS safe:**
- ✅ Final API response (after all Money calculations)
  ```typescript
  return { total: totalMoney.toNumber() };  // Safe - API boundary
  ```
- ✅ Display/UI data (charts, tables)
  ```typescript
  series.map(s => ({ value: s.amount.toNumber() }));  // Safe - chart data
  ```
- ✅ External API boundaries (legacy APIs requiring numbers)
  ```typescript
  legacyApi.calculate(amount.toNumber());  // Safe - external boundary
  ```
- ✅ Logging/audit snapshots (not used in further calculations)
  ```typescript
  logger.info({ amount: money.toNumber() });  // Safe - snapshot
  ```

**When toNumber() is UNSAFE:**
- ❌ Before database persistence
  ```typescript
  db.update({ amount: money.toNumber() });  // ❌ Use money.toString()
  ```
- ❌ Before arithmetic operations
  ```typescript
  const result = money1.toNumber() + money2.toNumber();  // ❌ Use money1.add(money2)
  ```
- ❌ In intermediate calculations
  ```typescript
  const temp = subtotal.toNumber();  // ❌ Keep as Money
  const total = temp * 1.1;
  ```
```

**Acceptance criteria:**
- [ ] Safe patterns documented in CLAUDE.md
- [ ] Examples added for each pattern
- [ ] Anti-patterns highlighted

**Estimated effort:** 2 hours

---

#### Task 3.2: Create ESLint Rule for Money Class
**Files to create:**
- `.eslintrc.js` (update)
- `eslint-rules/no-unsafe-money-conversion.js` (new)

**Rule specification:**
```javascript
// Detect: toNumber() followed by arithmetic or persistence
// Allow: toNumber() in return statements, logging, display
module.exports = {
  rules: {
    'no-unsafe-money-conversion': {
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee.property?.name === 'toNumber') {
              // Check parent context
              const parent = node.parent;
              if (
                parent.type === 'BinaryExpression' ||  // arithmetic
                parent.type === 'CallExpression' && parent.callee.name === 'db'  // DB call
              ) {
                context.report({
                  node,
                  message: 'Unsafe toNumber() before arithmetic or persistence. Use Money class methods.',
                });
              }
            }
          }
        };
      }
    }
  }
};
```

**Acceptance criteria:**
- [ ] ESLint rule detects toNumber() before arithmetic
- [ ] Rule allows toNumber() in return statements
- [ ] CI fails on new violations

**Estimated effort:** 4 hours

---

#### Task 3.3: Add Pre-commit Hook
**File:** `.husky/pre-commit`

**Changes:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Existing checks
npm run check
npm run lint

# New Money class check
echo "Checking for Money class violations..."
VIOLATIONS=$(rg "parseFloat|Math\.round.*\*|toNumber\(\).*[\+\-\*\/]" server/ --type ts -g "!*.test.ts" | wc -l)
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ Found Money class violations. Run: rg 'parseFloat|Math\.round|toNumber' server/"
  exit 1
fi
echo "✅ Money class check passed"
```

**Acceptance criteria:**
- [ ] Pre-commit hook checks for violations
- [ ] Hook allows safe patterns
- [ ] Developer receives clear error message

**Estimated effort:** 1 hour

---

#### Task 3.4: Add Precision Tests to CI
**File:** New test suite `server/__tests__/money-precision.test.ts`

**Test cases:**
```typescript
describe('Money Class Precision (Regression)', () => {
  it('should preserve precision through 1000 goal transfers', async () => {
    // Start with 1000.00, transfer 33.33 repeatedly
    // Final balance should be within 0.01 of expected
  });

  it('should calculate portfolio value without drift', async () => {
    // Multiply 123.456 * 7.89 using Money class
    // Compare to Decimal.js reference implementation
  });

  it('should round percentages consistently', () => {
    // Test toFixed(2) vs Math.round on edge cases
  });
});
```

**Acceptance criteria:**
- [ ] Precision tests added to CI
- [ ] Tests fail if precision lost
- [ ] Tests cover all P0 violations

**Estimated effort:** 2 hours

---

## Rollout Plan

### Week 1 (Phase 1)
**Monday-Tuesday:** Tasks 1.1, 1.2 (Goal transfers + Portfolio)
**Wednesday:** Task 1.3, 1.4 (AI audit log + Dead code)
**Thursday:** Code review + testing
**Friday:** Merge to main, monitor production

### Week 2 (Phase 2)
**Monday:** Task 2.1 (Receipt parser)
**Tuesday:** Task 2.2 (Math.round)
**Wednesday:** Task 2.3, 2.4 (Client parseFloat + as any)
**Thursday:** Phase 3 (Documentation + tooling)
**Friday:** Final review + documentation

---

## Risk Mitigation

### Risk 1: Regression in goal balances
**Mitigation:**
- Create database backup before deployment
- Add feature flag for new buildGoalBalanceUpdate logic
- Run parallel comparison in production (log discrepancies)

### Risk 2: Breaking changes to Money API
**Mitigation:**
- Keep backward compatibility (accept both Money | number)
- Add deprecation warnings for number-only paths
- Gradual rollout over 2 releases

### Risk 3: Performance impact
**Mitigation:**
- Benchmark Money operations vs toNumber()
- Profile portfolio valuation with large holdings
- Add caching if needed

---

## Success Metrics

### Quantitative
- [ ] P0 violations: 4 → 0 (100% reduction)
- [ ] P1 violations: 12 → 0 (100% reduction)
- [ ] P2 violations: 45 → <10 (78% reduction)
- [ ] Test coverage: +15 precision tests added
- [ ] CI time: <+30 seconds for new checks

### Qualitative
- [ ] Developer documentation updated
- [ ] No precision-related bugs reported in 30 days post-release
- [ ] ESLint catches new violations in PR reviews

---

## Rollback Plan

If critical issues found after deployment:

1. **Immediate:** Revert PRs for Phase 1 tasks
2. **Short-term:** Feature flag disable new logic
3. **Long-term:** Run parallel Money/toNumber paths, log discrepancies

**Rollback trigger:**
- >5% increase in goal balance discrepancies
- Portfolio valuation errors reported
- Test failures in production monitoring

---

## Appendix A: Full Violation List

### parseFloat (52 total)
```bash
# Generate full list
rg -n "parseFloat" server client shared --type ts -g "!*.test.ts" > violations-parseFloat.txt
```

**Top offenders:**
1. receiptParser.ts: 10 (P1 - HIGH)
2. SplitTransactionModal.tsx: 3 (P2 - MEDIUM)
3. GoalBaseService.ts: 2 (P2 - MEDIUM)
4. assignment.calculations.ts: 2 (P2 - MEDIUM)

### Math.round (55 total)
```bash
rg -n "Math\.round" server client shared --type ts -g "!*.test.ts" > violations-mathround.txt
```

**Top offenders:**
1. mockReportsData.ts: 4 (P3 - SAFE, mock data)
2. PatternDetectionService.ts: 4 (P2 - MEDIUM)
3. GoalsWidget.tsx: 2 (P3 - SAFE, display)
4. weekly-recap.service.ts: 2 (P1 - HIGH, percentages)

### as any (22 total)
```bash
rg -n "\\bas any\\b" server client shared --type ts -g "!*.test.ts" > violations-asany.txt
```

**Top offenders:**
1. api.ts: 3 (P2 - MEDIUM)
2. ai.service.ts: 2 (P0 - CRITICAL)
3. logger.ts: 2 (P0 - CRITICAL)
4. CashFlowSection.tsx: 2 (P2 - MEDIUM)

### toNumber() (174 total)
**Categorized:**
- P0 (before persistence): 4
- P1 (before arithmetic): 12
- P2 (in calculations): 16
- P3 (safe - API boundary): 142

---

## Appendix B: Testing Checklist

### Unit Tests (per task)
- [ ] Task 1.1: Goal transfer precision (3 tests)
- [ ] Task 1.2: Portfolio valuation (3 tests)
- [ ] Task 1.3: Audit log types (1 test)
- [ ] Task 2.1: Receipt parsing (3 tests)
- [ ] Task 2.2: Percentage rounding (2 tests)
- [ ] Task 2.3: Client validation (2 tests)

### Integration Tests
- [ ] Full goal transfer flow (create → transfer → read)
- [ ] Portfolio valuation with multi-currency holdings
- [ ] Weekly recap with real transaction data

### E2E Tests
- [ ] User creates goal, makes 10 transfers, verifies balance
- [ ] User views portfolio, checks valuation accuracy

**Total new tests:** 15 unit + 3 integration + 2 E2E = 20 tests

---

## Appendix C: Communication Plan

### Internal Announcement (Week 1)
**Subject:** Money Class Refactor - Critical Precision Fixes

**Body:**
> We're fixing precision issues in goal transfers and portfolio valuations. Key changes:
> - Goal balances now use Money class (no more toFixed drift)
> - Portfolio valuations use precise arithmetic
> - New ESLint rules prevent future violations
>
> **Action required:** Review PRs #XXX, #XXX this week
> **Rollout:** Friday deployment with feature flag

### Developer Update (Week 2)
**Subject:** New CLAUDE.md Money Class Guidelines

**Body:**
> Updated Rule 1 with safe/unsafe toNumber() patterns. Key takeaways:
> - ✅ toNumber() OK for API responses, display, logging
> - ❌ toNumber() NEVER before DB writes or arithmetic
> - ESLint now catches violations in CI
>
> **Read:** CLAUDE.md Rule 1 section "When toNumber() IS safe"

---

**Plan Status:** ✅ Ready for implementation
**Next Step:** Begin Phase 1 Task 1.1 (Goal Transfer Fix)
