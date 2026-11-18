# Reports Module

Financial reports and analytics for household expenses, income, and net worth.

## Structure

```text
server/modules/reports/
├── index.ts              # Module exports
├── reports.controller.ts # HTTP handlers (15 endpoints)
├── reports.routes.ts     # Express routes with rate limiting
├── reports.service.ts    # Re-export of AnalyticsService
├── reports.types.ts      # Shared TypeScript types
├── reports.utils.ts      # Scope resolution, error handling
└── README.md
```

## Endpoints

| Method | Path                | Description          | Rate Limit |
| ------ | ------------------- | -------------------- | ---------- |
| GET    | /annual             | Annual summary       | Analytics  |
| GET    | /cashflow           | Income vs expenses   | Analytics  |
| GET    | /income             | Income breakdown     | Analytics  |
| GET    | /savings-rate       | Savings rate trend   | Analytics  |
| GET    | /spending/breakdown | Spending by category | Analytics  |
| GET    | /spending/trend     | Spending over time   | Analytics  |
| GET    | /net-worth          | Net worth history    | Analytics  |
| GET    | /net-worth/changes  | Net worth changes    | Analytics  |
| GET    | /sankey             | Sankey flow diagram  | Expensive  |
| GET    | /ratios             | Financial ratios     | Analytics  |
| GET    | /debt               | Debt analysis        | Analytics  |
| GET    | /comparison         | Period comparison    | Analytics  |
| GET    | /forecast           | Spending forecast    | Analytics  |
| POST   | /custom             | Custom chart         | Analytics  |

## Query Parameters (Common)

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| from      | string | Start date (YYYY-MM-DD)    |
| to        | string | End date (YYYY-MM-DD)      |
| scope     | string | `household` or `mine`      |
| currency  | string | 3-letter currency code     |
| accountId | string | Filter by account UUID     |
| timezone  | string | Timezone for date grouping |

## Security

- All routes require authentication via `householdGuard`
- `scope=household` requires owner/admin role
- Rate limited (30 req/min analytics, 10 req/min expensive)

## Usage

```typescript
import { reportsRoutes } from "./modules/reports";

app.use("/api/reports", reportsRoutes);
```
