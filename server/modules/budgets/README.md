# Budgets Module

Budget management for household expense planning and tracking.

## Endpoints

| Method | Path          | Description          | Auth   |
| ------ | ------------- | -------------------- | ------ |
| GET    | /             | List budgets         | all    |
| GET    | /progress     | Monthly progress     | all    |
| GET    | /alerts       | Threshold alerts     | all    |
| GET    | /settings     | Budget settings      | all    |
| GET    | /forecast     | Future projections   | all    |
| GET    | /:id          | Get budget by ID     | all    |
| POST   | /             | Create budget        | member |
| PUT    | /:id          | Update budget        | member |
| DELETE | /:id          | Delete budget        | member |
| PUT    | /settings     | Update settings      | member |
| POST   | /recalculate  | Auto-calculate       | member |
| POST   | /clear        | Clear all values     | member |
| POST   | /move         | Move between budgets | member |
| PUT    | /forecast/:id | Update forecast      | member |

## Security

- All routes require `householdGuard`
- Write operations require `member` role

## Usage

```typescript
import { budgetsRoutes } from "./modules/budgets";
app.use("/api/budgets", budgetsRoutes);
```
