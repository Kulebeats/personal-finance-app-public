# Event & Job Lifecycle Documentation

## Event Lifecycle (Outbox Pattern)

### State Diagram

```
                              ┌─────────────────────────────────┐
                              │                                 │
                              ▼                                 │
┌──────────┐   publish()   ┌─────────┐   markProcessing()   ┌────────────┐
│          │──────────────▶│ PENDING │─────────────────────▶│ PROCESSING │
│ (start)  │               └─────────┘                      └────────────┘
└──────────┘                    ▲                                 │
                                │                                 │
                                │ retry (< maxRetries)            │
                                │                                 │
                           ┌────────┐◀──────────────────────┘ (on error)
                           │ FAILED │
                           └────────┘
                                │
                                │ (maxRetries exceeded)
                                ▼
                         ┌─────────────┐   retryDeadLetter()   ┌─────────┐
                         │ DEAD_LETTER │──────────────────────▶│ PENDING │
                         └─────────────┘                       └─────────┘

                                                ┌───────────┐
                                                │ COMPLETED │◀── (on success)
                                                └───────────┘
```

### Status Definitions

| Status        | Description                                       |
| ------------- | ------------------------------------------------- |
| `pending`     | Event awaiting processing                         |
| `processing`  | Event currently being handled (claimed by worker) |
| `completed`   | Event successfully processed                      |
| `failed`      | Event failed, will retry                          |
| `dead_letter` | Permanently failed after max retries              |

### Retry Policy

| Retry # | Delay    | Cumulative Wait |
| ------- | -------- | --------------- |
| 1       | 2s       | 2s              |
| 2       | 4s       | 6s              |
| 3       | 8s       | 14s             |
| 4       | 16s      | 30s             |
| 5       | 32s      | 62s             |
| Max     | 5min cap | -               |

**Formula**: `min(1s × 2^retryCount, 5min)`

### Concurrency Protection

```typescript
// Atomic claim - prevents race conditions
const claimed = await markProcessing(eventId);
if (!claimed) return; // Another worker got it
```

---

## Job Lifecycle

### State Diagram

```
                                     ┌─────────────────────────────┐
                                     │                             │
                                     ▼                             │
┌──────────┐   enqueue()   ┌─────────┐   run() + claim   ┌─────────┐
│          │──────────────▶│ PENDING │─────────────────▶│ RUNNING │
│ (start)  │               └─────────┘                  └─────────┘
└──────────┘                    ▲                            │
                                │                            │
                                │ retry (< maxAttempts)      │
                                │                            │
                                └────────────────────────┘ (on error)


    ┌───────────┐                              ┌──────────┐
    │ CANCELLED │◀─── cancel()                 │ COMPLETED │◀── (on success)
    └───────────┘                              └──────────┘

    ┌────────┐
    │ FAILED │◀── (maxAttempts exceeded)
    └────────┘
```

### Status Definitions

| Status      | Description                       |
| ----------- | --------------------------------- |
| `pending`   | Job scheduled, awaiting execution |
| `running`   | Job currently executing           |
| `completed` | Job finished successfully         |
| `failed`    | Job permanently failed            |
| `cancelled` | Job manually cancelled            |

### Retry Policy

| Attempt | Delay After Failure | Cumulative Wait |
| ------- | ------------------- | --------------- |
| 1       | 1 minute            | 1m              |
| 2       | 5 minutes           | 6m              |
| 3       | 25 minutes          | 31m             |
| Max     | 1 hour cap          | -               |

**Formula**: `min(1m × 5^(attempt-1), 1h)`

### Idempotency

```typescript
// Prevents duplicate job execution
await jobService.enqueue("daily_snapshots", {
  idempotencyKey: "snapshots-2024-01-15", // Unique key
  runAt: new Date("2024-01-15T00:00:00Z"),
});
```

### Priority Queue

Jobs are processed in order:

1. **Priority** (higher first)
2. **runAt** (earlier first)

```sql
ORDER BY priority DESC, run_at ASC
```

---

## Database Schema

### outbox_events

```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  household_id UUID,
  payload JSONB NOT NULL,
  status outbox_event_status DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMP,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);
```

### jobs

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  payload JSONB,
  status job_status DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  idempotency_key VARCHAR(255),
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);
```

---

## Monitoring

### Event Stats

```typescript
const stats = await outboxEventService.getStats();
// { pending: 5, processing: 2, completed: 100, failed: 1, deadLetter: 0 }
```

### Job Stats

```typescript
const stats = await jobService.getStats();
// { pending: 10, running: 2, completed: 500, failed: 3, cancelled: 1 }
```

### Cleanup

```typescript
// Remove old completed/failed jobs
await jobService.cleanup(7); // Older than 7 days
```
