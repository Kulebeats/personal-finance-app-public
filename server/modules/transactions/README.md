# Transactions Module

Financial transaction management with CRUD, transfers, and attachments.

## Files

| File                         | Purpose                   |
| ---------------------------- | ------------------------- |
| `transactions.controller.ts` | 15 HTTP handlers          |
| `transactions.routes.ts`     | Express router            |
| `transactions.service.ts`    | Re-exports legacy service |
| `transactions.validation.ts` | 8 Zod schemas             |
| `transactions.types.ts`      | Domain types              |
| `transactions.events.ts`     | Event constants           |

## Endpoints

| Method | Path                                          | Description        |
| ------ | --------------------------------------------- | ------------------ |
| GET    | `/transactions`                               | List transactions  |
| POST   | `/transactions`                               | Create transaction |
| GET    | `/transactions/:id`                           | Get by ID          |
| PUT    | `/transactions/:id`                           | Update transaction |
| DELETE | `/transactions/:id`                           | Delete transaction |
| POST   | `/transactions/bulk`                          | Bulk create        |
| DELETE | `/transactions/bulk`                          | Bulk delete        |
| GET    | `/transactions/summary`                       | Get summary stats  |
| POST   | `/transactions/:id/attachments`               | Upload attachment  |
| DELETE | `/transactions/:id/attachments/:attachmentId` | Delete attachment  |

## Validation Schemas

- `createTransactionSchema`
- `updateTransactionSchema`
- `listTransactionsQuerySchema`
- `bulkCreateSchema`
- `transactionSummaryQuerySchema`

## Security

- `householdGuard`: Ensures household context
- `requireRole("member")`: Write operations require member role
