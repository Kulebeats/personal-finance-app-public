/**
 * AI Redis-backed tool-result cache - Unit Tests (SCP-328)
 *
 * The tool-result cache is backed by the shared Redis client
 * (server/config/redis.ts) when configured, and falls back to an in-process
 * Map otherwise. These tests run WITHOUT Redis and assert the fallback.
 *
 * R17: the per-household chat quota no longer lives in Redis. It is the
 * durable Postgres admission ledger (ai_requests), covered by
 * completion-r17.admission.realdb.integration.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AICache } from "../ai.cache";
import { redis } from "../../../config/redis";

it("runs without Redis configured", () => {
  expect(redis).toBeNull();
});

describe("AI cache async API (SCP-328) - in-memory fallback", () => {
  let cache: AICache;

  beforeEach(() => {
    cache = new AICache();
  });

  it("getAsync returns null on miss", async () => {
    expect(await cache.getAsync("ai:hh:get_budget_status:")).toBeNull();
  });

  it("setAsync then getAsync round-trips via the in-memory L1", async () => {
    const key = cache.generateKey({ householdId: "hh-1", userId: "user-1" }, "get_budget_status", { period: "30d" });
    await cache.setAsync(key, { categories: ["food"] });

    const result = await cache.getAsync<{ categories: string[] }>(key);
    expect(result).toEqual({ categories: ["food"] });

    cache.stop();
  });

  it("invalidateHousehold clears in-memory entries", async () => {
    const key = cache.generateKey({ householdId: "hh-2", userId: "user-2" }, "get_goals_status", {});
    await cache.setAsync(key, { goals: [] });

    const removed = cache.invalidateHousehold("hh-2");
    expect(removed).toBe(1);
    expect(await cache.getAsync(key)).toBeNull();

    cache.stop();
  });
});
