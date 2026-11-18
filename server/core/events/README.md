# Events Module (Outbox Pattern)

Reliable event publishing with retry and dead letter handling.

## Files

| File             | Purpose                  |
| ---------------- | ------------------------ |
| `outbox.ts`      | OutboxEventService       |
| `processor.ts`   | Event processor runner   |
| `EventBus.ts`    | In-process event emitter |
| `DomainEvent.ts` | Event factory            |
| `eventTypes.ts`  | Event type constants     |

## Event Lifecycle

```
┌─────────────┐     ┌────────────┐     ┌───────────┐
│   PENDING   │────▶│ PROCESSING │────▶│ COMPLETED │
└─────────────┘     └────────────┘     └───────────┘
                          │
                          ▼ (on error)
                    ┌──────────┐
                    │  FAILED  │──┐
                    └──────────┘  │ retry (up to 5x)
                          ▲       │
                          └───────┘
                          │ (max retries)
                          ▼
                  ┌─────────────┐
                  │ DEAD_LETTER │
                  └─────────────┘
```

## Retry Policy

- **Base delay**: 1 second
- **Max delay**: 5 minutes
- **Formula**: `min(1s * 2^retryCount, 5m)`
- **Max retries**: 5

## Event Types

```typescript
EventTypes.TRANSACTION.CREATED; // "transaction.created"
EventTypes.ACCOUNT.BALANCE_ADJUSTED;
EventTypes.GOAL.COMPLETED;
```

## Usage

```typescript
import { outboxEventService, EventTypes } from "./core/events";

await outboxEventService.publish({
  eventType: EventTypes.TRANSACTION.CREATED,
  aggregateType: "transaction",
  aggregateId: transaction.id,
  householdId,
  payload: { amount, category },
});
```

## Monitoring

```typescript
const stats = await outboxEventService.getStats();
// { pending: 5, processing: 2, completed: 100, failed: 1, deadLetter: 0 }
```
