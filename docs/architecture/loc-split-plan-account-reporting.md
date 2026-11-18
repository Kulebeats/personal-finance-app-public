# Account Reporting Service LOC Split Plan

**Current:** 562 LOC (exceeds 500 LOC limit)
**Target:** 3 files, each <300 LOC
**Status:** Ready for implementation
**Date:** 2026-02-01

---

## Current Structure Analysis

File: `server/services/reports/AccountReportingService.ts` (562 LOC)

**Methods:**
- `getNetWorth()` - ~60 LOC
- `getNetWorthHistory()` - ~80 LOC
- `getBalanceHistory()` - ~70 LOC
- `getAccountPerformance()` - ~90 LOC
- `getAssetAllocation()` - ~70 LOC
- `getCashflowProjection()` - ~90 LOC
- `getAccountSummary()` - ~50 LOC
- Helper methods - ~52 LOC

---

## Proposed Split

### File 1: `reports/account/snapshot.service.ts` (~180 LOC)

**Purpose:** Current state snapshots (point-in-time data)

**Contents:**
```typescript
/**
 * Account Snapshot Service
 *
 * Handles current-state account reporting (net worth, balances, summaries).
 */

import { Money } from "../../../core/money";
import { accountRepository } from "../../../repositories/AccountRepository";
import { holdingRepository } from "../../../repositories/HoldingRepository";

export class AccountSnapshotService {
  /**
   * Get current net worth across all accounts
   */
  async getNetWorth(householdId: string): Promise<{
    totalAssets: Money;
    totalLiabilities: Money;
    netWorth: Money;
    asOfDate: string;
  }> {
    // Copy implementation from original getNetWorth()
  }

  /**
   * Get summary for a single account
   */
  async getAccountSummary(
    accountId: string,
    householdId: string
  ): Promise<{
    balance: Money;
    pendingBalance: Money;
    currency: string;
    lastUpdated: string;
  }> {
    // Copy implementation from original getAccountSummary()
  }

  /**
   * Get asset allocation breakdown
   */
  async getAssetAllocation(householdId: string): Promise<{
    cash: Money;
    stocks: Money;
    bonds: Money;
    realEstate: Money;
    other: Money;
  }> {
    // Copy implementation from original getAssetAllocation()
  }
}

export const accountSnapshotService = new AccountSnapshotService();
```

**Methods:**
- `getNetWorth()` - Current total net worth
- `getAccountSummary()` - Single account summary
- `getAssetAllocation()` - Asset breakdown

**Dependencies:**
- accountRepository
- holdingRepository
- Money class

---

### File 2: `reports/account/history.service.ts` (~200 LOC)

**Purpose:** Historical trends and time-series data

**Contents:**
```typescript
/**
 * Account History Service
 *
 * Handles historical account reporting (trends, time-series analysis).
 */

import { Money } from "../../../core/money";
import { accountRepository } from "../../../repositories/AccountRepository";
import { snapshotRepository } from "../../../repositories/SnapshotRepository";

export class AccountHistoryService {
  /**
   * Get net worth history over time
   */
  async getNetWorthHistory(
    householdId: string,
    startDate: string,
    endDate: string,
    interval: "daily" | "weekly" | "monthly"
  ): Promise<Array<{
    date: string;
    netWorth: Money;
    assets: Money;
    liabilities: Money;
  }>> {
    // Copy implementation from original getNetWorthHistory()
  }

  /**
   * Get balance history for an account
   */
  async getBalanceHistory(
    accountId: string,
    householdId: string,
    startDate: string,
    endDate: string
  ): Promise<Array<{
    date: string;
    balance: Money;
  }>> {
    // Copy implementation from original getBalanceHistory()
  }

  /**
   * Get account performance metrics over time
   */
  async getAccountPerformance(
    accountId: string,
    householdId: string,
    startDate: string,
    endDate: string
  ): Promise<{
    startBalance: Money;
    endBalance: Money;
    netChange: Money;
    percentChange: number;
    roi: number;
  }> {
    // Copy implementation from original getAccountPerformance()
  }
}

export const accountHistoryService = new AccountHistoryService();
```

**Methods:**
- `getNetWorthHistory()` - Net worth over time
- `getBalanceHistory()` - Account balance over time
- `getAccountPerformance()` - Performance metrics

**Dependencies:**
- accountRepository
- snapshotRepository
- Money class

---

### File 3: `reports/account/projection.service.ts` (~150 LOC)

**Purpose:** Future projections and forecasting

**Contents:**
```typescript
/**
 * Account Projection Service
 *
 * Handles account projections and cashflow forecasting.
 */

import { Money } from "../../../core/money";
import { accountRepository } from "../../../repositories/AccountRepository";
import { transactionRepository } from "../../../repositories/TransactionRepository";

export class AccountProjectionService {
  /**
   * Project future cashflow based on historical patterns
   */
  async getCashflowProjection(
    householdId: string,
    startDate: string,
    endDate: string
  ): Promise<Array<{
    date: string;
    projectedIncome: Money;
    projectedExpenses: Money;
    projectedNetFlow: Money;
    confidence: number;
  }>> {
    // Copy implementation from original getCashflowProjection()
  }

  /**
   * Calculate projection confidence based on data consistency
   */
  private calculateConfidence(
    historicalData: any[],
    variance: number
  ): number {
    // Copy from helper methods
  }
}

export const accountProjectionService = new AccountProjectionService();
```

**Methods:**
- `getCashflowProjection()` - Future cashflow forecast
- `calculateConfidence()` - Projection reliability

**Dependencies:**
- accountRepository
- transactionRepository
- Money class

---

### File 4: `reports/AccountReportingService.ts` (update to unified interface)

**Purpose:** Backward-compatible unified interface

**Contents:**
```typescript
/**
 * Account Reporting Service - Unified Interface
 *
 * Combines account reporting sub-services into a single interface.
 * Split from monolithic service (562 LOC) into focused modules (2026-02-01).
 *
 * @module services/reports/AccountReportingService
 */

import { Money } from "../../core/money";
import { accountSnapshotService } from "./account/snapshot.service";
import { accountHistoryService } from "./account/history.service";
import { accountProjectionService } from "./account/projection.service";

export class AccountReportingService {
  // Snapshot operations
  async getNetWorth(householdId: string) {
    return accountSnapshotService.getNetWorth(householdId);
  }

  async getAccountSummary(accountId: string, householdId: string) {
    return accountSnapshotService.getAccountSummary(accountId, householdId);
  }

  async getAssetAllocation(householdId: string) {
    return accountSnapshotService.getAssetAllocation(householdId);
  }

  // History operations
  async getNetWorthHistory(
    householdId: string,
    startDate: string,
    endDate: string,
    interval: "daily" | "weekly" | "monthly"
  ) {
    return accountHistoryService.getNetWorthHistory(householdId, startDate, endDate, interval);
  }

  async getBalanceHistory(
    accountId: string,
    householdId: string,
    startDate: string,
    endDate: string
  ) {
    return accountHistoryService.getBalanceHistory(accountId, householdId, startDate, endDate);
  }

  async getAccountPerformance(
    accountId: string,
    householdId: string,
    startDate: string,
    endDate: string
  ) {
    return accountHistoryService.getAccountPerformance(accountId, householdId, startDate, endDate);
  }

  // Projection operations
  async getCashflowProjection(
    householdId: string,
    startDate: string,
    endDate: string
  ) {
    return accountProjectionService.getCashflowProjection(householdId, startDate, endDate);
  }
}

export const accountReportingService = new AccountReportingService();

// Export sub-services for direct access
export { accountSnapshotService } from "./account/snapshot.service";
export { accountHistoryService } from "./account/history.service";
export { accountProjectionService } from "./account/projection.service";
```

---

## Implementation Steps

1. **Create directory structure:**
   ```bash
   mkdir -p server/services/reports/account
   ```

2. **Create snapshot service:**
   - Extract getNetWorth, getAccountSummary, getAssetAllocation
   - Move to `account/snapshot.service.ts`

3. **Create history service:**
   - Extract getNetWorthHistory, getBalanceHistory, getAccountPerformance
   - Move to `account/history.service.ts`

4. **Create projection service:**
   - Extract getCashflowProjection + helpers
   - Move to `account/projection.service.ts`

5. **Update main service:**
   - Replace with delegation pattern (see File 4 above)
   - Archive old file as `AccountReportingService.ts.legacy`

6. **Verify:**
   ```bash
   npm run check
   npm run test:server:run -- services/reports
   ```

---

## Expected Results

| File | Current LOC | New LOC | Status |
|------|-------------|---------|--------|
| account/snapshot.service.ts | - | ~180 | ✅ Under limit |
| account/history.service.ts | - | ~200 | ✅ Under limit |
| account/projection.service.ts | - | ~150 | ✅ Under limit |
| AccountReportingService.ts (index) | 562 | ~80 | ✅ Under limit |

**Total:** 610 LOC across 4 files (vs 562 in monolithic file)

---

## Testing Checklist

After implementation:
- [ ] TypeScript compiles without errors
- [ ] All report endpoints still work
- [ ] Money class usage preserved
- [ ] No precision loss in calculations
- [ ] Integration tests pass
- [ ] Report generation performance unchanged

---

## Notes

- Keep Money class usage throughout - NO .toNumber() in calculations
- Maintain audit logging where present
- Preserve error handling patterns
- Keep cache invalidation logic intact
