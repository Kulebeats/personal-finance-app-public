# Reports Integration Tests

## Overview

Comprehensive HTTP-level integration tests for all Reports module endpoints.

**Location:** `/server/modules/reports/__tests__/reports.integration.test.ts`

## Test Coverage

- **81 test cases** across **32 describe blocks**
- **1,526 lines of code**
- All 20+ endpoints covered

### Endpoints Tested

#### Annual Reports (4 tests)
- `GET /api/reports/annual`

#### Cashflow Reports (10 tests)
- `GET /api/reports/cashflow`
- `GET /api/reports/cashflow/budget`
- `GET /api/reports/income`
- `GET /api/reports/savings-rate`

#### Spending Reports (9 tests)
- `GET /api/reports/spending/breakdown`
- `GET /api/reports/spending/trend`
- `GET /api/reports/expenses/classification`
- `GET /api/reports/spending/subcategory`

#### Net Worth Reports (4 tests)
- `GET /api/reports/net-worth`
- `GET /api/reports/net-worth/changes`

#### Analytics & Visualization (9 tests)
- `GET /api/reports/sankey`
- `GET /api/reports/ratios`
- `GET /api/reports/financial-ratios`
- `GET /api/reports/debt`
- `GET /api/reports/forecast`

#### Drilldowns & Custom Charts (9 tests)
- `GET /api/reports/transactions`
- `GET /api/reports/goals/progress`
- `GET /api/reports/custom`
- `POST /api/reports/custom`

#### Exports (6 tests)
- `GET /api/reports/exports`
- `POST /api/reports/exports`
- `GET /api/reports/exports/:id`

### Cross-Cutting Concerns (30 tests)
- **Authentication & Authorization**: Role-based access, scope validation
- **Household Isolation**: Cross-household data protection
- **Date Range Filtering**: Format validation, range validation
- **Response Format Validation**: Success/error response structure
- **Error Handling**: Service errors, validation errors, malformed input
- **Edge Cases**: Empty results, special characters, parameter coercion

## Running the Tests

### Run all Reports integration tests

```bash
npm test -- server/modules/reports/__tests__/reports.integration.test.ts
```

### Run specific test suites

```bash
# Cashflow tests only
npm test -- server/modules/reports/__tests__/reports.integration.test.ts -t "Cashflow"

# Authorization tests only
npm test -- server/modules/reports/__tests__/reports.integration.test.ts -t "Authorization"

# Error handling tests only
npm test -- server/modules/reports/__tests__/reports.integration.test.ts -t "Error Handling"
```

### Run in watch mode

```bash
npm test -- server/modules/reports/__tests__/reports.integration.test.ts --watch
```

## Test Pattern

These tests follow the same pattern as `accounts.integration.test.ts`:

1. **Mock Setup**: All services and middleware are mocked using Vitest
2. **HTTP-Level Testing**: Uses supertest to make actual HTTP requests
3. **Response Validation**: Verifies status codes, response structure, and data
4. **Service Call Verification**: Ensures services are called with correct parameters
5. **Audit Logging**: Verifies audit logs are created appropriately

## Mock Structure

```typescript
mockReportsService: {
  getAnnual, getCashflow, getBudgetComparison,
  getIncome, getSavingsRate, getSpendingBreakdown,
  getSpendingTrend, getNetWorth, getNetWorthChanges,
  getSankey, getFinancialRatios, getDebtAnalysis,
  getForecast, getTransactions, getExpenseClassification,
  getGoalsProgress, getSubcategoryBreakdown, executeCustomChart
}

mockReportsExportService: {
  listExports, createExport, getExportById, generateExportFile
}

mockBusinessAuditService: {
  log, logCreate, logUpdate, logDelete, getIpAddress
}
```

## Example Test

```typescript
describe("GET /api/reports/cashflow - Cashflow Report", () => {
  it("should return cashflow data for date range", async () => {
    const mockCashflow = {
      periods: [
        { period: "2026-01", income: 10000, expenses: 6500, net: 3500 },
      ],
      totals: { income: 10000, expenses: 6500, net: 3500 },
    };

    mockReportsService.getCashflow.mockResolvedValue(mockCashflow);

    const res = await request(app)
      .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.periods).toHaveLength(1);
    expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
      "house-123",
      "user-123",
      expect.objectContaining({
        from: "2026-01-01",
        to: "2026-01-31",
        scope: "household",
      })
    );
  });
});
```

## Key Features Tested

### 1. Authentication & Authorization
- Default scope behavior (household for admin, mine for viewer)
- Explicit scope override
- Rejection of unauthorized scope requests

### 2. Household Isolation
- Services receive only authenticated user's household ID
- Query parameters cannot override household context
- Cross-household data access is prevented

### 3. Date Range Filtering
- YYYY-MM-DD format validation
- Invalid date detection (e.g., 2026-02-30)
- Support for both `from/to` and `startDate/endDate`
- Date range sanity checks

### 4. Response Format Validation
- Success responses: `{ success: true, data: {...} }`
- Error responses: `{ success: false, error: { code, message } }`

### 5. Error Handling
- Service errors (500 Internal Error)
- Validation errors (400 Bad Request)
- Malformed JSON (400 Bad Request)
- Missing context (500 Internal Error)

### 6. Query Parameter Validation
- Required parameters enforced
- Type coercion (strings to numbers/booleans)
- Range validation (limits, years, etc.)
- Enum validation (chartType, interval, etc.)

## Notes

- All tests use mocked services to avoid database dependencies
- Middleware (householdGuard, rate limiters) are mocked for reliability
- Tests verify service method calls to ensure proper data flow
- Audit logging is verified through mock assertions
- Tests are isolated and can run in any order
