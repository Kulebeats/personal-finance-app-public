/**
 * Redis Infrastructure - Unit/Integration Tests (SCP-307 / SCP-308 / SCP-328)
 *
 * These tests run WITHOUT a Redis server. The local dev/test environment has no
 * REDIS_URL, so every helper here exercises the graceful-degradation path:
 *  - distributed lock runs the job directly (single instance, no contention)
 *  - counter/cache helpers return their "no Redis" sentinel so callers fall back
 *  - all rate limiters are still constructed (in-memory store)
 *  - the AI per-household limiter + cache fall back to in-process Maps
 *
 * Cross-instance enforcement (the actual distributed behaviour) requires a real
 * Redis and is NOT verifiable here — see the unit summary / blockers.
 *
 * @module config/__tests__/redis-infra.test
 */

import { describe, it, expect, vi } from "vitest";
import {
  redis,
  isRedisEnabled,
  withRedisLock,
  runWithRedisLockClient,
  redisIncrementWithTtl,
  redisReadCounter,
  redisGetJson,
  redisSetJson,
  redisDeleteKey,
  redisDeleteByPrefix,
} from "../redis";
import type { RedisLockClient } from "../redis";

// ---------------------------------------------------------------------------
// Precondition: no Redis in this environment (asserts we are testing fallback)
// ---------------------------------------------------------------------------
describe("Redis configuration (no REDIS_URL)", () => {
  it("has no Redis client configured in the test environment", () => {
    expect(process.env.REDIS_URL).toBeFalsy();
    expect(redis).toBeNull();
    expect(isRedisEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCP-308: distributed lock falls back to running directly without Redis
// ---------------------------------------------------------------------------
describe("withRedisLock (SCP-308) - fallback without Redis", () => {
  it("runs the job directly and reports ran=true when Redis is unset", async () => {
    let executed = false;
    const out = await withRedisLock("scheduler:lock:test-job", 60, async () => {
      executed = true;
      return "done";
    });

    expect(executed).toBe(true);
    expect(out.ran).toBe(true);
    expect(out.result).toBe("done");
  });

  it("runs back-to-back invocations (no lock retained across calls)", async () => {
    const runs: number[] = [];
    await withRedisLock("scheduler:lock:test-job", 60, async () => {
      runs.push(1);
    });
    await withRedisLock("scheduler:lock:test-job", 60, async () => {
      runs.push(2);
    });
    expect(runs).toEqual([1, 2]);
  });

  it("propagates errors from the wrapped job", async () => {
    await expect(
      withRedisLock("scheduler:lock:err", 60, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("runWithRedisLockClient (SCP-308) - Redis-backed lock semantics", () => {
  type RedisLockClientMock = {
    set: ReturnType<typeof vi.fn<RedisLockClient["set"]>>;
    eval: ReturnType<typeof vi.fn<RedisLockClient["eval"]>>;
  };

  const makeClient = (overrides: {
    set?: RedisLockClientMock["set"];
    eval?: RedisLockClientMock["eval"];
  } = {}): RedisLockClientMock => ({
    set: overrides.set ?? vi.fn<RedisLockClient["set"]>(async () => "OK"),
    eval: overrides.eval ?? vi.fn<RedisLockClient["eval"]>(async () => 1),
  });

  it("skips work when another instance already holds the lock", async () => {
    const client = makeClient({
      set: vi.fn<RedisLockClient["set"]>(async () => null),
    });
    const job = vi.fn(async () => "done");

    const result = await runWithRedisLockClient(
      client,
      "scheduler:lock:test-job",
      60,
      job,
      { failClosedOnAcquisitionError: true },
    );

    expect(result).toEqual({ ran: false });
    expect(job).not.toHaveBeenCalled();
    expect(client.eval).not.toHaveBeenCalled();
  });

  it("fails closed without running work when Redis acquisition fails in production mode", async () => {
    const client = makeClient({
      set: vi.fn<RedisLockClient["set"]>(async () => {
        throw new Error("redis unavailable");
      }),
    });
    const job = vi.fn(async () => "done");

    await expect(
      runWithRedisLockClient(
        client,
        "scheduler:lock:test-job",
        60,
        job,
        { failClosedOnAcquisitionError: true },
      ),
    ).rejects.toThrow("Redis lock acquisition failed");

    expect(job).not.toHaveBeenCalled();
    expect(client.eval).not.toHaveBeenCalled();
  });

  it("releases the lock with an owner-token compare/delete script after work runs", async () => {
    const client = makeClient();
    const job = vi.fn(async () => "done");

    const result = await runWithRedisLockClient(
      client,
      "scheduler:lock:test-job",
      60,
      job,
      { failClosedOnAcquisitionError: true },
    );

    expect(result).toEqual({ ran: true, result: "done" });
    expect(job).toHaveBeenCalledTimes(1);

    const setArgs = client.set.mock.calls[0];
    expect(setArgs[0]).toBe("scheduler:lock:test-job");
    expect(typeof setArgs[1]).toBe("string");
    expect(setArgs[1]).not.toBe("1");
    expect(setArgs.slice(2)).toEqual(["EX", 60, "NX"]);

    const evalArgs = client.eval.mock.calls[0];
    expect(evalArgs[0]).toContain("redis.call(\"get\", KEYS[1])");
    expect(evalArgs[0]).toContain("redis.call(\"del\", KEYS[1])");
    expect(evalArgs.slice(1)).toEqual([
      1,
      "scheduler:lock:test-job",
      setArgs[1],
    ]);
  });
});

// ---------------------------------------------------------------------------
// SCP-328 backend helpers: return fallback sentinels without Redis
// ---------------------------------------------------------------------------
describe("Redis counter/cache helpers - fallback without Redis", () => {
  it("redisIncrementWithTtl returns null so callers fall back", async () => {
    const result = await redisIncrementWithTtl("ai:ratelimit:hh-1", 86400);
    expect(result).toBeNull();
  });

  it("redisReadCounter returns null without Redis", async () => {
    expect(await redisReadCounter("ai:ratelimit:hh-1")).toBeNull();
  });

  it("redisGetJson returns null without Redis", async () => {
    expect(await redisGetJson("ai:cache:key")).toBeNull();
  });

  it("redisSetJson returns false (not stored) without Redis", async () => {
    expect(await redisSetJson("ai:cache:key", { a: 1 }, 300)).toBe(false);
  });

  it("redisDeleteKey returns false without Redis", async () => {
    expect(await redisDeleteKey("ai:cache:key")).toBe(false);
  });

  it("redisDeleteByPrefix returns 0 without Redis", async () => {
    expect(await redisDeleteByPrefix("ai:cache:")).toBe(0);
  });
});
