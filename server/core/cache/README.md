# Cache Module

Redis-backed caching with TTL, tag invalidation, and higher-order functions.
When `REDIS_URL` is configured, async cache paths use the shared Redis client so
cache entries are coherent across app instances. Without Redis, the same API
falls back to the local in-memory store for development and tests.

## Files

| File           | Purpose                       |
| -------------- | ----------------------------- |
| `store.ts`     | CacheStore (Redis async API + local fallback) |
| `withCache.ts` | HOF and decorators            |
| `index.ts`     | Module exports                |

## TTL Presets

```typescript
TTL.SHORT; // 30 seconds
TTL.MEDIUM; // 5 minutes
TTL.LONG; // 30 minutes
TTL.HOUR; // 1 hour
TTL.DAY; // 24 hours
```

## Usage

### Basic Caching

```typescript
import { cacheStore } from "./core/cache";

cacheStore.set("user:123", userData, TTL.MEDIUM);
const cached = cacheStore.get("user:123");
```

### Higher-Order Function

```typescript
import { withCache, TTL } from "./core/cache";

const cachedGetGoals = withCache(goalService.getGoals, "goals:list", {
  ttlMs: TTL.MEDIUM,
  tags: ["goals"],
});

const goals = await cachedGetGoals(householdId);
```

### Tag Invalidation

```typescript
import { invalidateTag, invalidateTags } from "./core/cache";

// Invalidate all entries tagged "goals"
invalidateTag("goals");

// Invalidate multiple tags
invalidateTags(["goals", "accounts"]);
```

### Prefix Invalidation

```typescript
import { invalidatePrefix } from "./core/cache";

// Invalidate all keys starting with "reports:"
invalidatePrefix("reports");
```

## Decorator (Class Methods)

```typescript
import { cached } from "./core/cache";

class ReportService {
  @cached("reports", { ttlMs: TTL.LONG })
  async getSpendingBreakdown(householdId: string) {
    // Expensive calculation
  }
}
```

## Monitoring

```typescript
const stats = cacheStore.getStats();
// { hits: 150, misses: 20, sets: 50, deletes: 5, evictions: 3, size: 42 }

const hitRate = cacheStore.getHitRate();
// 0.88 (88%)
```

## Configuration

```typescript
const cache = new CacheStore({
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxSize: 10000, // Max entries
  checkIntervalMs: 60 * 1000, // Cleanup every 1m
});
```
