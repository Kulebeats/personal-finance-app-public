# Investment Integration Requirements

**Date:** 2026-01-06
**Status:** Draft
**Purpose:** Define requirements to integrate the Investment module with core app features (Net Worth, Dashboard, Reports)

---

## Executive Summary

The Investment module is currently **functionally complete** but operates in **isolation** from the broader personal finance app. This document outlines 3 critical integration gaps and provides detailed requirements for full alignment.

### Integration Gaps Identified

| Gap | Impact | Priority |
|-----|--------|----------|
| **1. Net Worth Snapshots** | Investment holdings excluded from net worth calculations | 🔴 **CRITICAL** |
| **2. Dashboard Visibility** | No investment summary widget on main dashboard | 🟠 **HIGH** |
| **3. Reports Integration** | Investment income/dividends not in main Reports page | 🟡 **MEDIUM** |

---

## 1. Net Worth Snapshots Integration

### Problem Statement

**Current Behavior:**
- [`server/jobs/snapshotWorker.ts`](../../../server/jobs/snapshotWorker.ts#L73) calculates net worth from `accounts` table balances only
- Investment holdings (stored in `holdings` table with market values) are **NOT** included
- Daily snapshots understate true net worth for users with investments

**Impact:**
- Net Worth chart in Reports shows incomplete picture
- Dashboard Net Worth widget displays incorrect totals
- Historical tracking ignores portfolio growth

### Technical Analysis

**Current Implementation ([snapshotWorker.ts:73-114](../../../server/jobs/snapshotWorker.ts#L73-L114)):**
```typescript
// Gets account balances only
const allAccounts = await db
  .select({
    id: accounts.id,
    type: accounts.type,
    balance: accounts.balance,  // ❌ Excludes investment holdings
    isHidden: accounts.isHidden,
  })
  .from(accounts)
  .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)));
```

**Missing Data:**
- Investment holdings market value: `quantity × currentPrice × fxRate`
- Available in [`server/modules/investments/investments.routes.ts`](../../../server/modules/investments/investments.routes.ts) via `computeHoldingMetrics()`

### Requirements

#### 1.1 Snapshot Calculation Enhancement

**FR-NW-001:** Include investment holdings in net worth calculations
**Priority:** CRITICAL
**Acceptance Criteria:**
- [ ] `SnapshotWorker.processHousehold()` queries `holdings` table
- [ ] Computes market value using latest `securities.currentPrice`
- [ ] Applies FX conversion to household base currency
- [ ] Adds investment value to `totalAssets` in net worth snapshot
- [ ] Stores investment breakdown in `assetsByType` JSON field

**Implementation Notes:**
```typescript
// Pseudo-code for required changes
const investmentHoldings = await db
  .select({
    holdingId: holdings.id,
    quantity: holdings.quantity,
    securityId: holdings.securityId,
    accountId: holdings.accountId,
    currentPrice: securities.currentPrice,
    currency: securities.currency,
  })
  .from(holdings)
  .innerJoin(securities, eq(securities.id, holdings.securityId))
  .innerJoin(accounts, eq(accounts.id, holdings.accountId))
  .where(
    and(
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      eq(accounts.isHidden, false)
    )
  );

// Calculate market value with FX conversion
for (const holding of investmentHoldings) {
  const marketValueLocal = parseFloat(holding.quantity) * parseFloat(holding.currentPrice);
  const fxRate = await getLatestFxRate(holding.currency, householdCurrency);
  const marketValueBase = marketValueLocal * fxRate;

  totalAssets += marketValueBase;
  assetsByType['investment'] = (assetsByType['investment'] || 0) + marketValueBase;
}
```

#### 1.2 Asset Type Breakdown

**FR-NW-002:** Add investment-specific asset type breakdown
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] `assetsByType` includes `investment` category
- [ ] Optional: Sub-categorize by security type (stock, bond, tbill, etc.)
- [ ] Backward compatible with existing snapshot structure

**Data Structure:**
```typescript
// Option 1: Simple aggregation
assetsByType: {
  "checking": 50000,
  "savings": 100000,
  "investment": 250000,  // ✅ New category
  "credit": -10000
}

// Option 2: Detailed breakdown (optional future enhancement)
assetsByType: {
  "checking": 50000,
  "savings": 100000,
  "investment.stock": 150000,
  "investment.bond": 50000,
  "investment.tbill": 50000,
  "credit": -10000
}
```

#### 1.3 Performance Considerations

**FR-NW-003:** Optimize snapshot generation for large portfolios
**Priority:** MEDIUM
**Acceptance Criteria:**
- [ ] Single query joins holdings → securities → accounts
- [ ] Batch FX rate lookups (avoid N+1 queries)
- [ ] Query timeout: < 5 seconds for 100+ holdings

**Implementation Strategy:**
- Reuse existing `getLatestFxRates()` helper from [`investments.routes.ts`](../../../server/modules/investments/investments.routes.ts)
- Leverage `computeHoldingMetrics()` calculation logic

#### 1.4 Account-Level Snapshot Enhancement

**FR-NW-004:** Store investment account values in `accountBalanceSnapshots`
**Priority:** LOW
**Acceptance Criteria:**
- [ ] Investment accounts show aggregated holdings value
- [ ] Individual holdings not tracked in snapshots (use `holdings` table for detail)
- [ ] Snapshot reflects total portfolio value per account

**Rationale:**
Investment accounts (type: `investment`, `pension`, `forex`) should have balances that reflect the sum of all holdings, not just cash positions.

---

## 2. Dashboard Investment Widget

### Problem Statement

**Current Behavior:**
- [Dashboard.tsx](../../../client/src/pages/Dashboard.tsx) has 13 widgets (budget, transactions, spending, accounts, goals, etc.)
- **NO** investment summary widget exists
- Users must navigate to separate `/investments` page to see portfolio status

**Impact:**
- Poor UX: Hidden investment performance
- Missed engagement opportunity for portfolio tracking
- Inconsistent with other financial categories (accounts, goals have widgets)

### Requirements

#### 2.1 Investment Summary Widget

**FR-DASH-001:** Create `InvestmentSummaryWidget` component
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] Displays total portfolio value in household currency
- [ ] Shows today's gain/loss (absolute + percentage)
- [ ] Mini chart: 7-day or 30-day performance trend
- [ ] Click-through navigation to `/investments` page
- [ ] Responsive design matching existing widget styles

**Widget Layout (Wireframe):**
```
┌─────────────────────────────────────┐
│ INVESTMENT PORTFOLIO        ↗ +2.3% │
│                                      │
│ ZMW 425,000                          │
│ +ZMW 9,200 today                     │
│                                      │
│ [Mini sparkline chart]               │
│                                      │
│ 15 holdings • 5 accounts             │
└─────────────────────────────────────┘
```

**Reference Implementation:**
- Follow pattern from [`NetWorthWidget.tsx`](../../../client/src/components/dashboard/NetWorthWidget.tsx)
- Use [`useInvestments` hook](../../../client/src/hooks/useInvestments.ts) for data fetching
- Integrate with existing card styles from [`ui/card.tsx`](../../../client/src/components/ui/card.tsx)

#### 2.2 Data Requirements

**FR-DASH-002:** Add dashboard-specific investment endpoint
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] New endpoint: `GET /api/investments/dashboard/summary`
- [ ] Returns: `{ totalValue, dayGainLoss, dayGainLossPercent, holdingsCount, accountsCount, performanceSeries[] }`
- [ ] Performance series: Last 30 days of portfolio values
- [ ] Cached with 5-minute TTL (acceptable staleness for dashboard)

**API Response Schema:**
```typescript
{
  totalValue: 425000,
  totalCostBasis: 380000,
  dayGainLoss: 9200,
  dayGainLossPercent: 2.3,
  holdingsCount: 15,
  accountsCount: 5,
  baseCurrency: "ZMW",
  performanceSeries: [
    { date: "2026-01-01", value: 410000 },
    { date: "2026-01-02", value: 415000 },
    // ... last 30 days
    { date: "2026-01-06", value: 425000 }
  ]
}
```

**Implementation Notes:**
- Leverage existing `computeHoldingMetrics()` from [`investments.routes.ts`](../../../server/modules/investments/investments.routes.ts)
- Calculate day change from previous day's snapshot or historical prices
- Consider Redis caching for performance

#### 2.3 Dashboard Configuration

**FR-DASH-003:** Add investment widget to dashboard customization
**Priority:** MEDIUM
**Acceptance Criteria:**
- [ ] Investment widget appears in [`CustomizeDashboardModal`](../../../client/src/components/dashboard/CustomizeDashboardModal.tsx)
- [ ] Default: **Enabled** for users with investment accounts
- [ ] Users can toggle visibility
- [ ] Respects drag-and-drop ordering

**Integration Point:**
```typescript
// In Dashboard.tsx
const WIDGET_COMPONENTS: Record<string, React.ComponentType<any>> = {
  // ... existing widgets
  "investments": InvestmentSummaryWidget,  // ✅ Add this
};

// In default widget state
const [widgets, setWidgets] = useState<WidgetConfig[]>([
  // ... existing widgets
  { id: "investments", label: "Investment Portfolio", enabled: true },
]);
```

---

## 3. Reports Integration

### Problem Statement

**Current Behavior:**
- [Reports.tsx](../../../client/src/pages/Reports.tsx) shows tabs: Annual, Cash Flow, Spending, Merchants, Income, Net Worth, Savings
- Investment income (dividends, interest) tracked separately in `investment_transactions` table
- **NOT** included in "Income" tab calculations
- Tax reports exist at `/investments/tax` but isolated from main reporting

**Impact:**
- Incomplete income picture in reports
- Users must cross-reference two pages for total income
- Tax preparation workflow fragmented

### Technical Analysis

**Current Income Calculation ([CompositeReportRepository](../../../server/repositories/reports/CompositeReportRepository.ts)):**
```typescript
async getIncome(householdId: string, query: ReportsIncomeQuery) {
  const cashflow = await this.getCashflow(householdId, query);
  // ❌ Only considers transactions.type = 'income'
  // ❌ Excludes investment_transactions with type = 'dividend', 'interest', 'capital_gain'
}
```

**Missing Data Sources:**
- [`investment_transactions`](../../../shared/schema.ts#L1774) with types:
  - `dividend`: Recurring dividend payments
  - `interest`: Bond/T-Bill interest
  - `capital_gain`: Realized gains from sells

### Requirements

#### 3.1 Income Report Enhancement

**FR-REP-001:** Include investment income in Income reports
**Priority:** MEDIUM
**Acceptance Criteria:**
- [ ] "Income" tab shows investment income as separate category
- [ ] Breakdown: Employment Income, Investment Income (Dividends, Interest, Capital Gains)
- [ ] Total income = transaction income + investment income
- [ ] Filterable by income source type

**Implementation Strategy:**
```typescript
// In ReportRepository.getIncome()
async getIncome(householdId: string, query: ReportsIncomeQuery) {
  // Existing transaction-based income
  const transactionIncome = await this.getCashflow(householdId, query);

  // NEW: Investment income aggregation
  const investmentIncome = await db
    .select({
      date: investmentTransactions.transactionDate,
      type: investmentTransactions.type,
      amount: investmentTransactions.amount,
    })
    .from(investmentTransactions)
    .where(
      and(
        eq(investmentTransactions.householdId, householdId),
        inArray(investmentTransactions.type, ['dividend', 'interest', 'capital_gain']),
        gte(investmentTransactions.transactionDate, query.from),
        lte(investmentTransactions.transactionDate, query.to)
      )
    );

  // Merge and return combined income
  return mergeIncomeSeries(transactionIncome, investmentIncome);
}
```

#### 3.2 Net Worth Report Enhancement

**FR-REP-002:** Ensure Net Worth chart includes investments
**Priority:** HIGH (dependent on FR-NW-001)
**Acceptance Criteria:**
- [ ] Net Worth tab pulls from `netWorthSnapshots` (which now includes investments)
- [ ] Chart annotation shows investment contribution to net worth
- [ ] Asset breakdown pie chart includes "Investment" category

**Notes:**
- This requirement is **automatically satisfied** once FR-NW-001 is implemented
- No additional work required in ReportService

#### 3.3 Tax Report Integration (Optional)

**FR-REP-003:** Add "Tax" tab to main Reports page
**Priority:** LOW
**Acceptance Criteria:**
- [ ] New tab: "Tax" alongside Annual, Cash Flow, etc.
- [ ] Shows tax summary from [`InvestmentTaxService`](../../../server/services/InvestmentTaxService.ts)
- [ ] Displays WHT paid, capital gains, dividend income
- [ ] Export to CSV for ZRA filing

**Rationale:**
- Centralizes all reporting in one place
- Reduces navigation friction during tax season
- Reuses existing [`investment-tax.ts`](../../../server/routes/investment-tax.ts) API

**Alternative Approach:**
Keep tax reports at `/investments/tax` but add a prominent link from Reports page:
```typescript
// In Reports.tsx
<div className="bg-blue-50 border border-blue-200 p-4 rounded-md">
  <p>Tax season? <Link to="/investments/tax">View Investment Tax Reports →</Link></p>
</div>
```

---

## 4. Cross-Cutting Concerns

### 4.1 Currency Consistency

**FR-CUR-001:** Ensure all integrations respect household base currency
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] Investment values converted to household currency before aggregation
- [ ] FX rates consistent across snapshots, dashboard, reports
- [ ] Stale rate handling (fallback to last known rate, warning if > 7 days old)

**Implementation:**
- Reuse [`getLatestFxRates()`](../../../server/modules/investments/investments.routes.ts) helper
- Consider caching FX rates in Redis with daily refresh

### 4.2 Performance Optimization

**FR-PERF-001:** Minimize performance impact on existing features
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] Dashboard load time: < 2 seconds with 50+ holdings
- [ ] Snapshot generation: < 10 seconds for 100+ holdings
- [ ] Reports query: < 3 seconds with 1 year date range

**Strategies:**
- Database indexes on `holdings.household_id`, `holdings.account_id`
- Eager loading with joins (avoid N+1 queries)
- Query result caching for dashboard/reports

### 4.3 Data Migration

**FR-MIG-001:** Backfill historical snapshots with investment data
**Priority:** LOW
**Acceptance Criteria:**
- [ ] One-time migration script to recalculate past snapshots
- [ ] Recalculates snapshots from first investment transaction date
- [ ] Preserves existing account-based snapshot data

**Migration Script Outline:**
```typescript
// migration: backfill-investment-snapshots.ts
async function backfillSnapshots() {
  const households = await db.select().from(households);

  for (const household of households) {
    const firstInvestmentDate = await getFirstInvestmentDate(household.id);
    const snapshotsToUpdate = await db
      .select()
      .from(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.householdId, household.id),
          gte(netWorthSnapshots.date, firstInvestmentDate)
        )
      );

    for (const snapshot of snapshotsToUpdate) {
      const investmentValue = await calculateInvestmentValueAtDate(
        household.id,
        snapshot.date
      );

      await db
        .update(netWorthSnapshots)
        .set({
          totalAssets: snapshot.totalAssets + investmentValue,
          assetsByType: {
            ...snapshot.assetsByType,
            investment: investmentValue,
          },
        })
        .where(eq(netWorthSnapshots.id, snapshot.id));
    }
  }
}
```

### 4.4 Testing Requirements

**FR-TEST-001:** Comprehensive integration tests
**Priority:** HIGH
**Acceptance Criteria:**
- [ ] Unit tests for investment value calculations
- [ ] Integration tests for snapshot generation with holdings
- [ ] E2E tests for dashboard widget display
- [ ] Report accuracy validation tests

**Test Scenarios:**
1. Household with no investments → no change to snapshots
2. Household with multi-currency holdings → correct FX conversion
3. Hidden accounts → excluded from net worth
4. Zero-quantity holdings → excluded from calculations

---

## 5. Implementation Roadmap

### Phase 1: Net Worth Foundation (CRITICAL)
**Duration:** 1 week
**Deliverables:**
- FR-NW-001: Snapshot calculation with investments
- FR-NW-002: Asset type breakdown
- FR-PERF-001: Performance optimization
- FR-TEST-001: Core test coverage

**Success Criteria:**
- Net worth snapshots include investment holdings
- Reports → Net Worth tab shows accurate totals

### Phase 2: Dashboard Visibility (HIGH)
**Duration:** 3-5 days
**Deliverables:**
- FR-DASH-001: Investment widget component
- FR-DASH-002: Dashboard API endpoint
- FR-DASH-003: Widget configuration

**Success Criteria:**
- Dashboard displays investment summary widget
- Users can track portfolio performance at a glance

### Phase 3: Reports Integration (MEDIUM)
**Duration:** 2-3 days
**Deliverables:**
- FR-REP-001: Investment income in reports
- FR-REP-002: Validation (auto-satisfied by Phase 1)
- FR-REP-003: Tax tab (optional)

**Success Criteria:**
- Income reports include dividend/interest income
- Complete financial picture in one Reports page

### Phase 4: Polish & Migration (LOW)
**Duration:** 2-3 days
**Deliverables:**
- FR-MIG-001: Historical snapshot backfill
- FR-CUR-001: Currency consistency validation
- FR-NW-004: Account-level snapshots

**Success Criteria:**
- Historical net worth charts retroactively accurate
- All edge cases handled gracefully

---

## 6. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Net worth accuracy | 100% match with manual calculation | Automated test |
| Dashboard load time | < 2s with 50 holdings | Performance profiling |
| User engagement | 30%+ widget visibility rate | Analytics tracking |
| Report completeness | All income sources included | Data validation |

---

## 7. Open Questions

1. **Snapshot Frequency:** Should investment holdings trigger intraday snapshot updates on price changes?
   - **Recommendation:** No. Keep daily snapshots, use live data for dashboard only.

2. **Private Investments:** How to handle private holdings (e.g., private equity) without market prices?
   - **Recommendation:** Use last manual valuation, flag as "Estimated" in UI.

3. **Tax Report Placement:** Separate page or integrated into main Reports?
   - **Recommendation:** Keep separate initially, add prominent link from Reports.

4. **Historical Backfill:** Required or optional?
   - **Recommendation:** Optional. Nice-to-have for completeness, not blocking.

---

## 8. Dependencies

### Database Schema
- ✅ `holdings` table exists ([schema.ts:1725-1751](../../../shared/schema.ts#L1725-L1751))
- ✅ `securities` table exists with `currentPrice` field
- ✅ `investmentTransactions` table exists
- ✅ `netWorthSnapshots` table supports JSON fields for breakdown

### API Endpoints
- ✅ Investment portfolio summary exists ([investments.routes.ts](../../../server/modules/investments/investments.routes.ts))
- ⚠️ Need dashboard-specific endpoint (lighter payload)
- ⚠️ Need investment income aggregation in reports

### Frontend Hooks
- ✅ `useInvestments` hook exists ([useInvestments.ts](../../../client/src/hooks/useInvestments.ts))
- ⚠️ Need dashboard summary query hook
- ⚠️ Need reports income hook enhancement

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance degradation on snapshot generation | Medium | High | Implement query optimization, indexing, caching |
| FX rate data gaps | Medium | Medium | Fallback to last known rate, manual override option |
| Breaking existing net worth calculations | Low | Critical | Comprehensive test coverage, gradual rollout |
| User confusion with new metrics | Low | Low | Clear UI labels, help tooltips, documentation |

---

## 10. Acceptance Testing Checklist

### Net Worth Integration
- [ ] User with only bank accounts: Net worth unchanged
- [ ] User with 10 stock holdings: Net worth = accounts + (quantity × price × FX)
- [ ] User with hidden investment account: Holdings excluded from net worth
- [ ] Multi-currency portfolio: Correct conversion to base currency
- [ ] Net Worth chart in Reports: Shows upward trend matching portfolio growth

### Dashboard Widget
- [ ] Widget displays on dashboard home page
- [ ] Shows correct total portfolio value
- [ ] Day gain/loss matches Investments page
- [ ] Click-through navigates to `/investments`
- [ ] Widget can be hidden/reordered via customization

### Reports Integration
- [ ] Income tab shows dividend income separately
- [ ] Total income = employment + investment income
- [ ] Tax tab (if implemented) shows WHT, capital gains

---

## 11. Documentation Requirements

**User-Facing:**
- [ ] Update docs/features/feature-showcase.md with investment integration examples
- [ ] Add FAQ: "Why did my net worth suddenly increase?" (backfill explanation)
- [ ] Dashboard widget usage guide

**Developer-Facing:**
- [ ] Update CLAUDE.md with investment calculation logic
- [ ] API documentation for new dashboard endpoints
- [ ] Migration script runbook

---

## 12. Conclusion

This requirements document provides a **complete blueprint** for integrating the Investment module with the broader personal finance app. The phased approach prioritizes critical net worth accuracy (Phase 1) while allowing incremental delivery of dashboard and reporting enhancements.

**Estimated Total Effort:** 12-15 development days
**Key Benefit:** Unified financial view across accounts, investments, goals, and budgets

**Next Steps:**
1. Review and approve requirements
2. Prioritize Phase 1 implementation
3. Schedule technical design review for snapshot calculation
4. Assign development resources

---

**Document Version:** 1.0
**Last Updated:** 2026-01-06
**Author:** Claude Code (Audit & Analysis)
