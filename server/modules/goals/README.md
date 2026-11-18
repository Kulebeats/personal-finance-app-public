# Goals Module

Goal tracking with account assignments, transfers, and activity logging.

## Consolidates Services

- `GoalService` - Core CRUD
- `GoalAccountAssignmentService` - Account linking
- `GoalActivityLogService` - Activity tracking
- `GoalTransferService` - Fund transfers

## Files

| File                  | Purpose          |
| --------------------- | ---------------- |
| `goals.controller.ts` | Core handlers    |
| `goals.extra.controller.ts` | Summary, projections, actions |
| `goals.images.controller.ts` | Image upload + library |
| `goals.assignments.controller.ts` | Assignment handlers |
| `goals.routes.ts`     | Express router   |
| `index.ts`            | Module exports   |

## Endpoints

| Method | Path                             | Description        |
| ------ | -------------------------------- | ------------------ |
| GET    | `/goals`                         | List goals         |
| POST   | `/goals`                         | Create goal        |
| GET    | `/goals/summary`                 | Goals summary      |
| GET    | `/goals/images`                  | Goal image library |
| POST   | `/goals/images`                  | Upload goal image  |
| GET    | `/goals/available-funds`         | Unassigned funds   |
| GET    | `/goals/assignments`             | All assignments    |
| GET    | `/goals/transfers`               | All transfers      |
| POST   | `/goals/transfers`               | Create transfer    |
| POST   | `/goals/debt-strategy`           | Debt strategy calc |
| GET    | `/goals/:id`                     | Get with progress  |
| PUT    | `/goals/:id`                     | Update goal        |
| DELETE | `/goals/:id`                     | Delete goal        |
| POST   | `/goals/:id/complete`            | Complete goal      |
| POST   | `/goals/:id/archive`             | Archive goal       |
| POST   | `/goals/:id/unarchive`           | Unarchive goal     |
| GET    | `/goals/:id/projection`          | Projection details |
| GET    | `/goals/:id/contributions`       | Goal contributions |
| POST   | `/goals/:id/contribute`          | Add contribution   |
| GET    | `/goals/:id/assignments`         | Goal assignments   |
| POST   | `/goals/:id/assign-account`      | Assign account     |
| PUT    | `/goals/:id/accounts/:accountId` | Update assignment  |
| DELETE | `/goals/:id/accounts/:accountId` | Remove assignment  |
| GET    | `/goals/:id/transfers`           | Goal transfers     |
| GET    | `/goals/:id/transactions`        | Linked transactions |
| POST   | `/goals/:id/transactions`        | Link transaction   |
| DELETE | `/goals/:id/transactions/:txId`  | Unlink transaction |
| GET    | `/goals/:id/payoff-scenarios`    | Payoff scenarios   |
| POST   | `/goals/:id/calculate-payoff`    | Custom payoff calc |
| GET    | `/goals/:id/activity`            | Activity log       |

## Goal Types

- `save_up` - Savings goals
- `pay_down` - Debt payoff
- `investment` - Investment targets
