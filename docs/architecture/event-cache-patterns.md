# Event Handler & Cache Patterns Guide

## Event Handler Registration

### Basic Handler Registration

```typescript
import { EventBus, EventTypes, createEvent } from "./core/events";

// Register a handler for transaction events
EventBus.on(EventTypes.TRANSACTION_CREATED, async (event) => {
  const { aggregateId, payload, householdId } = event;

  // Update analytics cache
  await invalidateOnChange("transaction", householdId);

  // Trigger notifications
  await notificationService.checkBudgetAlerts(householdId);
});
```

### Handler with Error Handling

```typescript
EventBus.on(EventTypes.ACCOUNT_BALANCE_CHANGED, async (event) => {
  try {
    await goalService.recalculateProgress(event.payload.accountId);
    await snapshotService.updateDailySnapshot(event.householdId);
  } catch (error) {
    logger.error("Failed to process balance change", {
      eventId: event.eventId,
      error: error.message,
    });
    // Don't rethrow - let outbox handle retries
    throw error;
  }
});
```

### Common Event Handler Patterns

| Event                       | Common Handler Actions                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `transaction.created`       | Invalidate reports cache, check budget alerts, update goal progress |
| `account.balance_changed`   | Update net worth snapshot, recalculate goal progress                |
| `goal.completed`            | Send notification, log achievement                                  |
| `budget.threshold_exceeded` | Send alert notification                                             |

---

## Cache Invalidation Patterns

### Pattern 1: Tag-Based Invalidation (Recommended)

Best for related data that changes together:

```typescript
import { withCache, invalidateTag, TTL } from "./core/cache";

// Cache with tags
const getSpendingReport = withCache(
  reportService.getSpendingBreakdown,
  "reports:spending",
  { ttlMs: TTL.LONG, tags: ["reports", "transactions"] }
);

// Invalidate all reports when transaction changes
EventBus.on(EventTypes.TRANSACTION_CREATED, async () => {
  invalidateTag("reports");
});
```

### Pattern 2: Prefix-Based Invalidation

Best for user/household-specific data:

```typescript
import { invalidatePrefix } from "./core/cache";

// Cache key includes householdId
const cacheKey = `reports:${householdId}:spending`;

// Invalidate all keys for this household
invalidatePrefix(`reports:${householdId}`);
```

### Pattern 3: Selective Invalidation

Best for fine-grained control:

```typescript
import { cacheStore } from "./core/cache";

// Invalidate specific key
cacheStore.delete(`account:${accountId}:balance`);

// Invalidate by pattern
cacheStore.deleteByPattern(/^goals:\d+:progress$/);
```

### TTL Recommendations by Data Type

| Data Type         | Recommended TTL    | Rationale            |
| ----------------- | ------------------ | -------------------- |
| User preferences  | `TTL.DAY`          | Rarely changes       |
| Account balances  | `TTL.SHORT` (30s)  | Updates frequently   |
| Reports           | `TTL.LONG` (30min) | Expensive to compute |
| Net worth history | `TTL.HOUR`         | Updated daily        |
| Category lists    | `TTL.DAY`          | Static data          |

---

## Jobs vs Events: When to Use Which

### Use Events When:

- Real-time reaction needed (< 1 second)
- Multiple handlers may respond
- Failure should retry automatically
- Order doesn't matter

```typescript
// Good for events: Budget alert after transaction
outboxEventService.publish({
  eventType: EventTypes.TRANSACTION_CREATED,
  aggregateType: "transaction",
  aggregateId: transaction.id,
  householdId,
  payload: { amount, categoryId },
});
```

### Use Jobs When:

- Scheduled/recurring task
- Single handler only
- Needs priority ordering
- Requires idempotency guarantee
- Long-running operation

```typescript
// Good for jobs: Daily snapshot calculation
jobService.enqueue(JobTypes.DAILY_SNAPSHOTS, {
  idempotencyKey: `snapshots-${date}`,
  runAt: midnight,
  priority: 10,
});
```

### Decision Matrix

| Scenario                | Use   | Reason                       |
| ----------------------- | ----- | ---------------------------- |
| Send email after signup | Event | Real-time, can retry         |
| Generate monthly report | Job   | Scheduled, idempotent        |
| Update cache after edit | Event | Real-time reaction           |
| Process CSV import      | Job   | Long-running, single handler |
| Notify budget exceeded  | Event | Multiple subscribers         |
| Cleanup old data        | Job   | Scheduled, low priority      |

### Hybrid Pattern

For complex workflows, combine both:

```typescript
// Transaction creation: Event for immediate reactions
await outboxEventService.publish({
  eventType: EventTypes.TRANSACTION_CREATED,
  ...
});

// Scheduled job picks up heavy processing later
await jobService.enqueue(JobTypes.ANALYTICS_REFRESH, {
  runAt: new Date(Date.now() + 60000), // 1 min later
  priority: 5,
});
```
