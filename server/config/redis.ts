import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getProductionRedis } from "./redis/production-slot.mjs";
import { logger } from "../utils/logger";

// A refused/revoked installed profile must never fall back to REDIS_URL.
export const productionRedis = getProductionRedis();

// Ordinary Redis remains optional in development. The admitted profile owns its
// connection privately and does not construct a second ioredis client here.
export let redis: Redis | null = null;

if (!productionRedis && process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on("error", (err) => {
    logger.error("Redis Client Error", {}, err);
  });

  redis.on("connect", () => {
    logger.info("Redis Client Connected");
  });
} else {
  logger.info("Redis not configured - caching disabled (set REDIS_URL to enable)");
}

/**
 * Whether a shared Redis client is configured.
 *
 * The whole app degrades gracefully when this is false in development/test.
 * Production startup validation requires REDIS_URL so rate limits, scheduled
 * jobs, and AI rate-limit/cache counters are cluster-wide.
 */
export function isRedisEnabled(): boolean {
  if (productionRedis) {
    productionRedis.assertCurrent();
    return true;
  }
  return redis !== null;
}

/**
 * Required scheduled work needs no Redis capability: job locks are Postgres
 * advisory locks (server/core/scheduling/advisoryLock.ts), outside the cache
 * namespace and its eviction (OPS-013). An admitted profile must still be
 * current, so a revoked profile keeps failing closed.
 */
export function assertRequiredJobCapabilities(): void {
  if (!productionRedis) return;
  productionRedis.assertCurrent();
}

// ============================================================================
// DISTRIBUTED LOCK (SCP-308)
// ============================================================================

export type RedisLockClient = {
  set: (
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    condition: "NX",
  ) => Promise<"OK" | null>;
  eval: (
    script: string,
    keyCount: number,
    key: string,
    expectedValue: string,
  ) => Promise<unknown>;
};

const RELEASE_LOCK_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

type RedisLockOptions = {
  failClosedOnAcquisitionError?: boolean;
};

export async function runWithRedisLockClient<T>(
  client: RedisLockClient,
  lockKey: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  options: RedisLockOptions = {},
): Promise<{ ran: boolean; result?: T }> {
  const lockOwnerToken = randomUUID();
  let acquired = false;

  try {
    const res = await client.set(
      lockKey,
      lockOwnerToken,
      "EX",
      ttlSeconds,
      "NX",
    );
    acquired = res === "OK";
  } catch (error) {
    logger.error("Redis lock acquisition failed", {
      lockKey,
      error,
    });

    if (options.failClosedOnAcquisitionError) {
      throw new Error("Redis lock acquisition failed", { cause: error });
    }

    const result = await fn();
    return { ran: true, result };
  }

  if (!acquired) {
    logger.debug("Skipping work; lock held by another instance", { lockKey });
    return { ran: false };
  }

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      await client.eval(
        RELEASE_LOCK_IF_OWNER_SCRIPT,
        1,
        lockKey,
        lockOwnerToken,
      );
    } catch (error) {
      // Lock will expire on its own via TTL; log and move on.
      logger.warn("Failed to release Redis lock (will expire via TTL)", {
        lockKey,
        error,
      });
    }
  }
}

/**
 * Run `fn` while holding a cluster-wide lock keyed by `lockKey`.
 *
 * Backed by Redis `SET key value EX ttl NX` (the same primitive used by the
 * snapshot worker). Only one instance can hold a given lock at a time, so
 * scheduled jobs registered on every instance run exactly once cluster-wide.
 *
 * Graceful degradation: in development/test without Redis, `fn` runs directly.
 * Production requires Redis at startup, so scheduled jobs do not silently
 * double-fire under horizontal scaling.
 *
 * @param lockKey   Unique key for the critical section (e.g. "scheduler:lock:daily-recap").
 * @param ttlSeconds Lock auto-expiry, a safety net if the holder crashes mid-run.
 * @param fn        The work to run while holding the lock.
 * @returns true if the work ran on this instance, false if another holder had the lock.
 */
export async function withRedisLock<T>(
  lockKey: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  if (productionRedis) {
    productionRedis.assertCurrent();
    // No scheduler-lock contract is exposed by this profile facade.
    throw new Error("REDIS_PROFILE_LOCK_UNAVAILABLE");
  }
  // No Redis => single instance => no contention, just run it.
  if (!redis) {
    const result = await fn();
    return { ran: true, result };
  }

  return runWithRedisLockClient(redis, lockKey, ttlSeconds, fn, {
    failClosedOnAcquisitionError: process.env.NODE_ENV === "production",
  });
}

// ============================================================================
// SHARED COUNTER + CACHE HELPERS (SCP-328)
// ============================================================================

/**
 * Atomically increment a counter and ensure it has an expiry.
 *
 * Used to back per-household rate limiting cluster-wide. Returns the new
 * counter value and the remaining TTL in seconds. Returns `null` when Redis
 * is unavailable so callers can fall back to their in-process implementation.
 */
export async function redisIncrementWithTtl(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttlSeconds: number } | null> {
  if (productionRedis) return productionRedis.quota.increment(key, windowSeconds);
  if (!redis) return null;

  try {
    const count = await redis.incr(key);
    // Set expiry only when the key is first created (count === 1) so the
    // window slides per fixed interval rather than resetting on every hit.
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    let ttlSeconds = await redis.ttl(key);
    // -1 = no expiry set (shouldn't happen, but heal it), -2 = key gone.
    if (ttlSeconds < 0) {
      await redis.expire(key, windowSeconds);
      ttlSeconds = windowSeconds;
    }
    return { count, ttlSeconds };
  } catch (error) {
    logger.warn("Redis increment failed, falling back to in-memory", {
      key,
      error,
    });
    return null;
  }
}

/**
 * Read the current value + TTL of a counter without incrementing it.
 * Returns `null` when Redis is unavailable or the key does not exist.
 */
export async function redisReadCounter(
  key: string,
): Promise<{ count: number; ttlSeconds: number } | null> {
  if (productionRedis) return productionRedis.quota.read(key);
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    const count = Number.parseInt(raw, 10);
    if (Number.isNaN(count)) return null;
    const ttlSeconds = await redis.ttl(key);
    return { count, ttlSeconds: ttlSeconds < 0 ? 0 : ttlSeconds };
  } catch (error) {
    logger.warn("Redis read counter failed", { key, error });
    return null;
  }
}

/**
 * Get a JSON value from the shared cache. Returns `null` on miss, Redis
 * outage, or when Redis is not configured (caller should fall back).
 */
export async function redisGetJson<T>(key: string): Promise<T | null> {
  if (productionRedis) return productionRedis.cache.getJson<T>(key);
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn("Redis getJson failed", { key, error });
    return null;
  }
}

/**
 * Store a JSON value in the shared cache with a TTL. No-op (returns false)
 * when Redis is unavailable so the caller knows to keep its local copy.
 */
export async function redisSetJson<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<boolean> {
  if (productionRedis) return productionRedis.cache.setJson(key, value, ttlSeconds);
  if (!redis) return false;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.warn("Redis setJson failed", { key, error });
    return false;
  }
}

/**
 * Delete a single key from Redis. Returns false when Redis is unavailable or
 * the delete fails, allowing callers to fall back to local invalidation.
 */
export async function redisDeleteKey(key: string): Promise<boolean> {
  if (productionRedis) return productionRedis.cache.deleteKey(key);
  if (!redis) return false;
  try {
    const deleted = await redis.del(key);
    return deleted > 0;
  } catch (error) {
    logger.warn("Redis delete key failed", { key, error });
    return false;
  }
}

/**
 * Delete all keys matching a prefix using a non-blocking SCAN stream.
 * No-op when Redis is unavailable.
 */
export async function redisDeleteByPrefix(prefix: string): Promise<number> {
  if (productionRedis) return productionRedis.cache.deleteByPrefix(prefix);
  if (!redis) return 0;

  return new Promise<number>((resolve) => {
    let deleted = 0;
    try {
      const stream = redis!.scanStream({ match: `${prefix}*`, count: 100 });
      stream.on("data", (keys: string[]) => {
        if (keys.length) {
          const pipeline = redis!.pipeline();
          keys.forEach((key) => pipeline.del(key));
          pipeline.exec();
          deleted += keys.length;
        }
      });
      stream.on("end", () => resolve(deleted));
      stream.on("error", (error) => {
        logger.warn("Redis deleteByPrefix stream error", { prefix, error });
        resolve(deleted);
      });
    } catch (error) {
      logger.warn("Redis deleteByPrefix failed", { prefix, error });
      resolve(deleted);
    }
  });
}
