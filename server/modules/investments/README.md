# Investments Module

Portfolio management, holdings tracking, and performance analytics.

## Endpoints

### Securities

| Method | Path                   | Description        |
| ------ | ---------------------- | ------------------ |
| GET    | /securities            | Search securities  |
| GET    | /securities/:id        | Get security by ID |
| GET    | /securities/:id/prices | Price history      |

### Holdings

| Method | Path          | Auth   |
| ------ | ------------- | ------ |
| GET    | /holdings     | all    |
| GET    | /holdings/:id | all    |
| POST   | /holdings     | member |
| PUT    | /holdings/:id | member |
| DELETE | /holdings/:id | member |

### Portfolio & Performance

| Method | Path                  | Description         |
| ------ | --------------------- | ------------------- |
| GET    | /portfolio            | Summary with values |
| GET    | /portfolio/allocation | By asset type       |
| GET    | /performance          | TWR history         |

### Transactions

| Method | Path          | Auth   |
| ------ | ------------- | ------ |
| GET    | /transactions | all    |
| POST   | /transactions | member |

## Services

- `portfolioValuationService` - Holding metrics, FX
- `investmentPerformanceService` - TWR calculations

## Usage

```typescript
import { investmentsRoutes } from "./modules/investments";
app.use("/api/investments", investmentsRoutes);
```
