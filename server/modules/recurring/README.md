# Recurring Module

Recurring transaction rules and payment reminders.

## Endpoints

| Method | Path              | Description          | Auth   |
| ------ | ----------------- | -------------------- | ------ |
| GET    | /                 | List recurring rules | all    |
| GET    | /upcoming         | Upcoming payments    | all    |
| GET    | /summary          | Summary stats        | all    |
| GET    | /:id              | Get rule by ID       | all    |
| GET    | /:id/history      | Rule history         | all    |
| GET    | /:id/transactions | Linked transactions  | all    |
| POST   | /                 | Create rule          | member |
| PUT    | /:id              | Update rule          | member |
| DELETE | /:id              | Delete rule          | member |
| POST   | /detect           | Detect patterns      | member |
| POST   | /confirm          | Confirm pattern      | member |
| POST   | /:id/skip         | Skip occurrence      | member |
| POST   | /:id/pause        | Pause rule           | member |
| POST   | /:id/resume       | Resume rule          | member |
| POST   | /:id/end          | End rule             | member |
| POST   | /:id/link         | Link transaction     | member |
| DELETE | /:id/link/:linkId | Unlink               | member |
| POST   | /transaction/:id  | Create from txn      | member |

## Usage

```typescript
import { recurringRoutes } from "./modules/recurring";
app.use("/api/recurring", recurringRoutes);
```
