# Merchants Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (78/100)
**Status:** Closed (Re-audited 2026-02-07)

---
## Re-Audit 2026-02-07

This plan is closed and retained for historical context.

- Type-safety items are implemented in production module/repository code.
- Merge atomicity is implemented via transaction wrapper in `merchants.controller.ts`.
- Rate limiting and audit logging are present.
- Integration coverage exists in `server/modules/merchants/__tests__/`.

No active backlog items from this plan remain after code verification.

---

## Executive Summary

The Merchants module is feature-complete with excellent audit logging and rate limiting, but has **critical test coverage issues**: all 16 integration tests are stubs with 0% actual coverage. Additionally, there are 4 `as any` type violations and 4 client files exceeding LOC limits. This plan addresses all 19 issues identified.

---

## Issue Registry

### Phase 1: Type Safety (P0) - 4 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| TYPE-001 | `as any` cast in aggregation | `MerchantService.ts:105` | Type safety bypass | 30 min |
| TYPE-002 | `as any` cast in merge logic | `MerchantService.ts:165` | Type safety bypass | 30 min |
| TYPE-003 | `as any` cast in SQL result | `MerchantRepository.ts:218` | Type safety bypass | 30 min |
| TYPE-004 | `as any` cast in SQL result | `MerchantRepository.ts:228` | Type safety bypass | 30 min |

**Phase 1 Total Effort:** ~2 hours

### Phase 2: Test Coverage (P0) - 2 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | 16 integration tests are stubs | `merchants.integration.test.ts` | 16 | 4 hours |
| TEST-002 | Missing client component tests | `MerchantsSection/` | 25 | 5 hours |

**Phase 2 Total Effort:** ~9 hours (41 test cases)

### Phase 3: LOC Compliance (P1) - 4 Issues

| ID | Issue | Location | Current LOC | Effort |
|----|-------|----------|-------------|--------|
| LOC-001 | Hook exceeds 300 LOC limit | `useMerchantsSectionState.ts` | 593 | 2 hours |
| LOC-002 | Component exceeds 300 LOC | `MerchantCombobox.tsx` | 402 | 1.5 hours |
| LOC-003 | Component exceeds 300 LOC | `MerchantDetailView.tsx` | 385 | 1.5 hours |
| LOC-004 | Component exceeds 300 LOC | `MerchantsListPanel.tsx` | 342 | 1 hour |

**Phase 3 Total Effort:** ~6 hours

### Phase 4: Data Quality (P1) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| DATA-001 | Hardcoded currency "ZMW" | `MerchantStatsCards.tsx` | Wrong currency display | 30 min |
| DATA-002 | No currency context in stats | `MerchantDetailChart.tsx` | Missing formatting | 30 min |
| DATA-003 | Duplicate merchant name allowed | `MerchantService.ts` | Data quality | 1 hour |

**Phase 4 Total Effort:** ~2 hours

### Phase 5: Accessibility (P2) - 4 Issues

| ID | Issue | Location | WCAG | Effort |
|----|-------|----------|------|--------|
| A11Y-001 | Missing aria-label on bulk checkboxes | `MerchantCard.tsx` | 4.1.2 | 20 min |
| A11Y-002 | Missing accessible name on radio group | `MergePreviewDialog.tsx` | 4.1.2 | 20 min |
| A11Y-003 | Color-only status indication | `MerchantCard.tsx` | 1.4.1 | 30 min |
| A11Y-004 | No keyboard shortcut hints | `MerchantsToolbar.tsx` | - | 30 min |

**Phase 5 Total Effort:** ~1.5 hours

### Phase 6: Architecture (P2) - 2 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| ARCH-001 | Service not in module directory | `server/services/MerchantService.ts` | CLAUDE.md Rule 15 | 1 hour |
| ARCH-002 | Missing service index barrel | `server/modules/merchants/` | Import consistency | 30 min |

**Phase 6 Total Effort:** ~1.5 hours

---

## Total Issue Count: 19

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Type Safety | 4 | P0 | 2 hours |
| Phase 2: Test Coverage | 2 | P0 | 9 hours |
| Phase 3: LOC Compliance | 4 | P1 | 6 hours |
| Phase 4: Data Quality | 3 | P1 | 2 hours |
| Phase 5: Accessibility | 4 | P2 | 1.5 hours |
| Phase 6: Architecture | 2 | P2 | 1.5 hours |
| **TOTAL** | **19** | | **22 hours** |

---

## Implementation Details

### Phase 1: Type Safety

#### TYPE-001 & TYPE-002: Fix Service `as any` Casts

**File:** `server/services/MerchantService.ts`

```typescript
// BEFORE (line 105)
const results = await db
  .select({
    merchantId: merchants.id,
    count: sql<number>`count(*)`,
  })
  .from(transactions)
  .groupBy(merchants.id) as any[];

// AFTER - Define proper type
interface MerchantAggregation {
  merchantId: string;
  count: number;
}

const results: MerchantAggregation[] = await db
  .select({
    merchantId: merchants.id,
    count: sql<number>`count(*)::int`,
  })
  .from(transactions)
  .groupBy(merchants.id);
```

```typescript
// BEFORE (line 165)
const mergeResult = await this.merge(sourceId, targetId) as any;

// AFTER - Define proper return type
interface MergeResult {
  success: boolean;
  targetMerchant: Merchant;
  transactionsMoved: number;
  aliasesCreated: number;
}

const mergeResult: MergeResult = await this.merge(sourceId, targetId);
```

#### TYPE-003 & TYPE-004: Fix Repository `as any` Casts

**File:** `server/repositories/MerchantRepository.ts`

```typescript
// BEFORE (line 218)
const stats = await db
  .select({
    totalSpent: sql`sum(amount)`,
    transactionCount: sql`count(*)`,
  })
  .from(transactions)
  .where(eq(transactions.merchantId, merchantId)) as any;

// AFTER - Define proper interface
interface MerchantStats {
  totalSpent: string | null;
  transactionCount: number;
}

const [stats]: MerchantStats[] = await db
  .select({
    totalSpent: sql<string>`sum(amount)`,
    transactionCount: sql<number>`count(*)::int`,
  })
  .from(transactions)
  .where(eq(transactions.merchantId, merchantId));

// Convert to Money if needed
const totalSpentMoney = stats?.totalSpent
  ? new Money(stats.totalSpent)
  : Money.zero(currency);
```

### Phase 2: Test Coverage

#### TEST-001: Replace Stub Tests

**File:** `server/modules/merchants/__tests__/merchants.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestUser, createTestMerchant, cleanupTestData } from "../../../test/factories";

describe("Merchants API", () => {
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

  describe("POST /api/merchants", () => {
    it("should create a merchant with valid data", async () => {
      const response = await request(app)
        .post("/api/merchants")
        .set("Cookie", authCookie)
        .send({ name: "Test Store", category: "Shopping" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Test Store");
    });

    it("should reject duplicate merchant name", async () => {
      await createTestMerchant(householdId, "Test Store");

      const response = await request(app)
        .post("/api/merchants")
        .set("Cookie", authCookie)
        .send({ name: "Test Store" });

      expect(response.status).toBe(409);
    });
  });

  describe("POST /api/merchants/merge", () => {
    it("should merge two merchants", async () => {
      const source = await createTestMerchant(householdId, "Source");
      const target = await createTestMerchant(householdId, "Target");

      const response = await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({ sourceId: source.id, targetId: target.id });

      expect(response.status).toBe(200);
      expect(response.body.data.aliasesCreated).toBeGreaterThanOrEqual(0);
    });

    it("should reject merge of merchants from different households", async () => {
      const { household: other } = await createTestUser();
      const ourMerchant = await createTestMerchant(householdId, "Ours");
      const theirMerchant = await createTestMerchant(other.id, "Theirs");

      const response = await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({ sourceId: theirMerchant.id, targetId: ourMerchant.id });

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/merchants/:id/stats", () => {
    it("should return merchant statistics", async () => {
      const merchant = await createTestMerchant(householdId, "Stats Test");

      const response = await request(app)
        .get(`/api/merchants/${merchant.id}/stats`)
        .set("Cookie", authCookie);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty("totalSpent");
      expect(response.body.data).toHaveProperty("transactionCount");
    });
  });

  // ... 16 total test cases
});
```

### Phase 3: LOC Compliance

#### LOC-001: Split useMerchantsSectionState.ts (593 LOC â†’ 3 files)

**Split into:**

```
client/src/pages/settings/sections/MerchantsSection/hooks/
â”œâ”€â”€ useMerchantsSectionState.ts     (200 LOC) - Main state orchestration
â”œâ”€â”€ useMerchantFilters.ts           (150 LOC) - Filter logic
â”œâ”€â”€ useMerchantBulkActions.ts       (150 LOC) - Bulk operations
â””â”€â”€ index.ts                        (10 LOC)  - Barrel exports
```

**useMerchantsSectionState.ts (main):**
```typescript
import { useMerchantFilters } from "./useMerchantFilters";
import { useMerchantBulkActions } from "./useMerchantBulkActions";

export function useMerchantsSectionState() {
  const filters = useMerchantFilters();
  const bulkActions = useMerchantBulkActions();

  // ... orchestration logic only

  return {
    ...filters,
    ...bulkActions,
    // ... other state
  };
}
```

#### LOC-002: Split MerchantCombobox.tsx (402 LOC â†’ 2 files)

**Split into:**

```
client/src/components/merchants/
â”œâ”€â”€ MerchantCombobox.tsx           (200 LOC) - Main component
â”œâ”€â”€ MerchantComboboxItem.tsx       (100 LOC) - List item rendering
â”œâ”€â”€ useMerchantCombobox.ts         (100 LOC) - Hook for search/selection
â””â”€â”€ index.ts                       - Updated exports
```

### Phase 4: Data Quality

#### DATA-001: Fix Hardcoded Currency

**File:** `client/src/components/merchants/detail/MerchantStatsCards.tsx`

```typescript
// BEFORE
const formatAmount = (amount: number) => {
  return new Intl.NumberFormat("en-ZM", {
    style: "currency",
    currency: "ZMW",  // âŒ Hardcoded
  }).format(amount);
};

// AFTER
import { useSettings } from "@/hooks/use-settings";

export function MerchantStatsCards({ stats }: Props) {
  const { settings } = useSettings();
  const currency = settings?.currency || "USD";

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  };

  // ...
}
```

#### DATA-003: Add Duplicate Name Check

**File:** `server/services/MerchantService.ts`

```typescript
async create(householdId: string, data: CreateMerchantInput): Promise<Merchant> {
  // Check for duplicate name
  const existing = await this.repository.findByName(data.name, householdId);
  if (existing) {
    throw new ConflictError(`Merchant "${data.name}" already exists`);
  }

  const merchant = await this.repository.create({
    ...data,
    householdId,
  });

  return merchant;
}
```

### Phase 5: Accessibility

#### A11Y-001: Add Checkbox Labels

**File:** `client/src/components/merchants/MerchantCard.tsx`

```tsx
// BEFORE
<Checkbox
  checked={isSelected}
  onCheckedChange={onSelect}
/>

// AFTER
<Checkbox
  checked={isSelected}
  onCheckedChange={onSelect}
  aria-label={`Select ${merchant.name} for bulk actions`}
/>
```

#### A11Y-002: Add Radio Group Label

**File:** `MergePreviewDialog.tsx`

```tsx
// BEFORE
<RadioGroup value={targetId} onValueChange={setTargetId}>
  {merchants.map(m => (
    <RadioGroupItem value={m.id} />
  ))}
</RadioGroup>

// AFTER
<RadioGroup
  value={targetId}
  onValueChange={setTargetId}
  aria-label="Select target merchant for merge"
>
  {merchants.map(m => (
    <RadioGroupItem
      value={m.id}
      aria-label={`Merge into ${m.name}`}
    />
  ))}
</RadioGroup>
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify no `as any` casts
grep -rn "as any" server/services/MerchantService.ts server/repositories/MerchantRepository.ts
# Should return 0 matches

npm run check  # TypeScript must pass
```

### After Phase 2
```bash
# Verify no stub tests
grep -rn "expect(true).toBe(true)" server/modules/merchants/__tests__/
# Should return 0 matches

# Run tests
npm run test:server:run -- --grep "Merchants"
```

### After Phase 3
```bash
# Check LOC counts
wc -l client/src/pages/settings/sections/MerchantsSection/hooks/useMerchantsSectionState.ts
# Should be <300

wc -l client/src/components/merchants/MerchantCombobox.tsx
# Should be <300
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
- [ ] Zero `as any` casts in MerchantService.ts
- [ ] Zero `as any` casts in MerchantRepository.ts
- [ ] All SQL results have proper TypeScript interfaces
- [ ] `npm run check` passes

### Phase 2 Complete When:
- [ ] Zero stub tests remain
- [ ] 16 real integration tests pass
- [ ] 25 client component tests pass

### Phase 3 Complete When:
- [ ] `useMerchantsSectionState.ts` < 300 LOC
- [ ] `MerchantCombobox.tsx` < 300 LOC
- [ ] `MerchantDetailView.tsx` < 300 LOC
- [ ] `MerchantsListPanel.tsx` < 300 LOC

### Phase 4 Complete When:
- [ ] Currency uses household settings, not hardcoded
- [ ] Duplicate merchant names prevented

### Phase 5 Complete When:
- [ ] All checkboxes have aria-labels
- [ ] Radio groups have accessible names
- [ ] Status indicated by more than color alone

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 2 hours | Day 1 |
| Phase 2 | 9 hours | Days 1-2 |
| Phase 3 | 6 hours | Day 3 |
| Phase 4 | 2 hours | Day 3 |
| Phase 5 | 1.5 hours | Day 4 |
| Phase 6 | 1.5 hours | Day 4 |
| **Total** | **22 hours** | **~4 days** |

---

## References

- [Merchants Module Assessment](../../../reviews/merchants/merchants-module-assessment.md)

