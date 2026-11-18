# Rules Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (76/100)
**Status:** Closed - Completed (See module status report)

---

## Status Update (2026-02-06)

This plan is now closed. All items have been completed and consolidated in `docs/module-status/rules-module-status-2026-01-26.md`. The registry below is retained for audit history.

---

## Executive Summary

The Rules module (transaction automation) has good architecture with proper audit logging, but has **Money class violations** in split transaction logic, **`as any` type violations**, and **all integration tests are stubs**. The preview endpoint is also a placeholder. This plan addresses all 17 issues identified.

Historical note: This summary reflects the pre-fix assessment and is retained for audit history.

---

## Resolved Issue Registry (Historical)

All issues in this registry are resolved as of 2026-01-27. See `docs/module-status/rules-module-status-2026-01-26.md` for verification notes and evidence.

### Phase 1: Money Class & Type Safety (P0) - 5 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| MONEY-001 | JavaScript arithmetic for split amounts | `actions.ts:148-156` | Financial precision loss | 1 hour |
| TYPE-001 | `as any` cast in action execution | `actions.ts:138` | Type safety bypass | 30 min |
| TYPE-002 | `as any` cast in action result | `actions.ts:176` | Type safety bypass | 30 min |
| TYPE-003 | `as any` cast in condition matching | `matching.ts:33` | Type safety bypass | 30 min |
| VAL-001 | `z.any()` in validation schema | `rules.validation.ts:40` | No type checking | 45 min |

**Phase 1 Total Effort:** ~3.25 hours

### Phase 2: Test Coverage (P0) - 2 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | All integration tests are stubs | `rules.integration.test.ts` | 20 | 5 hours |
| TEST-002 | Missing action execution tests | `actions.ts` | 12 | 3 hours |

**Phase 2 Total Effort:** ~8 hours (32 test cases)

### Phase 3: API Completeness (P1) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| API-001 | Preview endpoint is placeholder | `controller.ts` | Returns empty | 2 hours |
| API-002 | Missing bulk enable/disable | `routes.ts` | No batch ops | 1.5 hours |
| RATE-001 | Preview endpoint needs analyticsLimiter | `routes.ts` | Wrong limiter | 15 min |

**Phase 3 Total Effort:** ~3.75 hours

### Phase 4: Accessibility (P2) - 4 Issues

| ID | Issue | Location | WCAG | Effort |
|----|-------|----------|------|--------|
| A11Y-001 | Select components missing labels | `RuleEditorModal.tsx` | 4.1.2 | 30 min |
| A11Y-002 | Condition cards missing heading structure | `ConditionCard.tsx` | 1.3.1 | 30 min |
| A11Y-003 | No ARIA live region for rule matches | `PreviewTab.tsx` | 4.1.3 | 30 min |
| A11Y-004 | Drag handle not keyboard accessible | `RuleCard.tsx` | 2.1.1 | 1 hour |

**Phase 4 Total Effort:** ~2.5 hours

### Phase 5: Code Quality (P2) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| CODE-001 | Duplicate condition type definitions | `types.ts` vs `ruleBuilderTypes.ts` | Maintenance | 1 hour |
| CODE-002 | Missing error handling in action execution | `actions.ts` | Silent failures | 1 hour |
| CODE-003 | No dry-run mode for rule testing | `RuleService.ts` | Testing gap | 2 hours |

**Phase 5 Total Effort:** ~4 hours

---

## Total Issue Count: 17

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Money & Types | 5 | P0 | 3.25 hours |
| Phase 2: Test Coverage | 2 | P0 | 8 hours |
| Phase 3: API Completeness | 3 | P1 | 3.75 hours |
| Phase 4: Accessibility | 4 | P2 | 2.5 hours |
| Phase 5: Code Quality | 3 | P2 | 4 hours |
| **TOTAL** | **17** | | **21.5 hours** |

---

## Implementation Details

### Phase 1: Money Class & Type Safety

#### MONEY-001: Fix Split Amount Calculation

**File:** `server/services/rules/actions.ts`

The split transaction logic uses JavaScript arithmetic which can lose precision.

```typescript
// BEFORE (lines 148-156) - VULNERABLE
async function executeSplitAction(
  transaction: Transaction,
  splitConfig: SplitConfig
): Promise<void> {
  const totalAmount = parseFloat(transaction.amount);  // âŒ BAD

  for (const split of splitConfig.splits) {
    const splitAmount = totalAmount * (split.percentage / 100);  // âŒ BAD
    await createSplitTransaction({
      ...transaction,
      amount: splitAmount.toFixed(2),  // âŒ Precision loss
      categoryId: split.categoryId,
    });
  }
}

// AFTER - Use Money class
import { Money } from "../../../core/money";

async function executeSplitAction(
  transaction: Transaction,
  splitConfig: SplitConfig,
  currency: string
): Promise<void> {
  const totalAmount = new Money(transaction.amount);

  // Calculate splits maintaining precision
  const splits: Money[] = [];
  let remainder = totalAmount;

  for (let i = 0; i < splitConfig.splits.length; i++) {
    const split = splitConfig.splits[i];

    if (i === splitConfig.splits.length - 1) {
      // Last split gets remainder to avoid rounding errors
      splits.push(remainder);
    } else {
      const percentage = new Money(split.percentage.toString()).divide(100);
      const splitAmount = totalAmount.multiply(percentage);
      splits.push(splitAmount);
      remainder = remainder.subtract(splitAmount);
    }
  }

  // Create split transactions
  for (let i = 0; i < splitConfig.splits.length; i++) {
    await createSplitTransaction({
      ...transaction,
      amount: splits[i].toString(),
      categoryId: splitConfig.splits[i].categoryId,
    });
  }
}
```

#### TYPE-001, TYPE-002, TYPE-003: Remove `as any` Casts

**File:** `server/services/rules/actions.ts`

```typescript
// BEFORE (line 138)
const result = await executeAction(action) as any;

// AFTER - Define proper type
interface ActionResult {
  success: boolean;
  affectedTransactionId?: string;
  error?: string;
}

const result: ActionResult = await executeAction(action);
```

```typescript
// BEFORE (line 176)
return results as any[];

// AFTER
interface RuleExecutionResult {
  ruleId: string;
  transactionsAffected: number;
  actions: ActionResult[];
}

return results as RuleExecutionResult[];
```

**File:** `server/services/rules/matching.ts`

```typescript
// BEFORE (line 33)
const matchResult = evaluateCondition(condition, transaction) as any;

// AFTER
interface ConditionMatchResult {
  matches: boolean;
  field: string;
  actualValue: string | number | null;
  expectedValue: string | number;
}

const matchResult: ConditionMatchResult = evaluateCondition(condition, transaction);
```

#### VAL-001: Replace `z.any()` with Proper Schema

**File:** `server/modules/rules/rules.validation.ts`

```typescript
// BEFORE (line 40)
const actionSchema = z.object({
  type: z.enum(["set_category", "set_merchant", "add_tag", "split", "set_owner"]),
  value: z.any(),  // âŒ No type checking
});

// AFTER - Discriminated union
const setCategoryAction = z.object({
  type: z.literal("set_category"),
  value: z.string().uuid(),
});

const setMerchantAction = z.object({
  type: z.literal("set_merchant"),
  value: z.string().uuid(),
});

const addTagAction = z.object({
  type: z.literal("add_tag"),
  value: z.string().uuid(),
});

const setOwnerAction = z.object({
  type: z.literal("set_owner"),
  value: z.enum(["user", "partner", "shared"]),
});

const splitAction = z.object({
  type: z.literal("split"),
  value: z.object({
    splits: z.array(z.object({
      percentage: z.number().min(0).max(100),
      categoryId: z.string().uuid(),
    })),
  }),
});

const actionSchema = z.discriminatedUnion("type", [
  setCategoryAction,
  setMerchantAction,
  addTagAction,
  setOwnerAction,
  splitAction,
]);

export type RuleAction = z.infer<typeof actionSchema>;
```

### Phase 2: Test Coverage

#### TEST-001: Replace Stub Tests

**File:** `server/modules/rules/__tests__/rules.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestUser, createTestRule, createTestTransaction, cleanupTestData } from "../../../test/factories";

describe("Rules API", () => {
  let authCookie: string;
  let householdId: string;

  beforeEach(async () => {
    const { user, household, cookie } = await createTestUser();
    authCookie = cookie;
    householdId = household.id;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("POST /api/rules", () => {
    it("should create a rule with valid conditions and actions", async () => {
      const response = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Groceries Rule",
          conditions: [
            { field: "merchant", operator: "contains", value: "grocery" }
          ],
          actions: [
            { type: "set_category", value: "category-uuid" }
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Groceries Rule");
    });

    it("should reject invalid action type", async () => {
      const response = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Bad Rule",
          conditions: [],
          actions: [{ type: "invalid", value: "x" }],
        });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/rules/:id/execute", () => {
    it("should execute rule on matching transactions", async () => {
      const rule = await createTestRule(householdId, {
        conditions: [{ field: "amount", operator: "gt", value: "100" }],
        actions: [{ type: "add_tag", value: "tag-uuid" }],
      });
      await createTestTransaction(householdId, { amount: "150.00" });

      const response = await request(app)
        .post(`/api/rules/${rule.id}/execute`)
        .set("Cookie", authCookie);

      expect(response.status).toBe(200);
      expect(response.body.data.transactionsAffected).toBeGreaterThan(0);
    });
  });

  describe("GET /api/rules/:id/preview", () => {
    it("should return transactions that would match", async () => {
      const rule = await createTestRule(householdId, {
        conditions: [{ field: "description", operator: "contains", value: "coffee" }],
      });
      await createTestTransaction(householdId, { description: "Morning coffee" });

      const response = await request(app)
        .get(`/api/rules/${rule.id}/preview`)
        .set("Cookie", authCookie);

      expect(response.status).toBe(200);
      expect(response.body.data.matchingTransactions).toHaveLength(1);
    });
  });

  // ... 20 total test cases
});
```

#### TEST-002: Action Execution Tests

**File:** `server/services/rules/__tests__/actions.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { executeSplitAction, executeSetCategoryAction } from "../actions";
import { Money } from "../../../../core/money";

describe("Rule Actions", () => {
  describe("executeSplitAction", () => {
    it("should split transaction maintaining precision", async () => {
      const transaction = { id: "1", amount: "100.00" };
      const config = {
        splits: [
          { percentage: 33.33, categoryId: "cat1" },
          { percentage: 33.33, categoryId: "cat2" },
          { percentage: 33.34, categoryId: "cat3" },  // Remainder
        ],
      };

      const result = await executeSplitAction(transaction, config, "USD");

      // Verify splits sum to original
      const total = result.splits.reduce(
        (sum, s) => sum.add(new Money(s.amount)),
        Money.zero("USD")
      );
      expect(total.toString()).toBe("100.00");
    });

    it("should handle edge case with 2 decimal places", async () => {
      const transaction = { id: "1", amount: "33.33" };
      const config = {
        splits: [
          { percentage: 50, categoryId: "cat1" },
          { percentage: 50, categoryId: "cat2" },
        ],
      };

      const result = await executeSplitAction(transaction, config, "USD");

      // 33.33 / 2 = 16.665, should round correctly
      expect(result.splits[0].amount).toBe("16.67");
      expect(result.splits[1].amount).toBe("16.66");
    });
  });

  // ... 12 total test cases
});
```

### Phase 3: API Completeness

#### API-001: Implement Preview Endpoint

**File:** `server/modules/rules/rules.controller.ts`

```typescript
export async function preview(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { householdId } = req.householdContext!;
  const { limit = 50 } = req.query;

  // Get the rule
  const rule = await ruleService.findById(id, householdId);
  if (!rule) {
    throw new NotFoundError("Rule not found");
  }

  // Find matching transactions (without executing actions)
  const matchingTransactions = await ruleService.findMatchingTransactions(
    rule,
    householdId,
    { limit: Number(limit) }
  );

  // Calculate what would happen
  const preview = {
    ruleId: rule.id,
    ruleName: rule.name,
    matchingTransactions: matchingTransactions.map(t => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      wouldApply: rule.actions.map(a => ({
        type: a.type,
        value: a.value,
      })),
    })),
    totalMatches: matchingTransactions.length,
  };

  success(res, preview);
}
```

#### RATE-001: Fix Preview Rate Limiter

**File:** `server/modules/rules/rules.routes.ts`

```typescript
// BEFORE
router.get("/:id/preview", generalLimiter, controller.preview);

// AFTER
import { analyticsLimiter } from "../../middleware/rateLimit";

router.get("/:id/preview", analyticsLimiter, controller.preview);  // Preview is expensive
```

### Phase 4: Accessibility

#### A11Y-001: Add Select Labels

**File:** `client/src/pages/settings/sections/RulesSection/RuleEditorModal.tsx`

```tsx
// BEFORE
<Select value={condition.field} onValueChange={handleFieldChange}>
  <SelectTrigger>
    <SelectValue placeholder="Select field" />
  </SelectTrigger>
  ...
</Select>

// AFTER
<div className="space-y-1">
  <Label htmlFor={`condition-field-${index}`} className="sr-only">
    Condition field
  </Label>
  <Select value={condition.field} onValueChange={handleFieldChange}>
    <SelectTrigger id={`condition-field-${index}`} aria-label="Select condition field">
      <SelectValue placeholder="Select field" />
    </SelectTrigger>
    ...
  </Select>
</div>
```

#### A11Y-004: Make Drag Handle Keyboard Accessible

**File:** `client/src/pages/settings/sections/RulesSection/RuleCard.tsx`

```tsx
// BEFORE
<button {...dragHandleProps}>
  <GripVertical className="h-4 w-4" />
</button>

// AFTER
<button
  {...dragHandleProps}
  aria-label={`Reorder rule: ${rule.name}. Use arrow keys to move.`}
  onKeyDown={(e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onMoveUp?.();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMoveDown?.();
    }
  }}
>
  <GripVertical className="h-4 w-4" aria-hidden="true" />
</button>
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify no `as any` casts
grep -rn "as any" server/services/rules/
# Should return 0 matches

# Verify no z.any()
grep -rn "z\.any()" server/modules/rules/
# Should return 0 matches

# Verify Money class usage
grep -rn "parseFloat\|Number(" server/services/rules/actions.ts
# Should return 0 matches for split logic

npm run check  # TypeScript must pass
```

### After Phase 2
```bash
# Verify no stub tests
grep -rn "expect(true).toBe(true)" server/modules/rules/__tests__/
# Should return 0 matches

# Run tests
npm run test:server:run -- --grep "Rules"
```

### After Phase 3
```bash
# Test preview endpoint
curl -X GET "http://localhost:5000/api/rules/UUID/preview" -H "Cookie: ..."
# Should return matchingTransactions array, not empty
```

### Full Verification
```bash
npm run check              # TypeScript must pass
npm run test:run           # Client tests must pass
npm run test:server:run    # Server tests must pass
```

---

## Success Criteria

### Phase 1 Complete When:
- [ ] Split action uses Money class throughout
- [ ] Zero `as any` casts in rules services
- [ ] `z.any()` replaced with discriminated union
- [ ] `npm run check` passes

### Phase 2 Complete When:
- [ ] Zero stub tests remain
- [ ] 20 real integration tests pass
- [ ] 12 action execution tests pass
- [ ] Coverage reaches 60%+

### Phase 3 Complete When:
- [ ] Preview endpoint returns matching transactions
- [ ] Preview uses analyticsLimiter
- [ ] Bulk enable/disable endpoints work

### Phase 4 Complete When:
- [ ] All Select components have accessible labels
- [ ] Drag handles keyboard accessible
- [ ] ARIA live region announces matches

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 3.25 hours | Day 1 |
| Phase 2 | 8 hours | Days 1-2 |
| Phase 3 | 3.75 hours | Day 3 |
| Phase 4 | 2.5 hours | Day 3 |
| Phase 5 | 4 hours | Day 4 |
| **Total** | **21.5 hours** | **~4 days** |

---

## References

- [Rules Module Assessment](../../../reviews/rules/rules-module-assessment.md)

