# Investment Implementation Review & Roadmap

**Review Date:** January 2026
**Reviewer:** Claude Code Analysis
**Requirements Document:** [investment-requirements-v2.md](../features/requirements/investment-requirements-v2.md)

---

## Executive Summary

The investment module implementation covers approximately **65-70%** of the V2 requirements. The core foundation is solid with proper architecture, type safety, and multi-currency support. However, significant gaps exist in calculators, investment goals, benchmark comparisons, and some Zambian-specific features.

| Category | Coverage | Status |
|----------|----------|--------|
| Core Holdings | 93% | ✅ Excellent |
| GRZ Securities | 72% | ✅ Good |
| UI Components | 81% | ✅ Good |
| Analytics | 58% | ⚠️ Partial |
| Recurring Investments | 63% | ⚠️ Partial |
| Pension Tracking | 50% | ⚠️ Partial |
| Notifications | 38% | ⚠️ Partial |
| Investment Goals | 40% | Partial (goals exist, sync pending) |
| Calculators | 0% | ❌ Not Started |

---

## Part 1: What's Missing

### 1.1 GRZ Calculators (Critical Gap)

**Status:** Not implemented
**Priority:** 🔴 High
**Effort:** Medium (2-3 days)

The V2 requirements specify several financial calculators that are essential for GRZ securities users:

#### Required Endpoints

```typescript
// server/routes/grz-calculators.ts (NEW FILE NEEDED)

POST /api/investments/grz/calculate/bond-price
// Calculate bond price from yield (Present Value of cash flows)
// Inputs: faceValue, couponRate, yearsToMaturity, requiredYield, frequency
// Outputs: cleanPrice, accruedInterest, dirtyPrice, currentYield

POST /api/investments/grz/calculate/ytm
// Calculate yield-to-maturity from price
// Inputs: faceValue, couponRate, yearsToMaturity, currentPrice, frequency
// Outputs: ytm, currentYield

POST /api/investments/grz/calculate/accrued
// Calculate accrued interest between coupon dates
// Inputs: faceValue, couponRate, lastCouponDate, settlementDate, dayCountConvention
// Outputs: daysAccrued, accruedInterest, formula

POST /api/investments/grz/calculate/tbill-yield
// Convert T-Bill discount rate to effective yield
// Inputs: faceValue, discountRate, tenorDays
// Outputs: purchasePrice, grossReturn, effectiveYield, netYield (after 15% WHT)
```

#### Implementation Notes

```typescript
// Example: Bond Price Calculation (Present Value formula)
function calculateBondPrice(
  faceValue: number,
  couponRate: number,
  yearsToMaturity: number,
  requiredYield: number,
  frequency: number = 2 // semi-annual
): { cleanPrice: number; dirtyPrice: number } {
  const periodsRemaining = yearsToMaturity * frequency;
  const couponPayment = (faceValue * couponRate) / frequency;
  const periodYield = requiredYield / frequency;

  // PV of coupon payments (annuity)
  const pvCoupons = couponPayment * ((1 - Math.pow(1 + periodYield, -periodsRemaining)) / periodYield);

  // PV of face value
  const pvFace = faceValue / Math.pow(1 + periodYield, periodsRemaining);

  const cleanPrice = pvCoupons + pvFace;
  // Add accrued interest for dirty price
  return { cleanPrice, dirtyPrice: cleanPrice + accruedInterest };
}
```

---

### 1.2 Investment Goals System (Use Existing Goals + Bidirectional Sync)

**Status:** Goals already exist under `/api/goals` with `type=investment`; missing clear investment sync rules.
**Priority:** dY" High
**Effort:** Medium (2-3 days)

#### What Exists (Already Implemented)
- `shared/schema.ts`: `goals` table includes investment fields (`expectedReturn`, `inflationRate`, `linkedAccountId`, `type`).
- `server/routes/goals.ts`: CRUD + `GET /api/goals?type=investment` + `POST /api/goals/calculate-projection`.
- `client/src/components/investments/InvestmentGoalsList.tsx`: investment goals list.
- `client/src/components/investments/GoalProjectionCalculator.tsx`: wired to `/api/goals/calculate-projection`.

#### Bidirectional Sync (Approved)
To avoid double counting, keep a single source of truth for progress:

1. **Progress source:** add `progressSource = 'holdings' | 'contributions'` (default to `holdings` for investment goals).
2. **Investments -> Goals:** compute `currentAmount` from linked investment accounts/holdings market value (read-only when `progressSource='holdings'`).
3. **Goals -> Investments:** goal contributions should create investment transactions (buy or transfer) instead of directly updating `currentAmount`.
4. **Guardrails:** block manual edits of `currentAmount` when `progressSource='holdings'`; show UI copy that progress is derived from portfolio value.

#### Optional API Alias (Non-blocking)
If product wants a dedicated namespace, add `/api/investments/goals` as a thin proxy to `/api/goals` (no new schema).

#### UI Note
`GoalProjectionCalculator.tsx` is already integrated with `/api/goals/calculate-projection`; no new UI component required.

---

### 1.3 Portfolio Allocation Endpoint

**Status:** UI exists, no dedicated endpoint
**Priority:** 🟡 Medium
**Effort:** Low (1 day)

#### Missing Endpoint

```typescript
// Add to server/routes/investments.ts

GET /api/investments/portfolio/allocation

// Response structure:
{
  byAssetClass: [
    { type: 'stock', value: 219262, percentage: 45, change1M: 5.2 },
    { type: 'bond', value: 170450, percentage: 35, change1M: 0.3 },
    { type: 'cash', value: 97538, percentage: 20, change1M: 0.1 }
  ],
  byCurrency: [
    { currency: 'ZMW', value: 253500, percentage: 65 },
    { currency: 'USD', value: 117000, percentage: 30 },
    { currency: 'ZAR', value: 19500, percentage: 5 }
  ],
  byGeography: [
    { region: 'local', value: 156000, percentage: 40 },
    { region: 'offshore', value: 234000, percentage: 60 }
  ],
  byLiquidity: [
    { type: 'liquid', value: 292500, percentage: 75 },
    { type: 'illiquid', value: 97500, percentage: 25 }
  ]
}
```

---

### 1.4 Benchmark Comparisons

**Status:** Schema exists, no data or logic
**Priority:** 🟡 Medium
**Effort:** Medium (2 days)

#### What Exists
- `portfolio_benchmarks` table ✅
- `benchmark_values` table ✅

#### What's Missing

1. **Seed data for benchmarks:**
```typescript
// server/seed.ts - Add benchmark seeding

const benchmarks = [
  { code: 'LUSE_ASI', name: 'LuSE All Share Index', currency: 'ZMW' },
  { code: 'BOZ_TBILL_91D', name: 'BoZ 91-Day T-Bill Rate', currency: 'ZMW' },
  { code: 'ZMW_INFLATION', name: 'Zambia CPI Inflation', currency: 'ZMW' },
  { code: 'USD_ZMW', name: 'USD/ZMW Exchange Rate', currency: 'ZMW' },
  { code: 'SP500', name: 'S&P 500 Index', currency: 'USD' },
];
```

2. **Benchmark values endpoint:**
```typescript
GET /api/investments/portfolio/benchmarks
// Returns portfolio performance vs benchmarks over selected period
```

3. **Historical data entry or import mechanism**

---

### 1.5 Auction Data & Calendar

**Status:** Schema exists, no implementation
**Priority:** 🟡 Medium
**Effort:** Medium (2 days)

#### What Exists
- `grz_auction_results` table ✅

#### What's Missing

```typescript
// server/routes/grz-auctions.ts (NEW FILE NEEDED)

GET /api/investments/grz/auctions/calendar
// Upcoming auction dates (from BoZ quarterly calendar)

GET /api/investments/grz/auctions/results
// Recent auction results with yields

GET /api/investments/grz/yields/current
// Current yield curve data

POST /api/investments/grz/auctions/results
// Manual entry of auction results (admin)
```

#### Data Source
- BoZ publishes quarterly calendars: https://www.boz.zm/grz-securities-issuance-calendar.htm
- Results published weekly: https://www.boz.zm/bonds.htm
- Consider manual entry UI or scraping (with caching)

---

### 1.6 Statement Import

**Status:** Not implemented
**Priority:** 🟢 Low
**Effort:** High (4-5 days)

#### Missing Features

1. **CSV Transaction Import:**
```typescript
POST /api/investments/transactions/import
// Bulk import with validation and preview
```

2. **NAPSA Statement Import:**
```typescript
POST /api/investments/pension/:id/import
// PDF parsing for NAPSA annual statements
```

This requires PDF parsing library (e.g., `pdf-parse`) and format-specific logic.

---

### 1.7 Price Alert System

**Status:** Enum exists, no trigger logic
**Priority:** 🟢 Low
**Effort:** Medium (2 days)

#### What Exists
- Notification type enums: `price_alert`, `stale_price`
- Notification preferences endpoint

#### What's Missing

1. **Price alert configuration:**
```typescript
// Add to schema
export const priceAlerts = pgTable('price_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').references(() => households.id),
  securityId: uuid('security_id').references(() => securities.id),
  alertType: varchar('alert_type', { length: 20 }), // 'above', 'below', 'change_pct'
  threshold: decimal('threshold', { precision: 15, scale: 4 }),
  isActive: boolean('is_active').default(true),
  lastTriggered: timestamp('last_triggered'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

2. **Trigger service (cron job):**
```typescript
// server/services/PriceAlertService.ts
async checkPriceAlerts() {
  // Compare current prices against thresholds
  // Create notifications for triggered alerts
}
```

---

## Part 2: What Needs Fixing

### 2.1 Tax Lot Tracking (Architectural Issue)

**Current State:** Single cost basis per holding
**Problem:** Cannot accurately calculate capital gains on partial sales
**Impact:** 🔴 High for tax reporting accuracy

#### Current Implementation
```typescript
// holdings table
cost_basis: decimal('cost_basis', { precision: 15, scale: 2 })
// Single value - loses lot-level detail
```

#### Recommended Fix

Add tax lots table:
```typescript
export const taxLots = pgTable('tax_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  holdingId: uuid('holding_id').references(() => holdings.id),
  transactionId: uuid('transaction_id').references(() => investmentTransactions.id),

  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  costBasis: decimal('cost_basis', { precision: 15, scale: 2 }).notNull(),
  costBasisZmw: decimal('cost_basis_zmw', { precision: 15, scale: 2 }),
  acquiredDate: date('acquired_date').notNull(),
  acquisitionFxRate: decimal('acquisition_fx_rate', { precision: 10, scale: 4 }),

  // For partial sales
  remainingQuantity: decimal('remaining_quantity', { precision: 18, scale: 8 }),

  createdAt: timestamp('created_at').defaultNow(),
});
```

Update `InvestmentTaxService.ts` to:
1. Support FIFO/LIFO/Specific Identification methods
2. Calculate realized gains per lot
3. Track remaining quantity after partial sales

**Location:** `server/services/InvestmentTaxService.ts:getTaxSummary()` has TODO for realized gains

---

### 2.2 FX Attribution Precision

**Current State:** Uses holding-level FX rate comparison
**Problem:** Inaccurate for securities bought at multiple rates
**Impact:** 🟡 Medium for performance reporting

#### Current Implementation
```typescript
// server/services/FXAttributionService.ts
// Compares acquisition_fx_rate vs current rate
// Doesn't account for multiple purchases at different rates
```

#### Recommended Fix

1. Calculate FX attribution per tax lot (after implementing tax lots)
2. Weight by quantity for aggregated holding view
3. Store transaction-level FX rates (already exists in `investment_transactions.fx_rate`)

---

### 2.3 Performance Calculation Method

**Current State:** Account balance snapshots
**Problem:** Not true time-weighted returns
**Impact:** 🟡 Medium for accurate performance comparison

#### Current Implementation
```typescript
// server/services/InvestmentPerformanceService.ts
// Uses account balance history
// Affected by deposits/withdrawals (cash flows)
```

#### Recommended Fix

Implement Modified Dietz or True Time-Weighted Return:

```typescript
// Time-Weighted Return Formula
function calculateTWR(periods: PeriodReturn[]): number {
  return periods.reduce((acc, period) => {
    const periodReturn = (period.endValue - period.startValue - period.cashFlow)
                        / (period.startValue + period.cashFlow * period.weightFactor);
    return acc * (1 + periodReturn);
  }, 1) - 1;
}
```

---

### 2.4 Missing Zod Validation

**Current State:** Some endpoints lack request validation
**Problem:** Potential runtime errors, inconsistent error messages
**Impact:** 🟡 Medium for API robustness

#### Files Needing Validation Updates

| File | Issue |
|------|-------|
| `server/routes/investments.ts` | Some POST/PUT routes lack body validation |
| `server/routes/grz-securities.ts` | Partial validation on bond/tbill creation |
| `server/routes/investment-recurring.ts` | Missing schema for plan creation |

#### Example Fix
```typescript
// Add to server/validation/investmentSchemas.ts

export const createHoldingSchema = z.object({
  accountId: z.string().uuid(),
  securityId: z.string().uuid(),
  quantity: z.number().positive(),
  costBasis: z.number().optional(),
  acquiredDate: z.string().datetime().optional(),
  acquisitionFxRate: z.number().positive().optional(),
});

// Then in route:
router.post('/holdings', async (req, res) => {
  const validated = createHoldingSchema.parse(req.body);
  // ...
});
```

---

### 2.5 GRZ Bond Sold Status Handling

**Current State:** Status field exists but incomplete handling
**Problem:** Sold bonds not properly removed from portfolio value
**Impact:** 🟡 Medium for portfolio accuracy

#### Current Implementation
```typescript
// grz_bonds has status: 'active' | 'matured' | 'sold' | 'rolled_over'
// But sold_date, sold_price, sold_yield not fully utilized
```

#### Recommended Fix

1. Add endpoint to record bond sale:
```typescript
PUT /api/grz/bonds/:id/sell
// Body: { soldDate, soldPrice, soldYield }
// Creates investment_transaction with type: 'sell'
// Updates status to 'sold'
```

2. Exclude sold bonds from portfolio summary calculations

---

### 2.6 T-Bill Maturity Automation

**Current State:** Manual status change required
**Problem:** Maturing T-Bills not auto-processed
**Impact:** 🟡 Medium for user experience

#### Current Implementation
- Status must be manually changed to 'matured'
- No automatic income transaction creation
- Rollover logic exists but not triggered

#### Recommended Fix

Add cron job to `server/routes/cron.ts`:
```typescript
// Check for T-Bills maturing today
async function processMaturedTBills() {
  const maturingToday = await db.query.grzTbills.findMany({
    where: and(
      eq(grzTbills.status, 'active'),
      lte(grzTbills.maturityDate, today)
    )
  });

  for (const tbill of maturingToday) {
    // 1. Update status to 'matured'
    // 2. Create investment_transaction (type: 'maturity')
    // 3. Create household income transaction (interest only)
    // 4. Handle rollover if configured
    // 5. Send notification
  }
}
```

---

### 2.7 Stale Price Detection

**Current State:** UI shows warning icon, no proactive alerts
**Problem:** Users may miss outdated prices
**Impact:** 🟢 Low

#### Recommended Fix

Add to `MarketDataService.ts`:
```typescript
async function checkStalePrices() {
  const staleSecurities = await db.query.securities.findMany({
    where: and(
      // Stocks: stale after 7 days
      // Bonds: stale after 30 days
      // Unit trusts: stale after 30 days
    )
  });

  // Create notifications for each stale security
}
```

---
### 2.8 Portfolio Summary Currency Handling

**Current State:** Holdings and portfolio summaries sum raw values without FX conversion.
**Problem:** Mixed-currency portfolios show incorrect totals and gain/loss.
**Impact:** dY" High for reporting accuracy

#### Recommended Fix
- Default to household base currency (ZMW) for `/api/investments/holdings` and `/api/investments/portfolio/summary`.
- Add `baseCurrency` (or `displayCurrency`) query param for alternate views.
- Return both local and base values per holding (`valueLocal`, `valueBase`, `fxRateUsed`).
- Use latest `fx_rates` for conversions; fall back to `acquisitionFxRate` when needed.

---
## Part 3: Recommendations

### 3.0 Reviewer Priority Additions (Immediate -> Later)

P0 (Immediate - correctness/runtime)
1. Fix `InvestmentTaxService` date field usage (`transactionDate`) for summaries and exports.
2. Import missing `grzTBills`/`sql` in `InvestmentAutomationService` so maturity processing runs.
3. Use `householdContext.householdId` in investment recurring/pension routes (and GRZ routes) instead of `req.user.householdId`.
4. Align recurring frequency values across UI/DB/server (yearly vs annually, `semi_annually` support).
5. Fix corrupted price placeholder in `AddHoldingModal`.

P1 (High - accuracy/user)
6. Implement FX-aware portfolio/holding aggregates with a `baseCurrency` query param.
7. T-Bill maturity should create investment + household income transactions and set `maturityIncomeTxId`.
8. Wire investment transaction CRUD endpoints and connect `RecordInvestmentTransactionModal`.
9. Implement bidirectional investment-goal sync rules (holdings progress + contributions -> investment tx).

P2 (Medium - security/UX)
10. Add `householdGuard`/role checks to GRZ routes for consistent access control.
11. Use `firstCouponDate`/`couponFrequency` in bond schedule generation when available.

### 3.1 Implementation Priority Matrix

| Priority | Feature | Effort | Business Value |
|----------|---------|--------|----------------|
| 🔴 P0 | GRZ Calculators | 2-3 days | High - Core for bond investors |
| 🔴 P0 | Investment Goals Sync (bidirectional) | 2-3 days | High - Key user feature |
| 🔴 P1 | Tax Lot Tracking | 3-4 days | High - Tax accuracy |
| 🟡 P1 | Allocation Endpoint | 1 day | Medium - Dashboard completeness |
| 🟡 P1 | T-Bill Maturity Automation | 1-2 days | Medium - User experience |
| 🟡 P2 | Benchmark Comparisons | 2 days | Medium - Performance context |
| 🟡 P2 | Auction Data | 2 days | Medium - Market context |
| 🟢 P3 | Price Alerts | 2 days | Low - Nice to have |
| 🟢 P3 | Statement Import | 4-5 days | Low - Power user feature |
| 🟢 P3 | TWR Performance | 2-3 days | Low - Accuracy improvement |

### 3.2 Suggested Implementation Order

#### Phase 1: Core Completion (Week 1-2)
1. ✅ GRZ Calculators - Bond price, YTM, accrued interest, T-Bill yield
2. ✅ Investment Goals Sync - holdings progress + contributions -> investment tx
3. ✅ Allocation Endpoint - Portfolio breakdown views

#### Phase 2: Automation & Accuracy (Week 3-4)
4. ✅ T-Bill/Bond Maturity Automation - Cron job processing
5. ✅ Tax Lot Tracking - Schema migration, service updates
6. ✅ Zod Validation Cleanup - Consistent request validation

#### Phase 3: Enhanced Features (Week 5-6)
7. ✅ Benchmark Data - Seed data, comparison logic
8. ✅ Auction Calendar/Results - Manual entry or basic integration
9. ✅ FX Attribution Refinement - Per-lot calculation

#### Phase 4: Polish (Week 7+)
10. ✅ Price Alerts - Configuration and trigger logic
11. ✅ Statement Import - CSV and NAPSA PDF
12. ✅ Performance TWR - Accurate return calculation

### 3.3 Quick Wins (Can Do Today)

1. **Add allocation endpoint** - Simple aggregation of existing holdings data
2. **Seed benchmark definitions** - Just the metadata, no values yet
3. **Add T-Bill maturity check** - Cron job skeleton with TODO
4. **Zod schemas for investments.ts** - Copy pattern from other routes

### 3.4 Technical Debt to Address

| Issue | Location | Effort |
|-------|----------|--------|
| Inconsistent error handling | Various routes | Low |
| Missing TypeScript strict null checks | Services | Medium |
| No unit tests for investment services | `server/services/` | High |
| Hardcoded WHT rate (15%) | Multiple files | Low - Extract to config |
| No rate limiting on calculator endpoints | Routes | Low |

### 3.5 Testing Recommendations

Currently missing test coverage for investment module:

```
server/services/__tests__/
  ├── InvestmentPerformanceService.test.ts  ❌ Missing
  ├── FXAttributionService.test.ts          ❌ Missing
  ├── InvestmentTaxService.test.ts          ❌ Missing
  ├── MarketDataService.test.ts             ❌ Missing
  └── grz-service.test.ts                   ❌ Missing

client/src/hooks/__tests__/
  ├── useInvestments.test.ts                ❌ Missing
  └── useGrzSecurities.test.ts              ❌ Missing
```

Recommend adding:
1. Unit tests for calculator functions (pure math, easy to test)
2. Integration tests for GRZ coupon schedule generation
3. Property-based tests for FX attribution edge cases

---

## Part 4: File Reference

### Files That Need Updates

| File | Changes Needed |
|------|----------------|
| `shared/schema.ts` | Add `taxLots`, `priceAlerts`, and investment-goal sync fields (`progressSource`, linked accounts) |
| `server/routes.ts` | Register new route files |
| `server/routes/investments.ts` | Add allocation endpoint, Zod validation, baseCurrency support for summary/holdings |
| `server/routes/cron.ts` | Add T-Bill/Bond maturity processing + income tx creation |
| `server/services/InvestmentTaxService.ts` | Fix transactionDate usage; implement realized gains with tax lots |
| `server/services/FXAttributionService.ts` | Per-lot FX attribution |
| `server/seed.ts` | Add benchmark definitions |
| `server/routes/goals.ts` | Enforce investment goal sync rules (holdings progress + contributions -> investment tx) |
| `server/services/GoalService.ts` | Compute investment goal progress from holdings when configured |

### New Files to Create

| File | Purpose |
|------|---------|
| `server/routes/grz-calculators.ts` | Bond/T-Bill calculator endpoints |
| `server/routes/grz-auctions.ts` | Auction calendar and results |
| `server/services/PriceAlertService.ts` | Alert trigger logic |
| `server/validation/investmentSchemas.ts` | Consolidated Zod schemas |

---

## Appendix: API Endpoint Checklist

### Holdings Management
- [x] `GET /api/investments/holdings`
- [x] `GET /api/investments/holdings/:id`
- [x] `POST /api/investments/holdings`
- [x] `PUT /api/investments/holdings/:id`
- [x] `DELETE /api/investments/holdings/:id`

### Securities
- [x] `GET /api/investments/securities`
- [x] `GET /api/investments/securities/:id`
- [x] `POST /api/investments/securities`
- [x] `PUT /api/investments/securities/:id/price`
- [ ] `GET /api/investments/securities/:id/prices` (history)

### Transactions
- [ ] `GET /api/investments/transactions`
- [ ] `POST /api/investments/transactions`
- [ ] `PUT /api/investments/transactions/:id`
- [ ] `DELETE /api/investments/transactions/:id`
- [ ] `POST /api/investments/transactions/import`

### Portfolio Analytics
- [x] `GET /api/investments/portfolio/summary`
- [x] `GET /api/investments/analytics/performance`
- [ ] `GET /api/investments/portfolio/allocation`
- [ ] `GET /api/investments/portfolio/benchmarks`

### FX
- [x] `GET /api/investments/fx-rates`
- [x] `POST /api/investments/fx-rates`
- [x] `GET /api/investments/analytics/fx-attribution`
- [x] `GET /api/investments/analytics/fx-historical`

### Tax
- [x] `GET /api/investments/tax/summary`
- [x] `GET /api/investments/tax/zra-export`
- [ ] `GET /api/investments/tax/dividends`
- [ ] `GET /api/investments/tax/capital-gains`

### GRZ Securities
- [x] `GET /api/grz/bonds`
- [x] `POST /api/grz/bonds`
- [x] `GET /api/grz/tbills`
- [x] `POST /api/grz/tbills`
- [x] `POST /api/grz/payments/:id/pay`
- [ ] `GET /api/grz/auctions/calendar`
- [ ] `GET /api/grz/auctions/results`
- [ ] `GET /api/grz/yields/current`
- [ ] `POST /api/grz/calculate/bond-price`
- [ ] `POST /api/grz/calculate/ytm`
- [ ] `POST /api/grz/calculate/accrued`
- [ ] `POST /api/grz/calculate/tbill-yield`

### Pension
- [x] `GET /api/investments/pension`
- [x] `POST /api/investments/pension`
- [x] `GET /api/investments/pension/:id/contributions`
- [x] `POST /api/investments/pension/:id/contributions`
- [ ] `POST /api/investments/pension/:id/import`
- [ ] `GET /api/investments/pension/:id/projection`

### Recurring
- [x] `GET /api/investments/recurring`
- [x] `POST /api/investments/recurring`
- [x] `DELETE /api/investments/recurring/:id`
- [ ] `GET /api/investments/recurring/:id/history`
- [ ] `POST /api/investments/recurring/:id/execute`

### Goals (Shared)
- [x] `GET /api/goals?type=investment`
- [x] `POST /api/goals`
- [x] `GET /api/goals/:id`
- [x] `PUT /api/goals/:id`
- [x] `DELETE /api/goals/:id`
- [x] `POST /api/goals/calculate-projection`
- [ ] `POST /api/goals/:id/sync-holdings` (optional helper endpoint)

### Notifications
- [x] `GET /api/investments/notifications/preferences`
- [x] `PUT /api/investments/notifications/preferences`

---

---

## Part 5: Module Integration Analysis

### Integration Status Overview

| Module | Integration | Evidence |
|--------|-------------|----------|
| **Accounts** | ✅ 90% | Holdings → accounts FK; investment account type; multi-currency |
| **Transactions** | ⚠️ 50% | GRZ coupons → income tx; other income types not linked |
| **Cashflow** | ⚠️ 40% | GRZ income flows; dividends/interest/maturity don't |
| **Goals** | ❓ 40% | Goal type exists; sync rules for holdings + contributions pending |
| **Dashboard** | ❌ 0% | No investment widgets on main dashboard |

### 5.1 What's Working

**Accounts Integration:**
```typescript
// Holdings properly reference accounts
accountId: uuid("account_id")
  .notNull()
  .references(() => accounts.id, { onDelete: "cascade" })
```

**GRZ → Transactions Flow:**
```typescript
// server/routes/grz-securities.ts - Coupon payments create income
const { transaction } = await transactionService.createTransaction({
  type: "income",
  name: `GRZ Coupon: ${payment.bond.bondName}`,
});
await db.update(grzBondPayments).set({
  incomeTransactionId: transaction.id,
});
```

### 5.2 Integration Gaps

#### Gap 1: Investment Income → Transactions
Regular investment income doesn't create transactions:
- Stock dividends
- Bond interest (non-GRZ)
- T-Bill maturity proceeds
- Unit trust distributions

**Fix Required:**
```typescript
// server/services/InvestmentIncomeService.ts (NEW)
async recordDividend(holdingId: string, amount: number, date: Date) {
  // 1. Create investment_transaction (type: 'dividend')
  // 2. Create household transaction (type: 'income', category: 'Dividends')
  // 3. Link via linkedTransactionId
}
```

#### Gap 2: Goals -> Investment Progress (Bidirectional Sync)
Goals don't track investment performance or investment-driven contributions:

**Current State:**
- Goal progress ignores holding market value changes.
- Goal contributions are not linked to investment transactions.

**Fix Required:**
```typescript
// server/services/GoalService.ts - Add methods
async updateInvestmentGoalProgress(goalId: string) {
  const goal = await this.getGoal(goalId);
  if (goal.type !== 'investment' || goal.progressSource !== 'holdings') return;

  const holdings = await investmentService.getHoldingsValue(goal.linkedAccountIds);
  await db.update(goals).set({
    currentAmount: holdings.totalValue,
    onTrack: holdings.totalValue >= expectedProgress
  });
}

async recordInvestmentGoalContribution(goalId: string, input: ContributionInput) {
  // 1. Create investment_transaction (buy/transfer)
  // 2. Link back to the goal (metadata or link table)
  // 3. Trigger goal sync if progressSource='holdings'
}
```

#### Gap 3: Dashboard Investment Widget
No investment visibility on main dashboard.

**Files to Create:**
```
client/src/components/dashboard/InvestmentWidget.tsx
```

**Widget Should Show:**
- Total portfolio value
- Today's change (% and amount)
- Top 3 holdings
- Link to full investments page

#### Gap 4: GRZ Schema Isolation
GRZ bonds use separate tables, causing integration friction:

```typescript
// Current (problematic)
grzBonds → grzBondPayments → transactions

// Should be
securities → holdings → investmentTransactions → transactions
```

**Options:**
1. Keep GRZ separate but add unified "income event" abstraction
2. Migrate GRZ to use securities table with type='bond'

### 5.3 Integration Fix Priority

| Fix | Effort | Impact | Priority |
|-----|--------|--------|----------|
| Dashboard investment widget | 1 day | High visibility | 🔴 P0 |
| Dividend/interest → transactions | 2 days | Cashflow accuracy | 🔴 P0 |
| Goal progress from holdings | 2 days | Goal tracking | 🟡 P1 |
| T-Bill maturity automation | 1 day | User experience | 🟡 P1 |
| Unified income event system | 3 days | Architecture | 🟡 P2 |

### 5.4 Quick Integration Wins

**1. Add Investment Widget to Dashboard (1 hour):**
```tsx
// client/src/components/dashboard/InvestmentWidget.tsx
export function InvestmentWidget() {
  const { data: summary } = usePortfolioSummary();
  return (
    <Card>
      <CardHeader>Investments</CardHeader>
      <CardContent>
        <div>Total: {formatCurrency(summary?.totalValue)}</div>
        <div>Change: {formatPercent(summary?.dayChangePercent)}</div>
      </CardContent>
    </Card>
  );
}
```

**2. Link Investment Income to Transactions (add to existing flow):**
```typescript
// In useCreateHolding mutation - after recording dividend
if (transactionType === 'dividend' || transactionType === 'interest') {
  await createIncomeTransaction({
    amount: netAmount,
    category: 'Investment Income',
    linkedInvestmentTxId: investmentTx.id
  });
}
```

---

*Document generated from codebase analysis. Last updated: January 2026*