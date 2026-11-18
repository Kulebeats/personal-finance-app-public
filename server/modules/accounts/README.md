# Accounts Module

Financial account management with balance tracking and history.

## Files

| File                     | Purpose          |
| ------------------------ | ---------------- |
| `accounts.controller.ts` | 17 HTTP handlers |
| `accounts.routes.ts`     | Express router   |
| `index.ts`               | Module exports   |

## Endpoints

| Method | Path                                   | Description         |
| ------ | -------------------------------------- | ------------------- |
| GET    | `/accounts`                            | List accounts       |
| POST   | `/accounts`                            | Create account      |
| GET    | `/accounts/summary`                    | Net worth summary   |
| GET    | `/accounts/summary/export`             | Export as CSV       |
| GET    | `/accounts/:id`                        | Get by ID           |
| PUT    | `/accounts/:id`                        | Update account      |
| DELETE | `/accounts/:id`                        | Delete account      |
| POST   | `/accounts/:id/adjust-balance`         | Adjust balance      |
| GET    | `/accounts/:id/balance-history`        | Balance history     |
| POST   | `/accounts/:id/balance-history/import` | Import history      |
| GET    | `/accounts/:id/transactions/export`    | Export transactions |
| POST   | `/accounts/:id/transactions/import`    | Import transactions |
| GET    | `/accounts/net-worth/history`          | Net worth over time |
| PUT    | `/accounts/:id/settings`               | Update settings     |

## Security

- `householdGuard`: Ensures household context
- `requireRole("member")`: Write operations
- Owner-based visibility for shared accounts
