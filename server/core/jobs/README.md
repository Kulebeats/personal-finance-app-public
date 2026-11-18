# Jobs Module

Background job queue with scheduling, retry, and idempotency.

## Files

| File         | Purpose                           |
| ------------ | --------------------------------- |
| `service.ts` | JobService (enqueue, run, cancel) |
| `runner.ts`  | Background job processor          |
| `index.ts`   | Module exports                    |

## Job Lifecycle

```
┌─────────────┐     ┌─────────┐     ┌───────────┐
│   PENDING   │────▶│ RUNNING │────▶│ COMPLETED │
└─────────────┘     └─────────┘     └───────────┘
      ▲                   │
      │                   ▼ (on error)
      │             ┌──────────┐
      └─────────────│  FAILED  │  (retry with backoff)
                    └──────────┘
                          │ (max attempts)
                          ▼
                    ┌───────────┐
                    │ CANCELLED │ (manual)
                    └───────────┘
```

## Retry Policy

- **Delay formula**: `min(1m * 5^(attempt-1), 1h)`
- **Default max attempts**: 3
- **Delays**: 1m → 5m → 25m

## Job Types

```typescript
JobTypes.DAILY_SNAPSHOTS;
JobTypes.RECURRING_TRANSACTIONS;
JobTypes.BUDGET_ALERTS;
JobTypes.GOALS_STATUS;
JobTypes.MARKET_DATA;
JobTypes.WEEKLY_RECAP;
```

## Usage

### Enqueue a Job

```typescript
import { jobService, JobTypes } from "./core/jobs";

await jobService.enqueue(JobTypes.DAILY_SNAPSHOTS, {
  payload: { date: "2024-01-15" },
  runAt: new Date("2024-01-15T00:00:00Z"),
  priority: 10, // Higher = runs first
  idempotencyKey: "snapshots-2024-01-15", // Prevents duplicates
});
```

### Register Handler

```typescript
jobService.registerHandler(JobTypes.DAILY_SNAPSHOTS, async (job) => {
  await calculateSnapshots(job.payload.date);
  return { recordsCreated: 50 };
});
```

### Start Runner

```typescript
import { startRunner } from "./core/jobs";

startRunner({ intervalMs: 30000, batchSize: 5 });
```

## Monitoring

```typescript
const stats = await jobService.getStats();
// { pending: 10, running: 2, completed: 500, failed: 3, cancelled: 1 }
```

## Cleanup

```typescript
await jobService.cleanup(7); // Delete jobs older than 7 days
```
