# Multi-Currency Aggregation Logic

## Overview

The Reports module handles data from accounts with different currencies. To provide meaningful totals and charts, all amounts must be normalized to a common currency (usually the user's preferred currency) before aggregation.

## Rules

1.  **Normalization First**: All transaction amounts (`MoneyDto`) are converted to the target currency _before_ summation.
2.  **Exchange Rates**: Rates used are based on the transaction date (historical rates) where possible, or current rates if historical data is unavailable.
3.  **Base vs. Original**:
    - **Base Currency**: The user's primary display currency (e.g., USD).
    - **Original Currency**: The raw currency of the transaction (e.g., EUR, GBP).
    - Reports default to showing **Base Currency**.
4.  **Mixed Currency Series**:
    - When a series (e.g., Spending Trend) aggregates multiple accounts, the series is denominated in the Base Currency.
    - Drill-downs may show original currencies, but headers/summaries are normalized.

## Implementation

Repositories using aggregation (e.g., `CashflowReportRepository`, `SpendingReportRepository`) utilize the `Money` class helpers or SQL-level conversion if available.

### Example (SQL/QueryBuilder):

```typescript
// Pseudo-code for aggregation
const total = await db
  .select({
    value: sql`SUM(amount * exchange_rate)`.as('value')
  })
  .from(transactions)
  .where(...)
```

### Example (Application Layer):

```typescript
const total = transactions.reduce((sum, txn) => {
  return sum.add(txn.amount.convertTo(userCurrency, rates));
}, Money.zero(userCurrency));
```

## Warnings

- **Rate Volatility**: Aggregation over long periods (Years) using current rates may skew historical accuracy. Historical rates should be preferred.
- **Missing Rates**: If a rate is missing, the system falls back to 1:1 or logs a warning. Ensure rates are synced.
