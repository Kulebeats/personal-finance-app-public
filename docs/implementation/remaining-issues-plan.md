# Implementation Plan: Remaining P0/P1 Issues

**Created:** 2026-01-23
**Updated:** 2026-01-29
**Status:** ✅ COMPLETE
**Completion Date:** 2026-01-29
**Total Issues:** 9 Original → All 9 Completed

---

## Status Summary

**COMPLETED (As of 2026-01-28):**
- ✅ ISSUE-RECEIPT-004: Receipts integration tests added (20 tests in receipts.integration.test.ts)
- ✅ ISSUE-INV-003: Investments integration tests added (32 tests in investments.integration.test.ts)
- ✅ ISSUE-RPT-003: Server LOC violations fixed (SankeyHelpers: 8 LOC, AnalyticsRepo: 129 LOC)
- ✅ ISSUE-INV-008: Client LOC violations fixed (useInvestments split into hooks/investments/)
- ✅ ISSUE-INV-005: Client parseFloat fixed in investment components

**ALL ISSUES RESOLVED:**

| Issue ID | Category | Priority | File(s) | Effort | Status |
|----------|----------|----------|---------|--------|--------|
| ISSUE-RPT-004 | Client LOC | P1 | MerchantsSection, MonthlyTrends | Medium | ✅ DONE |
| ISSUE-RPT-006 | Client Types | P1 | 12 `as any` casts in reports | Medium | ✅ DONE |
| ISSUE-INV-006 | Client Types | P1 | 7 `as any` casts in investments | Low | ✅ DONE |
| HOUSEHOLD-LOC-001 | Server LOC | P1 | household.controller.ts | Medium | ✅ DONE |

**Completion:** 9/9 (100%) - All Issues Complete

---

## Completed Issues

### ✅ Phase 1: Test Coverage (P0) - COMPLETE

#### 1.1 ISSUE-RECEIPT-004: Receipts Integration Tests - ✅ COMPLETE

**Status:** COMPLETE - 20 integration tests added on 2026-01-23
**File:** `server/modules/receipts/__tests__/receipts.integration.test.ts` (528 LOC)
**Evidence:** See module-status/receipts-module-status-2026-01-23.md

~~**Create:** `server/modules/receipts/__tests__/receipts.integration.test.ts`~~

**Test Cases Required (15+):**

```
GET /api/receipts
  ✓ returns paginated receipts for household
  ✓ returns 401 without auth
  ✓ excludes other household receipts

GET /api/receipts/:id
  ✓ returns receipt by id
  ✓ returns 404 for missing
  ✓ returns 404 for wrong household

POST /api/receipts/upload
  ✓ uploads valid image
  ✓ rejects non-image files
  ✓ enforces size limit

POST /api/receipts/:id/match
  ✓ matches to transaction
  ✓ handles no match found
  ✓ rejects already matched

POST /api/receipts/:id/create-transaction
  ✓ creates transaction from OCR
  ✓ validates required fields

DELETE /api/receipts/:id
  ✓ deletes pending receipt
  ✓ prevents deleting matched
```

**Implementation:**
```typescript
// server/modules/receipts/__tests__/receipts.integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";

describe("Receipts API", () => {
  describe("GET /api/receipts", () => {
    it("returns paginated receipts", async () => {
      const res = await request(app)
        .get("/api/receipts")
        .set("Cookie", [`session=${mockSession}`]);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
```

#### 1.2 ISSUE-INV-003: Investments Integration Tests - ✅ COMPLETE

**Status:** COMPLETE - 32 integration tests added on 2026-01-21
**File:** `server/modules/investments/__tests__/investments.integration.test.ts`
**Evidence:** See module-status/investments-module-status-2026-01-23.md

~~**Fix:** `server/routes/__tests__/investments.test.ts` - Remove `describe.skip()`~~

**Test Cases Required (10+):**
```
Holdings CRUD
  ✓ creates holding
  ✓ updates holding
  ✓ deletes holding
  ✓ enforces household isolation

Transactions
  ✓ records BUY transaction
  ✓ records SELL transaction
  ✓ prevents overdraft on SELL
  ✓ updates holding quantity

Portfolio
  ✓ calculates total value
  ✓ handles FX conversion
```

---

### ✅ Phase 2: Server LOC Violations (P0) - COMPLETE

#### 2.1 ISSUE-RPT-003: Split Large Server Files - ✅ COMPLETE

**Status:** COMPLETE - Files split on 2026-01-21
**Evidence:**
- SankeyHelpers.ts: 692 LOC → 8 LOC (barrel file)
- AnalyticsReportRepository.ts: 635 LOC → 129 LOC
- Split into: AnalyticsRatiosRepository.ts, AnalyticsForecastRepository.ts

~~**A. SankeyHelpers.ts (692 LOC → 3 files)**~~

```
server/repositories/reports/sankey/
├── index.ts              # Re-exports (20 LOC)
├── SankeyNodes.ts        # Node builders (350 LOC)
├── SankeyLinks.ts        # Link builders (250 LOC)
└── SankeyUtils.ts        # Shared utils (100 LOC)
```

**Split Guide:**
- `SankeyNodes.ts`: `buildIncomeToExpenseGroupsNodes()`, `buildAccountToExpenseGroupsNodes()`, `buildExpenseGroupsToCategoriesNodes()`
- `SankeyLinks.ts`: `buildSankeyLinks()`, link calculation helpers
- `SankeyUtils.ts`: `convertAmount()`, aggregation helpers

**B. AnalyticsReportRepository.ts (635 LOC → 3 files)**

```
server/repositories/reports/analytics/
├── index.ts                        # Re-exports (30 LOC)
├── AnalyticsRatiosRepository.ts    # getFinancialRatios, getDebtAnalysis (250 LOC)
├── AnalyticsForecastRepository.ts  # getForecast, getGoalsProgress (250 LOC)
└── AnalyticsCustomRepository.ts    # executeCustomChart (200 LOC)
```

---

## Phase 3: Missing API Endpoints (P1)

### 3.1 BUG-INV-006: Add 4 Missing Endpoints

**Add to `investments.routes.ts`:**
```typescript
router.post("/securities", generalLimiter, controller.createSecurity);
router.put("/securities/:id/price", generalLimiter, controller.updateSecurityPrice);
router.get("/fx-rates", generalLimiter, controller.getFxRates);
router.post("/fx-rates", generalLimiter, controller.createFxRate);
```

**Add Validation Schemas:**
```typescript
export const createSecuritySchema = z.object({
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(255),
  type: z.enum(["stock", "bond", "etf", "mutual_fund", "crypto", "other"]),
  exchange: z.string().max(50).optional(),
  currency: z.string().length(3),
});

export const createFxRateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.number().positive(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

**Add to AuditEntityType:** `"security"`, `"fx_rate"`

---

## Phase 4: Client LOC Violations (P1)

### 4.1 ISSUE-RPT-004: Split Report Components

**MerchantsSection.tsx (444 LOC → 4 files)**
```
features/reports/components/merchants/
├── index.ts
├── MerchantsSection.tsx    # Container (150 LOC)
├── MerchantTable.tsx       # Table (120 LOC)
├── MerchantFilters.tsx     # Filters (100 LOC)
└── MerchantSummary.tsx     # Summary (80 LOC)
```

**MonthlyTrendsWidget.tsx (348 LOC → 3 files)**
```
components/reports/monthly-trends/
├── index.ts
├── MonthlyTrendsWidget.tsx # Container (150 LOC)
├── TrendChart.tsx          # Chart (120 LOC)
└── TrendLegend.tsx         # Legend (80 LOC)
```

### 4.2 ISSUE-INV-008: Split useInvestments Hook

**useInvestments.ts (734 LOC → 7 files)**
```
hooks/investments/
├── index.ts                      # Re-exports
├── useHoldings.ts                # Holdings CRUD (150 LOC)
├── useInvestmentTransactions.ts  # Transactions (150 LOC)
├── useSecurities.ts              # Securities (100 LOC)
├── usePortfolio.ts               # Portfolio (100 LOC)
├── useInvestmentPerformance.ts   # Performance (100 LOC)
├── useFxRates.ts                 # FX rates (80 LOC)
└── types.ts                      # Shared types (50 LOC)
```

---

## Phase 5: Client Type Safety (P1)

### 5.1 ISSUE-RPT-006: Fix 12 `as any` Casts

**CustomChartBuilderModal.tsx (10 casts):**
```typescript
// Add interfaces
interface ChartConfig {
  chartType: "bar" | "line" | "pie" | "area";
  primaryMetric: "income" | "expenses" | "savings" | "netWorth";
  groupBy?: "categoryGroup" | "category" | "merchant" | "tag";
}
// Replace: config as any → config: ChartConfig
```

**TreemapChart.tsx (2 casts):**
```typescript
import type { ComputedDatum } from "@nivo/treemap";
// Replace: node: any → node: ComputedDatum<TreemapNodeData>
```

### 5.2 ISSUE-INV-005: Fix 20+ parseFloat

**Pattern:**
```typescript
// Before
parseFloat(quantity) * parseFloat(price)

// After
import { toMoneyNumber } from "@/lib/money";
toMoneyNumber(quantity) * toMoneyNumber(price)
```

**Files to Update:**
- AddHoldingModal.tsx (2)
- AddHoldingSecurityStep.tsx (1)
- HoldingsList.tsx (5)
- InvestmentBuySellForm.tsx (2)
- InvestmentIncomeForm.tsx (2)
- RecordInvestmentTransactionModal.tsx (5)
- TopMovers.tsx (1)

### 5.3 ISSUE-INV-006: Fix 7 `as any` Casts

**Add Type Definitions:**
```typescript
type SecurityType = "stock" | "bond" | "etf" | "mutual_fund" | "crypto" | "other";
type Exchange = "JSE" | "NYSE" | "NASDAQ" | "LSE" | "LuSE" | "OTHER";
type TimeFrame = "1M" | "3M" | "YTD" | "1Y" | "ALL";
```

---

## Master Todo Checklist

### Phase 1: Test Coverage
- [ ] Create `receipts.integration.test.ts` with 15+ tests
- [ ] Fix/create `investments.integration.test.ts` with 10+ tests
- [ ] Verify: `npm run test:server:run` passes

### Phase 2: Server LOC
- [ ] Create `sankey/` directory with 3 split files
- [ ] Create `analytics/` directory with 3 split files
- [ ] Update imports in dependent files
- [ ] Verify: each file < 500 LOC

### Phase 3: Missing APIs
- [ ] Add 4 routes to `investments.routes.ts`
- [ ] Add 4 controller methods
- [ ] Add 4 service methods
- [ ] Add validation schemas
- [ ] Add audit entity types

### Phase 4: Client LOC
- [ ] Split MerchantsSection into 4 files
- [ ] Split MonthlyTrendsWidget into 3 files
- [ ] Split useInvestments into 7 files
- [ ] Split 4 remaining large components
- [ ] Verify: each file < 300 LOC

### Phase 5: Client Types - 🔄 PARTIAL (1/3 complete)
- [x] ~~Fix 20+ parseFloat in investments components~~ ✅ COMPLETE
- [ ] Fix 12 `as any` in reports components (ISSUE-RPT-006)
- [ ] Fix 7 `as any` in investments components (ISSUE-INV-006)

---

## Open Issues (4 Remaining)

### P1-1: ISSUE-RPT-004 - Split Large Report Components

**Files:**
- `client/src/features/reports/components/MerchantsSection.tsx` (444 LOC)
- `client/src/components/reports/MonthlyTrendsWidget.tsx` (348 LOC)

**Target:** Split into sub-components under 300 LOC each

**Effort:** ~4 hours

---

### P1-2: ISSUE-RPT-006 - Fix Report Component Type Casts

**Files:**
- `CustomChartBuilderModal.tsx` (10 `as any` casts)
- `TreemapChart.tsx` (2 `as any` casts)

**Fix Pattern:**
```typescript
// Add proper interfaces
interface ChartConfig {
  chartType: "bar" | "line" | "pie" | "area";
  primaryMetric: "income" | "expenses" | "savings" | "netWorth";
}
```

**Effort:** ~2 hours

---

### P1-3: ISSUE-INV-006 - Fix Investment Component Type Casts

**Files:**
- `AddHoldingModal.tsx`
- `RecordInvestmentTransactionModal.tsx`
- `InvestmentPerformance.tsx`
- `useInvestments.ts` (hooks)

**7 `as any` casts to fix**

**Effort:** ~2 hours

---

### P1-4: HOUSEHOLD-LOC-001 - Split Household Controller (NEW)

**File:** `server/modules/household/household.controller.ts` (814 LOC)
**Target:** 500 LOC limit
**Recommendation:** Split into:
- `household.members.controller.ts` - Member management
- `household.settings.controller.ts` - Settings management
- `household.controller.ts` - Core CRUD (< 300 LOC)

**Effort:** ~4 hours

---

## Final Verification Checklist

### Completed
- [x] `npm run test:server:run` - Server tests pass ✅
- [x] Server LOC compliance - All under 500 LOC ✅ (except household.controller.ts)
- [x] Investments module complete ✅
- [x] Receipts module complete ✅
- [x] Goals module complete ✅

### Remaining
- [ ] `npm run check` - TypeScript passes (after fixing `as any` casts)
- [ ] Client LOC compliance - All under 300 LOC
- [ ] Fix 4 remaining issues (ISSUE-RPT-004, ISSUE-RPT-006, ISSUE-INV-006, HOUSEHOLD-LOC-001)

---

**Original Estimated Effort:** 2-3 days
**Actual Completion:** 5/9 issues (56%)
**Remaining Effort:** ~12 hours (1.5 days)
