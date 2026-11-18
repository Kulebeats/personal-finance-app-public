# Centralized Calculation Engine – Implementation Plan & Specification Review

## Document Information

| Field             | Value                                       |
| ----------------- | ------------------------------------------- |
| Version           | 1.0                                         |
| Created           | 2026-01-08                                  |
| Author            | Claude Code                                 |
| Status            | Ready for Review                            |
| Related Documents | calculation-engine-specification.md         |

---

## Part 1: Specification Review & Improvements

### 1.1 Overall Assessment

**Rating: 8.5/10** – The specification is comprehensive, well-structured, and follows fintech best practices. It correctly identifies the core problems (scattered calculations, duplicate FX implementations, inconsistent parsing) and proposes a sound architecture.

### 1.2 Strengths

| Aspect | Assessment |
|--------|------------|
| Problem Analysis | Excellent – 11 files with ~6,100 lines of mixed calculation/data access logic identified |
| Type Safety | Excellent – Branded types (Money, Percentage, Ratio) prevent unit confusion |
| Precision Handling | Good – Decimal.js recommended for FX and investment calculations |
| Testing Strategy | Excellent – Property-based testing with fast-check included |
| Migration Strategy | Excellent – Shadow mode validation before cutover |
| Design/Run/Monitor | Excellent – Follows fintech industry standards |
| Documentation | Good – JSDoc with formulas, edge cases, and compliance references |

### 1.3 Identified Gaps & Recommended Improvements

#### 1.3.1 **Missing: Currency Triangulation**

**Problem:** The FX rate service assumes direct rates exist (USD→ZMW). In practice, rates may only exist via a common base currency (USD→EUR→ZMW).

**Recommendation:** Add triangulation support:

```typescript
// currency/fxRates.ts - Add to specification
export interface FXRateService {
  // ... existing methods

  /**
   * Get rate with automatic triangulation through base currency if direct rate unavailable.
   * @param from Source currency
   * @param to Target currency
   * @param baseCurrency Triangulation currency (default: USD)
   */
  getRateWithTriangulation(
    from: string,
    to: string,
    baseCurrency?: string
  ): Promise<number>;
}

// Implementation
async getRateWithTriangulation(from: string, to: string, baseCurrency = 'USD'): Promise<number> {
  // Try direct rate first
  try {
    return await this.getLatestRate(from, to);
  } catch (e) {
    if (!(e instanceof CalculationError) || e.code !== 'MISSING_FX_RATE') throw e;
  }

  // Try inverse rate
  try {
    const inverseRate = await this.getLatestRate(to, from);
    return 1 / inverseRate;
  } catch (e) {
    if (!(e instanceof CalculationError) || e.code !== 'MISSING_FX_RATE') throw e;
  }

  // Triangulate through base currency
  const fromToBase = await this.getLatestRate(from, baseCurrency);
  const baseToTarget = await this.getLatestRate(baseCurrency, to);
  return fromToBase * baseToTarget;
}
```

#### 1.3.2 **Missing: Concurrency & Race Condition Handling**

**Problem:** No discussion of concurrent access to shared data (e.g., multiple users updating household transactions simultaneously).

**Recommendation:** Add optimistic locking pattern:

```typescript
// Add to helpers.ts
export interface VersionedResult<T> {
  data: T;
  version: number;
  calculatedAt: string;
}

// Add to design/parameters.ts
export interface CalculationContext {
  userId: string;
  householdId: string;
  requestId: string;  // For tracing
  dataVersion?: number;  // For optimistic locking
  parameterVersion?: string;
}

// Persist row_version on parameter sets and require updates to include last-seen version
```

#### 1.3.3 **Missing: Calculation Result Caching Strategy**

**Problem:** Section 11.1 mentions optional Redis caching but doesn't define cache key structure or invalidation triggers.

**Recommendation:** Add explicit cache key strategy:

```typescript
// Add to Section 11.1
interface CacheKeyStrategy {
  // Pattern: {function}:{householdId}:{scope}:{aggregation}:{timezone}:{baseCurrency}:{parameterVersion}:{dataVersion}:{inputs_hash}
  pattern: string;

  invalidationTriggers: {
    // Transaction changes invalidate cashflow, budget, goal caches
    transactions: ['cashflow/*', 'budget/*', 'goals/*'],
    // Account balance changes invalidate netWorth
    accounts: ['cashflow/netWorth', 'ratios/*'],
    // FX rate changes invalidate all currency-dependent caches
    fxRates: ['*'],
    // Parameter changes invalidate all caches
    parameters: ['*']
  };
}
```

#### 1.3.4 **Missing: Batch API Surface**

**Problem:** Batch processing is mentioned (10,000 items < 1s) but no API design is provided.

**Recommendation:** Add batch API specification:

Note: Batch execution is internal-only in v1 (job queue, admin tooling). No public API exposure until a client use case exists.

```typescript
// Add to engine.ts
export interface BatchCalculationRequest<T, R> {
  functionName: keyof CalculationEngine;
  items: T[];
  options?: {
    parallelism?: number;  // Default: CPU cores
    chunkSize?: number;    // Default: 100
    continueOnError?: boolean;  // Default: false
  };
}

export interface BatchCalculationResult<R> {
  results: Array<{ index: number; result?: R; error?: CalculationError }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    executionTimeMs: number;
  };
}

export interface CalculationEngine {
  // ... existing methods

  batch<T, R>(request: BatchCalculationRequest<T, R>): Promise<BatchCalculationResult<R>>;
}
```

#### 1.3.5 **Missing: Historical Recalculation Strategy**

**Problem:** When formulas change, historical data may need recalculation. No strategy is defined.

**Recommendation:** Add recalculation strategy:

```typescript
// Add new section: "6.11 Historical Recalculation"

/**
 * Strategy for handling formula changes on historical data:
 *
 * 1. **Effective-Date Only**: New parameter versions apply forward by default
 * 2. **Immutable Results**: Stored results retain their parameter version
 * 3. **On-Demand Recalculation**: Historical views can request fresh calculation
 * 4. **Batch Recalculation Job**: Admin can trigger full recalculation for a date range
 * 5. **Audit Trail**: Both old and new results logged for comparison
 */

export interface RecalculationRequest {
  householdId: string;
  fromDate: string;
  toDate: string;
  functions: string[];  // Which calculations to recalculate
  reason: string;       // Audit trail
  dryRun?: boolean;     // Compare only, don't update
}
```

#### 1.3.6 **Missing: Internationalization Support**

**Problem:** Different locales have different rounding conventions (e.g., Brazilian Real uses banker's rounding for taxes).

**Recommendation:** Add locale-aware rounding:

```typescript
// Add to design/parameters.ts
interface RoundingConfig {
  mode: 'half_up' | 'half_down' | 'half_even' | 'ceiling' | 'floor';
  decimals: number;
}

interface LocaleParameters {
  defaultRoundingMode: RoundingConfig;
  currencyRounding: Record<string, RoundingConfig>;  // Override by currency
  taxRounding: RoundingConfig;  // May differ from financial rounding
}

// Add to helpers.ts
export function roundWithMode(
  value: number,
  decimals: number,
  mode: RoundingConfig['mode'] = 'half_up'
): number {
  const factor = Math.pow(10, decimals);
  switch (mode) {
    case 'half_up':
      return Math.round(value * factor) / factor;
    case 'half_even': // Banker's rounding
      return bankersRound(value, decimals);
    // ... other modes
  }
}
```

#### 1.3.7 **Missing: Decimal.js Usage Guidelines**

**Problem:** Specification mentions Decimal.js but doesn't clarify when to use it vs native numbers.

**Recommendation:** Add explicit guidelines:

```typescript
// Add to Section 4.4

/**
 * Decimal.js Usage Guidelines:
 *
 * USE Decimal.js for:
 * - FX rate multiplication/division
 * - Investment cost basis calculations
 * - Interest accrual calculations
 * - Any chain of 3+ multiplications/divisions
 * - Amounts > 1,000,000 (precision loss risk)
 *
 * USE native numbers for:
 * - Simple addition/subtraction
 * - Percentage calculations (final result rounded)
 * - Counts and indices
 * - Comparison operations
 *
 * ALWAYS convert Decimal back to number with explicit rounding
 * before returning from a calculation function.
 */
```

#### 1.3.8 **Missing: API Response Schemas**

**Problem:** No Zod schemas for API responses, only database schemas exist.

**Recommendation:** Add response validation:

```typescript
// Add new file: shared/calculationSchemas.ts

import { z } from 'zod';

export const MoneySchema = z.number().finite();
export const PercentageSchema = z.number().finite();
export const RatioSchema = z.number().finite();

export const CashflowResponseSchema = z.object({
  periods: z.array(z.object({
    period: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    income: MoneySchema,
    expenses: MoneySchema,
    savingsContributions: MoneySchema,
    debtPayments: MoneySchema,
    netSavings: MoneySchema,
    savingsRate: PercentageSchema,
    netSavingsRate: PercentageSchema,
  })),
  totals: z.object({
    income: MoneySchema,
    expenses: MoneySchema,
    // ...
  }),
  metadata: z.object({
    parameterVersion: z.string(),
    calculatedAt: z.string(),
  }),
});
```

#### 1.3.9 **Missing: Feature Flag Architecture**

**Problem:** Section 10.3 mentions feature flags but doesn't define the architecture.

**Recommendation:** Add feature flag specification:

```typescript
// Add to design/parameters.ts

export interface CalculationFeatureFlags {
  useNewEngine: boolean;
  enableShadowMode: boolean;
  shadowModePercentage: number;  // 0-100

  // Per-function flags for gradual rollout
  functions: {
    savingsRate: 'legacy' | 'new' | 'shadow';
    netWorth: 'legacy' | 'new' | 'shadow';
    goalProgress: 'legacy' | 'new' | 'shadow';
    // ... etc
  };
}

// Runtime flag check
export function shouldUseNewEngine(
  functionName: string,
  flags: CalculationFeatureFlags,
  requestId: string
): boolean {
  const functionFlag = flags.functions[functionName] ?? 'legacy';

  if (functionFlag === 'new') return true;
  if (functionFlag === 'legacy') return false;

  // Shadow mode: use hash of requestId for consistent routing
  const hash = hashCode(requestId) % 100;
  return hash < flags.shadowModePercentage;
}
```

#### 1.3.10 **Missing: Observability & Metrics**

**Problem:** Monitor module covers logging but not metrics/tracing for performance dashboards.

**Recommendation:** Add metrics specification:

```typescript
// Add to monitor/metrics.ts

export interface CalculationMetrics {
  // Counters
  calculationsTotal: Counter;        // Total calculations executed
  calculationsErrorsTotal: Counter;  // Failed calculations
  cacheHitsTotal: Counter;          // Cache hits
  cacheMissesTotal: Counter;        // Cache misses

  // Histograms
  calculationDurationMs: Histogram;  // Execution time distribution
  batchSizeDistribution: Histogram;  // Batch job sizes

  // Gauges
  cacheSize: Gauge;                  // Current cache entries
  activeCalculations: Gauge;         // In-flight calculations
}

// Labels for all metrics
interface MetricLabels {
  function: string;      // e.g., 'savingsRate'
  domain: string;        // e.g., 'cashflow'
  mode: 'operational' | 'simulation' | 'shadow';
  status: 'success' | 'error';
}
```

#### 1.3.11 **Improvement: Enhanced Error Context**

**Problem:** Current error types don't include enough debugging context.

**Recommendation:** Enhance error structure:

```typescript
// Improve errors.ts

export class CalculationError extends Error {
  constructor(
    public readonly code: CalculationErrorCode,
    public readonly context: {
      functionName?: string;
      inputs?: Record<string, unknown>;
      parameterVersion?: string;
      householdId?: string;
      timestamp?: string;
      cause?: Error;
    },
    message?: string
  ) {
    super(message ?? `Calculation error: ${code}`);
    this.name = 'CalculationError';

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CalculationError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}
```

#### 1.3.12 **Improvement: Dependency Injection Pattern**

**Problem:** Engine factory is shown but injection into services isn't detailed.

**Recommendation:** Add DI specification:

```typescript
// Add to engine.ts

/**
 * Dependency Injection Strategy:
 *
 * 1. Create engine instance at application startup
 * 2. Pass engine to services via constructor injection
 * 3. Services NEVER instantiate their own engine
 * 4. Test environments use mock engine
 */

// server/core/calculations/index.ts
export function createCalculationModule(
  db: Database,
  cache: Cache,
  logger: Logger
): {
  engine: CalculationEngine;
  fxService: FXRateService;
  parameterService: ParameterService;
} {
  const parameterService = createParameterService(db);
  const params = parameterService.getCurrentParameters();
  const fxService = createFXRateService(db, cache, params);
  const calcLogger = createCalculationLogger(db, { mode: 'operational' });
  const engine = createCalculationEngine(params, fxService, calcLogger);

  return { engine, fxService, parameterService };
}

// server/routes.ts - Injection point
const { engine, fxService } = createCalculationModule(db, cache, logger);

const reportRepository = new ReportRepository(db, engine);
const goalService = new GoalService(db, engine, fxService);
```

### 1.4 Inclusion Decisions (Now/Next/Later)

**Include now (core correctness/operability):**
- FX triangulation fallback (default base currency USD).
- Batch interfaces (internal jobs only; no public API in v1).
- Historical recalculation policy (effective-date only; explicit backfill job).
- Cache key strategy + invalidation triggers (scope/aggregation/timezone/baseCurrency/parameterVersion/dataVersion).
- Optimistic locking for parameter updates (`row_version`).

**Include next (post-v1):**
- Observability metrics interface (counters, histograms, gauges).
- Richer `CalculationError` context.
- Per-function feature flag schema.

**Include later (polish/consistency):**
- Decimal.js usage guidelines.
- Locale-aware rounding modes.
- Zod response schemas.
- Formal DI wiring notes.

**Open questions (confirm assumptions):**
- Do we expect FX pairs to always be directly available, or should triangulation via USD be required for edge currencies?
- Should parameter changes apply only to future periods, or trigger historical recomputation/backfill?
- Is batch execution intended for internal jobs only, or should it be exposed as a public API surface?

### 1.5 Minor Corrections

| Location | Issue | Correction |
|----------|-------|------------|
| Section 6.3.3 | `addMonths` and `differenceInMonths` imported but source not specified | Add `import { addMonths, differenceInMonths } from 'date-fns';` |
| Section 6.8.1 | `getTValue` function referenced but not defined | Add t-distribution lookup table or use stats library |
| Section 6.7.1 | `getMonthEnd` function referenced but not defined | Define or import from date utilities |
| Section 5.2.2 | Engine factory shows `convertCurrency` as async but interface doesn't indicate | Add `Promise<>` return type or make sync |
| Table in 10.2 | Week numbers don't align with typical sprint planning | Consider 2-week sprints instead |

### 1.6 Additional Test Cases Needed

Add to Section 9:

```typescript
// Edge cases not covered in specification

describe('Edge Cases', () => {
  // Leap year handling
  it('handles leap year dates correctly', () => {
    const result = calculateGoalProjection(
      toMoney(5000),
      toMoney(10000),
      toMoney(1000),
      '2028-02-29'  // Leap year
    );
    expect(result.isOnTrack).toBeDefined();
  });

  // Very large numbers
  it('handles amounts over 1 billion without precision loss', () => {
    const result = calculateNetWorth(
      toMoney(1_500_000_000),
      toMoney(500_000_000)
    );
    expect(result).toBe(toMoney(1_000_000_000));
  });

  // Negative income edge case
  it('handles negative income (business loss)', () => {
    const result = calculateSavingsRate(toMoney(-5000), toMoney(1000));
    expect(result).toBe(toPercentage(0));  // Or should it be handled differently?
  });

  // Same currency FX
  it('returns 1 for same currency without DB call', async () => {
    const spy = vi.spyOn(mockRepo, 'getLatestRate');
    await fxService.convert(toMoney(100), 'ZMW', 'ZMW');
    expect(spy).not.toHaveBeenCalled();
  });

  // Timezone edge cases
  it('handles transactions at month boundaries across timezones', () => {
    // Transaction at 23:59 UTC on Jan 31 is Feb 1 in Africa/Lusaka
  });
});
```

---

## Part 2: Implementation Plan

### 2.1 Implementation Phases Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION TIMELINE                              │
├─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬───────┤
│ Week 1  │ Week 2  │ Week 3  │ Week 4  │ Week 5  │ Week 6  │ Week 7  │ Week 8│
├─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴───────┤
│ Phase 1: Foundation                                                          │
│ ████████████████                                                             │
│                                                                              │
│ Phase 2: FX Consolidation                                                    │
│         ████████████████                                                     │
│                                                                              │
│ Phase 3: Cashflow Calculations                                               │
│                 ████████████████                                             │
│                                                                              │
│ Phase 4: Goal & Budget Calculations                                          │
│                         ████████████████                                     │
│                                                                              │
│ Phase 5: Investment & Debt Calculations                                      │
│                                 ████████████████                             │
│                                                                              │
│ Phase 6: Design & Monitor Modules                                            │
│                                         ████████████████                     │
│                                                                              │
│ Phase 7: Shadow Mode & Validation                                            │
│                                                 ████████████████             │
│                                                                              │
│ Phase 8: Cutover & Cleanup                                                   │
│                                                         ████████████████     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Phase 1: Foundation (Week 1-2)

**Objective:** Create the core scaffolding, types, and helper utilities.

#### 2.2.1 Directory Structure Creation

```bash
mkdir -p server/core/calculations/{currency,cashflow,budget,goals,investments,debt,ratios,recurring,projections,classification,dates,design,monitor,__tests__/properties}
```

#### 2.2.2 Deliverables

| File | Description | Priority |
|------|-------------|----------|
| `index.ts` | Public exports | P0 |
| `types.ts` | Branded types (Money, Percentage, Ratio) | P0 |
| `errors.ts` | CalculationError class, error codes | P0 |
| `helpers.ts` | toSafeNumber, roundToDecimals, Decimal.js wrappers | P0 |
| `__tests__/types.test.ts` | Type constructor tests | P0 |
| `__tests__/helpers.test.ts` | Helper function tests | P0 |

#### 2.2.3 Implementation Details

**types.ts:**
```typescript
// Branded types for type safety
declare const MoneyBrand: unique symbol;
declare const PercentageBrand: unique symbol;
declare const RatioBrand: unique symbol;

export type Money = number & { readonly [MoneyBrand]: void };
export type Percentage = number & { readonly [PercentageBrand]: void };
export type Ratio = number & { readonly [RatioBrand]: void };

// Constructors with validation
export function toMoney(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new CalculationError('INVALID_MONEY', { value });
  }
  return value as Money;
}

export function toPercentage(value: number): Percentage {
  if (!Number.isFinite(value)) {
    throw new CalculationError('INVALID_PERCENTAGE', { value });
  }
  return value as Percentage;
}

export function toRatio(value: number): Ratio {
  if (!Number.isFinite(value)) {
    throw new CalculationError('INVALID_RATIO', { value });
  }
  return value as Ratio;
}

// Type guards
export function isMoney(value: unknown): value is Money {
  return typeof value === 'number' && Number.isFinite(value);
}
```

**helpers.ts:**
```typescript
import Decimal from 'decimal.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function toSafeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function roundToDecimals(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Decimal.js wrappers for precision-critical calculations
export function preciseMultiply(a: number, b: number): number {
  return new Decimal(a).times(b).toNumber();
}

export function preciseDivide(a: number, b: number): number {
  if (b === 0) throw new CalculationError('DIVISION_BY_ZERO');
  return new Decimal(a).dividedBy(b).toNumber();
}

export function preciseAdd(...values: number[]): number {
  return values.reduce(
    (sum, val) => new Decimal(sum).plus(val).toNumber(),
    0
  );
}
```

#### 2.2.4 Acceptance Criteria

- [ ] All branded type constructors throw on invalid input
- [ ] toSafeNumber handles all current parsing patterns (String, null, undefined, object)
- [ ] roundToDecimals matches existing `Math.round(x * 100) / 100` behavior
- [ ] Decimal.js precision validated with edge cases (0.1 + 0.2 = 0.3)
- [ ] 100% test coverage on types.ts and helpers.ts
- [ ] Property-based tests for number handling edge cases

---

### 2.3 Phase 2: FX Consolidation (Week 2-3)

**Objective:** Consolidate 5 duplicate FX implementations into a single cached service.

#### 2.3.1 Current State Analysis

| Location | Implementation | Cache | Error Handling |
|----------|---------------|-------|----------------|
| ReportRepository.ts | selectDistinctOn | None | Silent fallback to 1 |
| PortfolioValuationService.ts | selectDistinctOn | None | Throws on missing |
| GoalService.ts | Inline query | None | Silent fallback |
| GoalAccountAssignmentService.ts | Inline query | None | Silent fallback |
| Investment routes | Inline query | None | Varies |

#### 2.3.2 Deliverables

| File | Description | Priority |
|------|-------------|----------|
| `currency/fxRates.ts` | FXRateService interface and implementation | P0 |
| `currency/conversion.ts` | convertToDisplayCurrency utility | P0 |
| `currency/fallback.ts` | Historical rate fallback chain | P1 |
| `currency/__tests__/fxRates.test.ts` | FX service tests | P0 |

#### 2.3.3 Implementation

**currency/fxRates.ts:**
```typescript
import { db } from '../../db';
import { fxRates } from '../../../shared/schema';
import { eq, and, desc, lte, inArray } from 'drizzle-orm';
import { CalculationError } from '../errors';
import { toMoney, Money } from '../types';
import { roundToDecimals } from '../helpers';

export interface FXRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  source: string;
}

export interface FXRateRepository {
  getLatestRate(from: string, to: string): Promise<FXRate | null>;
  getRateForDate(from: string, to: string, date: string): Promise<FXRate | null>;
  getMostRecentRateBefore(from: string, to: string, date: string): Promise<FXRate | null>;
  getLatestRates(fromCurrencies: string[], to: string): Promise<Map<string, number>>;
}

export interface FXRateService {
  getLatestRate(from: string, to: string): Promise<number>;
  getHistoricalRate(from: string, to: string, date: string): Promise<number>;
  convert(amount: Money, from: string, to: string, date?: string): Promise<Money>;
  getRateWithTriangulation(from: string, to: string, baseCurrency?: string): Promise<number>;
  getLatestRatesMap(fromCurrencies: string[], to: string): Promise<Map<string, number>>;
}

interface FXServiceConfig {
  cacheTtlSeconds: number;
  fallbackDays: number;
  baseCurrency: string;
}

export function createFXRateRepository(database: typeof db): FXRateRepository {
  return {
    async getLatestRate(from: string, to: string): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRates.fromCurrency, from.toUpperCase()),
          eq(fxRates.toCurrency, to.toUpperCase())
        ),
        orderBy: [desc(fxRates.date)],
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: parseFloat(result.rate),
        date: result.date.toISOString().split('T')[0],
        source: result.source ?? 'database',
      };
    },

    async getRateForDate(from: string, to: string, date: string): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRates.fromCurrency, from.toUpperCase()),
          eq(fxRates.toCurrency, to.toUpperCase()),
          eq(fxRates.date, new Date(date))
        ),
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: parseFloat(result.rate),
        date: result.date.toISOString().split('T')[0],
        source: result.source ?? 'database',
      };
    },

    async getMostRecentRateBefore(from: string, to: string, date: string): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRates.fromCurrency, from.toUpperCase()),
          eq(fxRates.toCurrency, to.toUpperCase()),
          lte(fxRates.date, new Date(date))
        ),
        orderBy: [desc(fxRates.date)],
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: parseFloat(result.rate),
        date: result.date.toISOString().split('T')[0],
        source: result.source ?? 'database',
      };
    },

    async getLatestRates(fromCurrencies: string[], to: string): Promise<Map<string, number>> {
      const normalizedCurrencies = fromCurrencies.map(c => c.toUpperCase());
      const normalizedTo = to.toUpperCase();

      // Get latest rate for each currency
      const results = await database
        .selectDistinctOn([fxRates.fromCurrency], {
          fromCurrency: fxRates.fromCurrency,
          rate: fxRates.rate,
        })
        .from(fxRates)
        .where(and(
          inArray(fxRates.fromCurrency, normalizedCurrencies),
          eq(fxRates.toCurrency, normalizedTo)
        ))
        .orderBy(fxRates.fromCurrency, desc(fxRates.date));

      const rateMap = new Map<string, number>();
      for (const row of results) {
        rateMap.set(row.fromCurrency, parseFloat(row.rate));
      }

      return rateMap;
    },
  };
}

export function createFXRateService(
  repository: FXRateRepository,
  cache: Map<string, { rate: number; expiresAt: number }>,
  config: FXServiceConfig
): FXRateService {
  const getCacheKey = (from: string, to: string, date?: string) =>
    `fx:${from.toUpperCase()}:${to.toUpperCase()}${date ? `:${date}` : ''}`;

  return {
    async getLatestRate(from: string, to: string): Promise<number> {
      // Same currency = 1
      if (from.toUpperCase() === to.toUpperCase()) return 1;

      // Check cache
      const cacheKey = getCacheKey(from, to);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.rate;
      }

      // Fetch from repository
      const rate = await repository.getLatestRate(from, to);
      if (!rate) {
        throw new CalculationError('MISSING_FX_RATE', { from, to });
      }

      // Cache result
      cache.set(cacheKey, {
        rate: rate.rate,
        expiresAt: Date.now() + config.cacheTtlSeconds * 1000,
      });

      return rate.rate;
    },

    async getHistoricalRate(from: string, to: string, date: string): Promise<number> {
      if (from.toUpperCase() === to.toUpperCase()) return 1;

      // Try exact date
      let rate = await repository.getRateForDate(from, to, date);
      if (rate) return rate.rate;

      // Fallback: most recent before date
      rate = await repository.getMostRecentRateBefore(from, to, date);
      if (rate) return rate.rate;

      throw new CalculationError('MISSING_FX_RATE', { from, to, date });
    },

    async convert(amount: Money, from: string, to: string, date?: string): Promise<Money> {
      const rate = date
        ? await this.getHistoricalRate(from, to, date)
        : await this.getLatestRate(from, to);

      return toMoney(roundToDecimals(amount * rate, 2));
    },

    async getRateWithTriangulation(from: string, to: string, baseCurrency = 'USD'): Promise<number> {
      // Try direct rate
      try {
        return await this.getLatestRate(from, to);
      } catch (e) {
        if (!(e instanceof CalculationError) || e.code !== 'MISSING_FX_RATE') throw e;
      }

      // Try inverse
      try {
        const inverseRate = await this.getLatestRate(to, from);
        return 1 / inverseRate;
      } catch (e) {
        if (!(e instanceof CalculationError) || e.code !== 'MISSING_FX_RATE') throw e;
      }

      // Triangulate through base currency
      const fromToBase = await this.getLatestRate(from, baseCurrency);
      const baseToTarget = await this.getLatestRate(baseCurrency, to);
      return fromToBase * baseToTarget;
    },

    async getLatestRatesMap(fromCurrencies: string[], to: string): Promise<Map<string, number>> {
      return repository.getLatestRates(fromCurrencies, to);
    },
  };
}
```

#### 2.3.4 Migration Steps

1. **Create FX service** in `server/core/calculations/currency/`
2. **Add compatibility wrapper** that matches existing function signatures
3. **Update ReportRepository** to use new FX service (add constructor parameter)
4. **Update PortfolioValuationService** to use new FX service
5. **Update GoalService** to use new FX service
6. **Update GoalAccountAssignmentService** to use new FX service
7. **Update investment routes** to use new FX service
8. **Remove duplicate implementations**
9. **Add integration tests**

#### 2.3.5 Acceptance Criteria

- [ ] Single FX rate service handles all 5 use cases
- [ ] Cache hit rate > 80% in typical usage
- [ ] Triangulation works for indirect currency pairs
- [ ] Fallback to historical rates works within configured window
- [ ] Error handling is consistent (throw, not silent fallback)
- [ ] All existing tests pass
- [ ] New tests cover cache, triangulation, and fallback scenarios

---

### 2.4 Phase 3: Cashflow Calculations (Week 3-4)

**Objective:** Extract cashflow calculations from ReportRepository into pure functions.

#### 2.4.1 Deliverables

| File | Functions | Priority |
|------|-----------|----------|
| `cashflow/savingsRate.ts` | calculateSavingsRate | P0 |
| `cashflow/netSavings.ts` | calculateNetSavings | P0 |
| `cashflow/netSavingsRate.ts` | calculateNetSavingsRate | P0 |
| `cashflow/netWorth.ts` | calculateNetWorth | P0 |
| `cashflow/incomeAllocation.ts` | calculateIncomeAllocation | P1 |
| `cashflow/__tests__/*.test.ts` | Unit tests | P0 |
| `cashflow/__tests__/properties/*.property.test.ts` | Property tests | P1 |

#### 2.4.2 Implementation

**cashflow/savingsRate.ts:**
```typescript
import { Money, Percentage, toPercentage } from '../types';
import { roundToDecimals } from '../helpers';

/**
 * Calculates savings rate (Savings Contributions method).
 *
 * @formula savingsRate = (savingsContributions / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - income <= 0: returns 0%
 *   - savingsContributions < 0: returns negative %
 * @compliance GAAP - consistent with personal finance reporting standards
 *
 * @param income - Total income in base currency
 * @param savingsContributions - Transfers into savings/investment accounts
 * @returns Savings rate as percentage (0-100+)
 */
export function calculateSavingsRate(
  income: Money,
  savingsContributions: Money
): Percentage {
  if (income <= 0) return toPercentage(0);
  return toPercentage(
    roundToDecimals((savingsContributions / income) * 100, 2)
  );
}
```

**cashflow/netWorth.ts:**
```typescript
import { Money, toMoney } from '../types';

/**
 * Calculates net worth.
 *
 * @formula netWorth = totalAssets - totalLiabilities
 * @compliance GAAP/IFRS balance sheet identity
 * @edge-cases
 *   - Can be negative (liabilities > assets)
 *
 * @param assets - Total value of all assets in base currency
 * @param liabilities - Total value of all liabilities in base currency
 * @returns Net worth (can be negative)
 */
export function calculateNetWorth(assets: Money, liabilities: Money): Money {
  return toMoney(assets - liabilities);
}
```

#### 2.4.3 ReportRepository Refactoring

```typescript
// BEFORE (ReportRepository.ts)
const savings = data.income - data.expenses - data.debt;
const savingsRate = data.income > 0 ? (savings / data.income) * 100 : 0;

// AFTER (ReportRepository.ts)
import { calculateNetSavingsRate } from '../core/calculations/cashflow/netSavingsRate';
import { toMoney } from '../core/calculations/types';

const savingsRate = calculateNetSavingsRate(
  toMoney(data.income),
  toMoney(data.expenses),
  toMoney(data.debt)
);
```

#### 2.4.4 Shadow Mode Integration

```typescript
// ReportRepository.ts - Shadow mode wrapper
import { withShadowMode } from '../core/calculations/monitor/shadow';

async getSavingsRate(params: SavingsRateParams): Promise<number> {
  return withShadowMode(
    // Legacy calculation
    () => this.legacySavingsRate(params),
    // New calculation
    () => calculateSavingsRate(
      toMoney(params.income),
      toMoney(params.savingsContributions)
    ),
    'savingsRate',
    this.shadowLogger
  );
}
```

#### 2.4.5 Acceptance Criteria

- [ ] All 5 cashflow functions implemented with JSDoc
- [ ] Unit tests cover normal, edge, and boundary cases
- [ ] Property-based tests validate mathematical properties
- [ ] Shadow mode logs all discrepancies
- [ ] ReportRepository refactored to use engine functions
- [ ] No change in API response values (shadow mode validates)

---

### 2.5 Phase 4: Goal & Budget Calculations (Week 4-5)

**Objective:** Migrate goal and budget calculations from services to engine.

#### 2.5.1 Deliverables

| File | Functions | Priority |
|------|-----------|----------|
| `goals/progress.ts` | calculateGoalProgress | P0 |
| `goals/status.ts` | determineGoalStatus | P0 |
| `goals/projections.ts` | calculateGoalProjection | P0 |
| `goals/annualTargets.ts` | calculateAnnualGoalProgress | P1 |
| `budget/progress.ts` | calculateBudgetProgress | P0 |
| `budget/alerts.ts` | determineBudgetStatus | P0 |
| `budget/rollover.ts` | calculateRolloverAmount | P1 |
| `budget/forecasting.ts` | forecastBudgetUsage | P2 |

#### 2.5.2 Migration from goalCalculations.ts

```typescript
// BEFORE (goalCalculations.ts)
export function calculatePercentComplete(
  currentAmount: string | number,
  targetAmount: string | number
): number {
  const current = parseFloat(String(currentAmount));
  const target = parseFloat(String(targetAmount));
  if (target <= 0) return current > 0 ? 100 : 0;
  return Math.min(100, (current / target) * 100);
}

// AFTER (goals/progress.ts)
import { Money, Percentage, toPercentage } from '../types';
import { roundToDecimals } from '../helpers';

export interface GoalProgress {
  currentAmount: Money;
  targetAmount: Money;
  remainingAmount: Money;
  percentComplete: Percentage;
}

export function calculateGoalProgress(
  currentAmount: Money,
  targetAmount: Money
): GoalProgress {
  const remainingAmount = toMoney(Math.max(0, targetAmount - currentAmount));
  const percentComplete = targetAmount > 0
    ? toPercentage(roundToDecimals((currentAmount / targetAmount) * 100, 2))
    : toPercentage(currentAmount > 0 ? 100 : 0);

  return { currentAmount, targetAmount, remainingAmount, percentComplete };
}
```

#### 2.5.3 Acceptance Criteria

- [ ] All goal functions migrated from goalCalculations.ts
- [ ] GoalService refactored to use engine
- [ ] BudgetService refactored to use engine
- [ ] Shadow mode validates no regressions
- [ ] Tests cover goal status transitions
- [ ] Tests cover budget alert thresholds

---

### 2.6 Phase 5: Investment & Debt Calculations (Week 5-6)

**Objective:** Migrate investment and debt calculations.

#### 2.6.1 Deliverables

| File | Functions | Priority |
|------|-----------|----------|
| `investments/twr.ts` | calculateTimeWeightedReturn | P0 |
| `investments/valuation.ts` | calculateHoldingValue | P0 |
| `investments/costBasis.ts` | calculateCostBasis | P0 |
| `investments/gainLoss.ts` | calculateGainLoss | P0 |
| `investments/fxAttribution.ts` | calculateFXAttribution | P1 |
| `debt/payoff.ts` | calculateDebtPayoffSchedule | P0 |
| `debt/dti.ts` | calculateDebtToIncome | P0 |
| `debt/interestCalc.ts` | calculateMonthlyInterest | P1 |

#### 2.6.2 DebtPayoffCalculator Migration

```typescript
// BEFORE (DebtPayoffCalculator.ts)
const monthlyRate = apr / 100 / 12;
const interest = remaining * monthlyRate;

// AFTER (debt/interestCalc.ts)
import { Money, Percentage, toMoney } from '../types';
import { preciseDivide, preciseMultiply, roundToDecimals } from '../helpers';

/**
 * Calculates monthly interest using 30/360 day count convention.
 *
 * @formula interest = balance * (apr / 100 / 12)
 * @rounding 2 decimal places
 * @convention Monthly compounding, 30/360 day count
 */
export function calculateMonthlyInterest(
  balance: Money,
  apr: Percentage
): Money {
  const monthlyRate = preciseDivide(apr, 100 * 12);
  const interest = preciseMultiply(balance, monthlyRate);
  return toMoney(roundToDecimals(interest, 2));
}
```

#### 2.6.3 Acceptance Criteria

- [ ] TWR calculation matches InvestmentPerformanceService output
- [ ] Cost basis handles FIFO and average cost methods
- [ ] FX attribution separates asset and currency returns
- [ ] Debt payoff supports snowball and avalanche strategies
- [ ] Shadow mode validates no regressions
- [ ] Decimal.js used for all multiplication chains

---

### 2.7 Phase 6: Design & Monitor Modules (Week 6-7)

**Objective:** Implement parameter management and audit logging.

#### 2.7.1 Deliverables

| File | Functions | Priority |
|------|-----------|----------|
| `design/parameters.ts` | CalculationParameters, DEFAULT_PARAMETERS | P0 |
| `design/parameterService.ts` | getCurrentParameters, createParameterSet | P1 |
| `monitor/logger.ts` | CalculationLogger, createCalculationLogger | P0 |
| `monitor/shadow.ts` | withShadowMode | P0 |
| `monitor/metrics.ts` | CalculationMetrics | P2 |

#### 2.7.2 Database Schema

```sql
-- Add to migrations

CREATE TABLE calculation_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL UNIQUE,
  effective_date DATE NOT NULL,
  parameters JSONB NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft'
);

CREATE TABLE calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  function_name VARCHAR(100) NOT NULL,
  inputs JSONB NOT NULL,
  output JSONB NOT NULL,
  parameter_version VARCHAR(20),
  execution_mode VARCHAR(20),
  execution_time_ms INTEGER,
  user_id UUID REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  channel VARCHAR(50),
  error_code VARCHAR(50),
  error_message TEXT
);

CREATE INDEX idx_calc_logs_timestamp ON calculation_logs(timestamp);
CREATE INDEX idx_calc_logs_function ON calculation_logs(function_name);
CREATE INDEX idx_calc_logs_household ON calculation_logs(household_id);
```

#### 2.7.3 Acceptance Criteria

- [ ] Parameter service loads effective parameters by date
- [ ] Four-eyes approval workflow implemented (if admin features exist)
- [ ] Parameter updates enforce optimistic locking with row_version
- [ ] All calculations log to calculation_logs table
- [ ] Shadow mode comparisons logged with match/mismatch flag
- [ ] Metrics exported (if observability stack exists)

---

### 2.8 Phase 7: Shadow Mode & Validation (Week 7-8)

**Objective:** Run parallel calculations and validate correctness.

#### 2.8.1 Shadow Mode Dashboard

Create a simple dashboard to monitor shadow mode:

```typescript
// GET /api/admin/calculation-shadow-status
interface ShadowModeStatus {
  enabled: boolean;
  functionsInShadow: string[];
  last24Hours: {
    total: number;
    matches: number;
    mismatches: number;
    mismatchRate: number;
  };
  recentMismatches: Array<{
    timestamp: string;
    function: string;
    legacyResult: unknown;
    newResult: unknown;
    diff: string;
  }>;
}
```

#### 2.8.2 Validation Checklist

| Function | Shadow Start | Match Rate | Validated | Cutover Date |
|----------|--------------|------------|-----------|--------------|
| savingsRate | | | [ ] | |
| netSavingsRate | | | [ ] | |
| netWorth | | | [ ] | |
| goalProgress | | | [ ] | |
| budgetProgress | | | [ ] | |
| timeWeightedReturn | | | [ ] | |
| debtPayoff | | | [ ] | |
| fxConversion | | | [ ] | |

#### 2.8.3 Acceptance Criteria

- [ ] All functions achieve 100% match rate before cutover
- [ ] Mismatches investigated and root-caused
- [ ] Rounding differences < 0.01% tolerated
- [ ] Performance within targets (< 20ms sync, < 1s batch)
- [ ] No memory leaks in shadow mode

---

### 2.9 Phase 8: Cutover & Cleanup (Week 8+)

**Objective:** Disable legacy code and clean up.

#### 2.9.1 Cutover Steps

1. **Announce maintenance window** (if needed)
2. **Disable shadow mode** via feature flag
3. **Remove legacy calculation code** from services
4. **Update imports** to use engine directly
5. **Remove compatibility wrappers**
6. **Archive old code** (git branch)
7. **Update documentation**
8. **Monitor for errors** for 48 hours

#### 2.9.2 Files to Clean Up

| File | Action |
|------|--------|
| `goalCalculations.ts` | Delete (functions moved to engine) |
| `ReportRepository.ts` | Remove inline calculations |
| `GoalService.ts` | Remove duplicate FX code |
| `PortfolioValuationService.ts` | Remove duplicate FX code |
| `BudgetService.ts` | Remove inline calculations |

#### 2.9.3 Acceptance Criteria

- [ ] No legacy calculation code remains
- [ ] All tests pass
- [ ] Application functions normally for 48 hours
- [ ] Documentation updated
- [ ] Knowledge transfer completed

---

## Part 3: Risk Mitigation

### 3.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Shadow mode reveals widespread discrepancies | Medium | High | Extend shadow period, fix root causes before cutover |
| FX rate cache invalidation issues | Low | Medium | Implement cache versioning, add monitoring |
| Performance regression | Low | Medium | Benchmark each phase, optimize hot paths |
| Database migration failures | Low | High | Test migrations on staging, have rollback scripts |
| Breaking changes to API responses | Medium | High | Freeze response schemas, use shadow mode |

### 3.2 Rollback Plan

```typescript
// Feature flag for instant rollback
const CALCULATION_ENGINE_FLAGS = {
  useLegacy: {
    savingsRate: false,
    netWorth: false,
    goalProgress: false,
    // ... all functions
  }
};

// In route handlers
const result = CALCULATION_ENGINE_FLAGS.useLegacy.savingsRate
  ? legacySavingsRate(params)
  : engine.savingsRate(params);
```

---

## Part 4: Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Test coverage | > 90% | `npm run test:coverage` |
| Shadow mode match rate | 100% | Shadow mode dashboard |
| FX rate cache hit rate | > 80% | Metrics/logs |
| Sync calculation latency | < 20ms | APM/logs |
| Batch calculation latency (10k) | < 1s | Load tests |
| Audit log completeness | 100% | Query calculation_logs |
| Developer satisfaction | High | Team survey |

---

## Part 5: Dependencies

### 5.1 New NPM Packages

```json
{
  "dependencies": {
    "decimal.js": "^10.4.3"
  },
  "devDependencies": {
    "fast-check": "^3.15.0"
  }
}
```

### 5.2 Database Changes

- New table: `calculation_parameters`
- New table: `calculation_logs`
- New indexes for log queries

### 5.3 Team Skills Required

- TypeScript (advanced: branded types, generics)
- Financial mathematics (interest, TWR, amortization)
- Property-based testing (fast-check)
- Database migrations (Drizzle)

---

## Appendix A: File Creation Checklist

### Phase 1 Files
- [ ] `server/core/calculations/index.ts`
- [ ] `server/core/calculations/types.ts`
- [ ] `server/core/calculations/errors.ts`
- [ ] `server/core/calculations/helpers.ts`
- [ ] `server/core/calculations/__tests__/types.test.ts`
- [ ] `server/core/calculations/__tests__/helpers.test.ts`

### Phase 2 Files
- [ ] `server/core/calculations/currency/fxRates.ts`
- [ ] `server/core/calculations/currency/conversion.ts`
- [ ] `server/core/calculations/currency/fallback.ts`
- [ ] `server/core/calculations/currency/__tests__/fxRates.test.ts`

### Phase 3 Files
- [ ] `server/core/calculations/cashflow/savingsRate.ts`
- [ ] `server/core/calculations/cashflow/netSavings.ts`
- [ ] `server/core/calculations/cashflow/netSavingsRate.ts`
- [ ] `server/core/calculations/cashflow/netWorth.ts`
- [ ] `server/core/calculations/cashflow/incomeAllocation.ts`
- [ ] `server/core/calculations/cashflow/__tests__/*.test.ts`

### Phase 4 Files
- [ ] `server/core/calculations/goals/progress.ts`
- [ ] `server/core/calculations/goals/status.ts`
- [ ] `server/core/calculations/goals/projections.ts`
- [ ] `server/core/calculations/budget/progress.ts`
- [ ] `server/core/calculations/budget/alerts.ts`

### Phase 5 Files
- [ ] `server/core/calculations/investments/twr.ts`
- [ ] `server/core/calculations/investments/gainLoss.ts`
- [ ] `server/core/calculations/debt/payoff.ts`
- [ ] `server/core/calculations/debt/dti.ts`

### Phase 6 Files
- [ ] `server/core/calculations/design/parameters.ts`
- [ ] `server/core/calculations/monitor/logger.ts`
- [ ] `server/core/calculations/monitor/shadow.ts`

---

## Appendix B: Quick Reference

### Branded Type Usage

```typescript
// Always use constructors
const income = toMoney(5000);  // ✓
const income = 5000 as Money;  // ✗ Bypasses validation

// Functions accept branded types
calculateSavingsRate(income, savings);  // ✓
calculateSavingsRate(5000, 1000);       // ✗ Type error
```

### Safe Number Parsing

```typescript
// Replace all variants with toSafeNumber
parseFloat(String(value))       → toSafeNumber(value)
parseFloat(value ?? "0")        → toSafeNumber(value)
Number(row.total)               → toSafeNumber(row.total)
```

### Rounding Consistency

```typescript
// Use roundToDecimals everywhere
Math.round(x * 100) / 100       → roundToDecimals(x, 2)
value.toFixed(2)                → roundToDecimals(value, 2)
```

---

_Document Version: 1.0_
_Last Updated: 2026-01-08_
_Status: Ready for Review_

