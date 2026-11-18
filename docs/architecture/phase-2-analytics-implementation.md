# Phase 2: Analytics & Reports - Complete Implementation Plan

**Version**: 1.0
**Aligned with**: `docs/implementation-plan-v7-final.md`, `docs/analytics-reporting-architecture.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Review Required](#2-user-review-required)
3. [Architecture](#3-architecture)
4. [Implementation Phases](#4-implementation-phases)
5. [Endpoint Specifications](#5-endpoint-specifications)
6. [SQL Query Patterns](#6-sql-query-patterns)
7. [Caching Strategy](#7-caching-strategy)
8. [Rate Limiting](#8-rate-limiting)
9. [Verification Plan](#9-verification-plan)
10. [File Checklist](#10-file-checklist)

---

## 1. Overview

### Scope
Implement all 9 analytics endpoints defined in V7:

| Endpoint | Priority | Complexity |
|----------|----------|------------|
| `/api/reports/spending/breakdown` | P0 | Medium |
| `/api/reports/cashflow` | P0 | Medium |
| `/api/reports/net-worth` | P0 | High |
| `/api/reports/income` | P1 | Low (reuses cashflow) |
| `/api/reports/savings-rate` | P1 | Low (derives from cashflow) |
| `/api/reports/spending/trend` | P1 | Medium |
| `/api/reports/annual` | P2 | High (composite) |
| `/api/reports/sankey` | P2 | High |
| `/api/reports/transactions` | P2 | Medium (pagination) |

### Dependencies
- Phase 1 complete (Accounts, Transactions CRUD)
- Critical indexes applied (`migrations/phase-0a-critical-indexes.sql`)
- Redis configured (optional but recommended for caching)

---

## 2. User Review Required

### 2.1 Net Worth Calculation Strategy

**Decision**: Use **Snapshot-First with Reverse Playback Fallback**

```
1. Query net_worth_snapshots table for requested date range
2. If snapshots exist → return directly (fast path)
3. If snapshots missing → compute via reverse playback:
   a. Get current account balances
   b. Replay transactions backwards to reconstruct historical balances
4. Account visibility: respect is_private + is_hidden flags
```

**Assumption**: `accounts.balance` is currently accurate. If not, run reconciliation first.

### 2.2 Split Transaction Handling

**Decision**: Analytics will aggregate at the split level when splits exist.

```
- If transaction has splits → use split amounts/categories
- If no splits → use parent transaction amount/category
- SQL pattern: LEFT JOIN + COALESCE
```

### 2.3 Transfer Handling

**Decision**: Exclude transfers by default per Canonical Invariant 4.

```
- Default: type <> 'transfer'
- With includeTransfers=true: include all types
- Balance adjustments always excluded from income/expense totals
```

### 2.4 Date Range Limits

**Decision**: Maximum 5 years per V7 spec.

```
- Validate: (to - from) <= 1826 days
- Reject requests exceeding limit with INVALID_DATE_RANGE error
```

---

## 3. Architecture

### 3.1 Layer Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    Routes (reports.ts)                       │
│  - Parse query params with Zod                               │
│  - Apply rate limiting                                       │
│  - Call AnalyticsService                                     │
│  - Return standardized response                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  AnalyticsService.ts                         │
│  - Business logic orchestration                              │
│  - Cache check/populate via AnalyticsCache                   │
│  - Build query params for Repository                         │
│  - Format response for charts                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  ReportRepository.ts                         │
│  - Execute SQL queries via Drizzle                           │
│  - Apply base filters                                        │
│  - Handle splits aggregation                                 │
│  - Return raw data                                           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Base Filters (Apply to ALL Queries)

Every analytics query MUST include these filters:

```typescript
interface BaseAnalyticsFilters {
  householdId: string;           // Canonical Invariant 1
  userId: string;                // For visibility/scope
  from: string;                  // YYYY-MM-DD
  to: string;                    // YYYY-MM-DD
  scope?: 'household' | 'mine';  // Default: household
  includePending?: boolean;      // Default: false
  includeTransfers?: boolean;    // Default: false
}
```

**SQL WHERE clause template**:

```sql
WHERE t.household_id = $householdId
  AND t.deleted_at IS NULL
  AND t.is_excluded_from_reports = FALSE
  AND t.date BETWEEN $from AND $to
  AND ($includePending = TRUE OR t.is_pending = FALSE)
  AND ($includeTransfers = TRUE OR t.type <> 'transfer')
  AND ($scope = 'household' OR t.owner_user_id = $userId)
  -- Account visibility (for transaction queries):
  AND (a.is_private = FALSE OR a.owner_user_id = $userId)
```

---

## 4. Implementation Phases

### Phase 2A: Infrastructure (Days 1-2)

#### 2A.1 Rate Limiting Middleware

**File**: `server/middleware/analyticsRateLimit.ts`

```typescript
import rateLimit from 'express-rate-limit';

// Standard analytics rate limit: 30 req/min/user
export const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Analytics rate limit exceeded. Please wait before requesting more reports.',
    },
  },
});

// Strict limit for expensive endpoints: 10 req/min/user
export const expensiveAnalyticsLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'This report is rate limited. Please wait before requesting again.',
    },
  },
});
```

#### 2A.2 Analytics Cache Service

**File**: `server/services/AnalyticsCache.ts`

```typescript
import { redis } from '../config/redis';
import { createHash } from 'crypto';

const CACHE_VERSION = 1; // Increment to invalidate all caches

const CACHE_TTLS: Record<string, number> = {
  dashboard: 300,        // 5 min
  cashflow: 300,         // 5 min
  spendingBreakdown: 300,// 5 min
  spendingTrend: 180,    // 3 min
  annual: 900,           // 15 min
  netWorth: 600,         // 10 min
  sankey: 600,           // 10 min
  income: 300,           // 5 min
  savingsRate: 300,      // 5 min
  transactions: 60,      // 1 min
};

export class AnalyticsCache {
  private generateKey(
    endpoint: string,
    householdId: string,
    params: Record<string, unknown>
  ): string {
    const hash = createHash('md5')
      .update(JSON.stringify(params))
      .digest('hex')
      .substring(0, 12);
    return `analytics:${endpoint}:${householdId}:v${CACHE_VERSION}:${hash}`;
  }

  async getOrCompute<T>(
    endpoint: keyof typeof CACHE_TTLS,
    householdId: string,
    params: Record<string, unknown>,
    compute: () => Promise<T>
  ): Promise<T> {
    if (!redis) {
      // Redis not configured, compute directly
      return compute();
    }

    const key = this.generateKey(endpoint, householdId, params);
    const ttl = CACHE_TTLS[endpoint] || 300;

    // Try cache first
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // Compute and cache
    const result = await compute();
    await redis.setex(key, ttl, JSON.stringify(result));
    return result;
  }

  async invalidateHousehold(householdId: string): Promise<void> {
    if (!redis) return;

    // Use SCAN instead of KEYS for production safety
    const pattern = `analytics:*:${householdId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  async invalidateEndpoint(endpoint: string, householdId: string): Promise<void> {
    if (!redis) return;

    const pattern = `analytics:${endpoint}:${householdId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

export const analyticsCache = new AnalyticsCache();
```

#### 2A.3 Cache Invalidation Triggers

**File**: `server/services/CacheInvalidation.ts`

```typescript
import { analyticsCache } from './AnalyticsCache';

const INVALIDATION_MAP = {
  transaction: [
    'cashflow', 'spendingBreakdown', 'spendingTrend',
    'annual', 'sankey', 'income', 'savingsRate', 'transactions'
  ],
  account: ['netWorth', 'dashboard'],
  category: ['spendingBreakdown', 'annual', 'sankey'],
  budget: ['dashboard'],
} as const;

export async function invalidateOnChange(
  entity: keyof typeof INVALIDATION_MAP,
  householdId: string
): Promise<void> {
  const endpoints = INVALIDATION_MAP[entity];
  await Promise.all(
    endpoints.map(endpoint => analyticsCache.invalidateEndpoint(endpoint, householdId))
  );
}
```

#### 2A.4 Hard Caps Validation

**File**: `server/validation/analyticsValidation.ts`

```typescript
import { z } from 'zod';

// Max date range: 5 years (1826 days)
const MAX_DATE_RANGE_DAYS = 1826;
const MAX_LIMIT = 200;
const MAX_NODES = 200;

export function validateDateRange(from: string, to: string): void {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (fromDate > toDate) {
    throw new ValidationError('Start date must be before end date', {
      from: 'Must be before end date',
    });
  }

  const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > MAX_DATE_RANGE_DAYS) {
    throw new ValidationError('Date range exceeds maximum of 5 years', {
      dateRange: `Maximum ${MAX_DATE_RANGE_DAYS} days allowed`,
    });
  }
}

export function validateLimit(limit: number | undefined): number {
  const safeLimit = limit ?? 50;
  if (safeLimit > MAX_LIMIT) {
    throw new ValidationError(`Limit cannot exceed ${MAX_LIMIT}`, {
      limit: `Maximum ${MAX_LIMIT} allowed`,
    });
  }
  return safeLimit;
}

export function validateMaxNodes(maxNodes: number | undefined): number {
  const safeNodes = maxNodes ?? 25;
  if (safeNodes > MAX_NODES) {
    throw new ValidationError(`maxNodes cannot exceed ${MAX_NODES}`, {
      maxNodes: `Maximum ${MAX_NODES} allowed`,
    });
  }
  return safeNodes;
}
```

---

### Phase 2B: Core Reports (Days 3-5)

#### 2B.1 Spending Breakdown

**Endpoint**: `GET /api/reports/spending/breakdown`

**Query Params**:
- `from`, `to` (required)
- `groupBy`: `categoryGroup` | `category` | `merchant` | `tag` (default: categoryGroup)
- `limit`: 1-200 (default: 10)
- `includeOther`: boolean (default: true)
- `scope`, `includePending`, `includeTransfers`

**Response**:
```typescript
interface SpendingBreakdownResponse {
  range: { from: string; to: string; currency: string };
  groupBy: string;
  total: number;
  items: Array<{
    id: string;
    label: string;
    value: number;
    percent: number;
    color?: string;
    entityType: 'categoryGroup' | 'category' | 'merchant' | 'tag';
    entityId: string;
  }>;
}
```

#### 2B.2 Cashflow

**Endpoint**: `GET /api/reports/cashflow`

**Query Params**:
- `from`, `to` (required)
- `interval`: `day` | `week` | `month` (default: month)
- `scope`, `includePending`, `includeTransfers`

**Response**:
```typescript
interface CashflowResponse {
  range: { from: string; to: string; interval: string; currency: string };
  series: Array<{
    periodStart: string;
    periodEnd: string;
    label: string;
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  }>;
  totals: {
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  };
}
```

#### 2B.3 Income

**Endpoint**: `GET /api/reports/income`

Reuses cashflow aggregation, returns different shape.

#### 2B.4 Savings Rate

**Endpoint**: `GET /api/reports/savings-rate`

Derives from cashflow data:
```typescript
savingsRate = income === 0 ? 0 : ((income - expenses) / income) * 100
```

---

### Phase 2C: Net Worth & Snapshots (Days 6-8)

#### 2C.1 Snapshot Worker

**File**: `server/jobs/snapshotWorker.ts`

**Trigger**: Daily cron OR `POST /api/cron/snapshot` (protected by secret)

**Logic**:
1. Acquire Redis lock: `snapshot:lock:{householdId}:{date}` (TTL: 5 min)
2. Check completion marker: `snapshot:completed:{householdId}:{date}`
3. If not completed:
   - Fetch all visible accounts
   - Calculate totals (assets, liabilities, net worth)
   - UPSERT into `net_worth_snapshots`
   - UPSERT into `account_balance_snapshots` for each account
4. Set completion marker (TTL: 7 days)
5. Release lock

#### 2C.2 Net Worth Endpoint

**Endpoint**: `GET /api/reports/net-worth`

**Query Params**:
- `from`, `to` (required)
- `interval`: `day` | `month` (default: month)

**Response**:
```typescript
interface NetWorthResponse {
  range: { from: string; to: string; interval: string; currency: string };
  latest: {
    date: string;
    netWorth: number;
    assets: number;
    liabilities: number;
  };
  series: Array<{ id: 'Net Worth'; data: Array<{ x: string; y: number }> }>;
  breakdown?: {
    assetsByType: Array<{ type: string; value: number }>;
    liabilitiesByType: Array<{ type: string; value: number }>;
  };
}
```

**Implementation Strategy**:
```
1. Query net_worth_snapshots for date range
2. If snapshots cover range → return directly
3. If gaps exist → fill via reverse playback:
   a. Start from latest known balance
   b. Replay transactions backwards
   c. Snapshot at each interval point
4. Downsample to requested interval if needed
```

---

### Phase 2D: Advanced Reports (Days 9-12)

#### 2D.1 Annual Report

**Endpoint**: `GET /api/reports/annual`

**Query Params**:
- `year` (required)
- `compareYear` (optional, default: year-1)
- `scope`, `includePending`, `includeTransfers`

**Response**: Composite of:
- Monthly income/expense series
- Year totals + comparison
- Cumulative growth series (Nivo line-ready)
- Category breakdown for expenses/income

#### 2D.2 Sankey

**Endpoint**: `GET /api/reports/sankey`

**Query Params**:
- `from`, `to` (required)
- `mode`: `income_to_expense_groups` | `account_to_expense_groups` | `expense_groups_to_categories`
- `maxNodes`: 5-200 (default: 25)
- `includeSavingsNode`: boolean (default: true)

**Response**: Nivo Sankey-ready `{ nodes, links }` structure.

#### 2D.3 Spending Trend

**Endpoint**: `GET /api/reports/spending/trend`

**Query Params**:
- `from`, `to` (required)
- `interval`: `day` | `week` | `month`
- `compare`: `previous_period` | `previous_year` | `none`

**Response**: Aligned series with current + previous period values.

#### 2D.4 Transaction Drilldown

**Endpoint**: `GET /api/reports/transactions`

**Query Params**:
- `from`, `to` (required)
- At least ONE filter required: `categoryId`, `categoryGroupId`, `merchantId`, `accountId`, `tagId`, `type`, `search`
- `sort`: `date_desc` | `date_asc` | `amount_desc` | `amount_asc`
- `limit`: 1-200 (default: 50)
- `cursor`: base64-encoded `{date}|{id}` for pagination

**Response**:
```typescript
interface TransactionsResponse {
  page: { limit: number; nextCursor: string | null };
  items: Array<{
    id: string;
    date: string;
    name: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    signedAmount: number;
    merchant?: { id: string; name: string };
    category?: { id: string; name: string; groupId: string };
    account?: { id: string; name: string };
    tags?: Array<{ id: string; name: string }>;
    isPending: boolean;
    notes?: string;
  }>;
}
```

**Cursor Pagination**:
```sql
-- For sort=date_desc
WHERE (t.date, t.id) < ($cursorDate, $cursorId)
ORDER BY t.date DESC, t.id DESC
LIMIT $limit + 1  -- Fetch one extra to determine hasMore
```

---

## 5. Endpoint Specifications

### Summary Table

| Endpoint | Rate Limit | Cache TTL | Requires Filter |
|----------|------------|-----------|-----------------|
| `/reports/spending/breakdown` | 30/min | 5 min | No |
| `/reports/cashflow` | 30/min | 5 min | No |
| `/reports/income` | 30/min | 5 min | No |
| `/reports/savings-rate` | 30/min | 5 min | No |
| `/reports/spending/trend` | 30/min | 3 min | No |
| `/reports/net-worth` | 30/min | 10 min | No |
| `/reports/annual` | 30/min | 15 min | No |
| `/reports/sankey` | **10/min** | 10 min | No |
| `/reports/transactions` | 30/min | 1 min | **Yes** |

---

## 6. SQL Query Patterns

### 6.1 Spending Breakdown with Splits

```sql
-- Group by category group, respecting splits
WITH effective_transactions AS (
  SELECT
    t.id,
    t.household_id,
    t.date,
    t.type,
    t.is_pending,
    t.is_excluded_from_reports,
    t.owner_user_id,
    -- Use split category if exists, otherwise transaction category
    COALESCE(s.category_id, t.category_id) AS category_id,
    -- Use split amount if exists, otherwise transaction amount
    COALESCE(s.amount, t.amount) AS amount
  FROM transactions t
  LEFT JOIN transaction_splits s ON s.transaction_id = t.id
  WHERE t.deleted_at IS NULL
)
SELECT
  cg.id AS entity_id,
  cg.name AS label,
  cg.color,
  SUM(et.amount::numeric) AS value
FROM effective_transactions et
JOIN categories c ON c.id = et.category_id
JOIN category_groups cg ON cg.id = c.group_id
WHERE et.household_id = $householdId
  AND et.type = 'expense'
  AND et.is_excluded_from_reports = FALSE
  AND et.date BETWEEN $from AND $to
  AND ($includePending = TRUE OR et.is_pending = FALSE)
  AND ($scope = 'household' OR et.owner_user_id = $userId)
GROUP BY cg.id, cg.name, cg.color
ORDER BY value DESC
LIMIT $limit;
```

### 6.2 Cashflow Aggregation

```sql
SELECT
  date_trunc($interval, t.date)::date AS period_start,
  (date_trunc($interval, t.date) + ($interval || ' - 1 day')::interval)::date AS period_end,
  SUM(CASE WHEN t.type = 'income' THEN t.amount::numeric ELSE 0 END) AS income,
  SUM(CASE WHEN t.type = 'expense' THEN t.amount::numeric ELSE 0 END) AS expenses
FROM transactions t
WHERE t.household_id = $householdId
  AND t.deleted_at IS NULL
  AND t.is_excluded_from_reports = FALSE
  AND t.date BETWEEN $from AND $to
  AND ($includePending = TRUE OR t.is_pending = FALSE)
  AND ($includeTransfers = TRUE OR t.type NOT IN ('transfer', 'balance_adjustment'))
  AND ($scope = 'household' OR t.owner_user_id = $userId)
GROUP BY 1, 2
ORDER BY 1;
```

### 6.3 Net Worth from Snapshots

```sql
SELECT
  date,
  total_assets::numeric AS assets,
  total_liabilities::numeric AS liabilities,
  net_worth::numeric AS netWorth
FROM net_worth_snapshots
WHERE household_id = $householdId
  AND date BETWEEN $from AND $to
ORDER BY date;
```

### 6.4 Transaction Drilldown with Cursor

```sql
SELECT
  t.id,
  t.date,
  t.name,
  t.type,
  t.amount::numeric,
  t.is_pending,
  t.notes,
  m.id AS merchant_id,
  m.name AS merchant_name,
  c.id AS category_id,
  c.name AS category_name,
  c.group_id AS category_group_id,
  a.id AS account_id,
  a.name AS account_name
FROM transactions t
LEFT JOIN merchants m ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN accounts a ON a.id = t.account_id
WHERE t.household_id = $householdId
  AND t.deleted_at IS NULL
  AND t.is_excluded_from_reports = FALSE
  AND t.date BETWEEN $from AND $to
  -- Entity filter (at least one required)
  AND (
    ($categoryId IS NOT NULL AND t.category_id = $categoryId)
    OR ($merchantId IS NOT NULL AND t.merchant_id = $merchantId)
    OR ($accountId IS NOT NULL AND t.account_id = $accountId)
    OR ($type IS NOT NULL AND t.type = $type)
    OR ($search IS NOT NULL AND t.name ILIKE '%' || $search || '%')
  )
  -- Account visibility
  AND (a.is_private = FALSE OR a.owner_user_id = $userId)
  -- Cursor pagination
  AND ($cursorDate IS NULL OR (t.date, t.id) < ($cursorDate, $cursorId))
ORDER BY t.date DESC, t.id DESC
LIMIT $limit + 1;
```

---

## 7. Caching Strategy

### 7.1 Cache Key Format

```
analytics:{endpoint}:{householdId}:v{version}:{paramsHash}
```

**Example**:
```
analytics:spendingBreakdown:abc123:v1:f8a9b2c3
```

### 7.2 TTLs by Endpoint

| Endpoint | TTL | Reason |
|----------|-----|--------|
| dashboard | 5 min | Frequently accessed |
| cashflow | 5 min | Core report |
| spendingBreakdown | 5 min | Core report |
| spendingTrend | 3 min | Comparison data |
| annual | 15 min | Historical, rarely changes |
| netWorth | 10 min | Snapshot-based |
| sankey | 10 min | Expensive query |
| transactions | 1 min | More real-time |

### 7.3 Invalidation Triggers

| Entity Change | Invalidate |
|---------------|------------|
| Transaction create/update/delete | cashflow, spending*, annual, sankey, income, savingsRate, transactions |
| Account balance change | netWorth, dashboard |
| Category change | spendingBreakdown, annual, sankey |

---

## 8. Rate Limiting

### 8.1 Configuration

```typescript
// Standard analytics: 30 req/min/user
analyticsLimiter → All /api/reports/* routes

// Expensive endpoints: 10 req/min/user
expensiveAnalyticsLimiter → /api/reports/sankey
```

### 8.2 Response Headers

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1703001234
```

### 8.3 Error Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Analytics rate limit exceeded. Please wait before requesting more reports.",
    "retryAfter": 45
  }
}
```

---

## 9. Verification Plan

### 9.1 Seed Script

**File**: `server/scripts/seedAnalyticsData.ts`

```typescript
// Generate test data:
// - 10,000 transactions over 2 years
// - 5 accounts (3 assets, 2 liabilities)
// - 20 categories across 5 groups
// - 10 merchants
// - Mix of income/expense/transfers
// - Some split transactions
// - Some pending transactions
// - Some excluded from reports
```

### 9.2 Manual Verification Checklist

| Test | Expected |
|------|----------|
| Spending breakdown totals | Sum of items = total (within rounding) |
| Cashflow savings | savings = income - expenses |
| Cashflow savingsRate | rate = (savings / income) * 100 |
| Net worth series | Monotonic dates, values match snapshot table |
| Split transactions | Amount attributed to split category, not parent |
| Private accounts | Not visible to other household members |
| Pending filter | Excluded by default, included with flag |
| Transfer filter | Excluded by default, included with flag |
| Date range limit | 5+ year range returns error |
| Rate limiting | 31st request in 1 min returns 429 |

### 9.3 Performance Verification

Run EXPLAIN ANALYZE on each query with seed data:

| Endpoint | Target P95 | Max Acceptable |
|----------|------------|----------------|
| spending/breakdown | 300ms | 600ms |
| cashflow | 400ms | 800ms |
| net-worth | 250ms | 500ms |
| annual | 800ms | 2000ms |
| sankey | 1000ms | 2500ms |
| transactions | 150ms | 300ms |

---

## 10. File Checklist

### New Files

- [ ] `server/middleware/analyticsRateLimit.ts`
- [ ] `server/services/AnalyticsService.ts`
- [ ] `server/services/AnalyticsCache.ts`
- [ ] `server/services/CacheInvalidation.ts`
- [ ] `server/validation/analyticsValidation.ts`
- [ ] `server/jobs/snapshotWorker.ts`
- [ ] `server/scripts/seedAnalyticsData.ts`
- [ ] `shared/reports.ts` (response types)

### Modified Files

- [ ] `server/routes/reports.ts` - Replace stubs with implementations
- [ ] `server/repositories/ReportRepository.ts` - Implement all methods
- [ ] `server/routes.ts` - Add rate limiting to reports routes
- [ ] `server/services/TransactionService.ts` - Add cache invalidation
- [ ] `server/services/AccountService.ts` - Add cache invalidation

### Migration Files

- [ ] Verify `phase-0a-critical-indexes.sql` has been run
- [ ] Verify `net_worth_snapshots` table exists
- [ ] Verify `account_balance_snapshots` table exists

---

## Appendix A: Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid query parameters |
| `INVALID_DATE_RANGE` | 400 | from > to or range > 5 years |
| `MISSING_REQUIRED_FILTER` | 400 | Transaction drilldown without filter |
| `UNAUTHORIZED` | 401 | Not logged in |
| `FORBIDDEN` | 403 | Not in household |
| `NOT_FOUND` | 404 | Household/entity not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `NOT_IMPLEMENTED` | 501 | Endpoint not yet implemented |
| `INTERNAL_ERROR` | 500 | Unexpected error |

---

## Appendix B: Response Envelope

All responses follow this structure:

```typescript
// Success
{
  success: true,
  data: { ... }
}

// Error
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: unknown
  }
}
```

---

## Appendix C: Implementation Order Summary

```
Week 1:
  Day 1-2: Infrastructure (rate limiting, caching, validation)
  Day 3-4: spendingBreakdown, cashflow
  Day 5: income, savingsRate (derive from cashflow)

Week 2:
  Day 6-7: Snapshot worker, netWorth
  Day 8: spendingTrend
  Day 9-10: annual, sankey
  Day 11-12: transactions drilldown, verification
```

---

**Document Status**: Ready for implementation
**Last Updated**: 2025-12-17
