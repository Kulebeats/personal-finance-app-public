/**
 * AI Redis-Backed Rate Limit + Cache - Unit Tests (SCP-328)
 *
 * The AI per-household rate limiter and tool-result cache are backed by the
 * shared Redis client (server/config/redis.ts) when configured, and fall back
 * to in-process Maps otherwise. These tests run WITHOUT Redis and assert the
 * fallback behaviour: the 50/day household cap is still enforced, and the cache
 * stores/serves via L1.
 *
 * Cross-instance enforcement (the point of moving off in-process Maps) requires
 * a real Redis and is not verifiable here.
 *
 * @module ai/__tests__/ai.redis-backend.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { RateLimitError } from "../../../core/errors/RateLimitError";

// Avoid posthog/logger side effects from the tracking singleton.
vi.mock("../ai.tracking", () => ({
  aiTracking: {
    trackRateLimitHit: vi.fn(),
  },
}));

import { rateLimitMiddleware, getRateLimitStatus } from "../ai.middleware";
import { AICache } from "../ai.cache";
import { redis } from "../../../config/redis";

// Minimal Express stubs for middleware testing.
function makeReqRes(householdId: string): {
  req: Request;
  res: Response;
  next: ReturnType<typeof vi.fn> & NextFunction;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const req = {
    householdContext: { householdId },
    user: { id: "user-1" },
  } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response;
  const next = vi.fn() as unknown as ReturnType<typeof vi.fn> & NextFunction;
  return { req, res, next, headers };
}

describe("AI rate limit middleware (SCP-328) - in-memory fallback", () => {
  it("runs without Redis configured", () => {
    expect(redis).toBeNull();
  });

  it("allows the first request and sets quota headers", async () => {
    const hh = `hh-allow-${Date.now()}`;
    const { req, res, next, headers } = makeReqRes(hh);

    await rateLimitMiddleware(req, res, next);

    // next() called with no error means the request passed.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(headers["RateLimit-Limit"]).toBe("50");
    expect(headers["RateLimit-Remaining"]).toBe("49");
  });

  it("enforces the 50-queries-per-household cap (51st is rejected)", async () => {
    const hh = `hh-cap-${Date.now()}`;

    // 50 allowed.
    for (let i = 0; i < 50; i++) {
      const { req, res, next } = makeReqRes(hh);
      await rateLimitMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    }

    // 51st rejected with RateLimitError.
    const { req, res, next } = makeReqRes(hh);
    await rateLimitMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBeGreaterThan(0);
  });

  it("isolates quota per household", async () => {
    const hhA = `hh-iso-a-${Date.now()}`;
    const hhB = `hh-iso-b-${Date.now()}`;

    // Exhaust A.
    for (let i = 0; i < 50; i++) {
      const { req, res, next } = makeReqRes(hhA);
      await rateLimitMiddleware(req, res, next);
    }
    const { req: reqA, res: resA, next: nextA } = makeReqRes(hhA);
    await rateLimitMiddleware(reqA, resA, nextA);
    expect(nextA.mock.calls[0][0]).toBeInstanceOf(RateLimitError);

    // B still has full quota.
    const { req: reqB, res: resB, next: nextB } = makeReqRes(hhB);
    await rateLimitMiddleware(reqB, resB, nextB);
    expect(nextB).toHaveBeenCalledWith();
  });

  it("getRateLimitStatus reflects consumed quota without consuming more", async () => {
    const hh = `hh-status-${Date.now()}`;

    const before = await getRateLimitStatus(hh);
    expect(before.remaining).toBe(50);
    expect(before.isLimited).toBe(false);

    const { req, res, next } = makeReqRes(hh);
    await rateLimitMiddleware(req, res, next);

    const after = await getRateLimitStatus(hh);
    expect(after.remaining).toBe(49);
    expect(after.isLimited).toBe(false);

    // Reading status again must not decrement.
    const again = await getRateLimitStatus(hh);
    expect(again.remaining).toBe(49);
  });
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
    const key = cache.generateKey("hh-1", "get_budget_status", { period: "30d" });
    await cache.setAsync(key, { categories: ["food"] });

    const result = await cache.getAsync<{ categories: string[] }>(key);
    expect(result).toEqual({ categories: ["food"] });

    cache.stop();
  });

  it("invalidateHousehold clears in-memory entries", async () => {
    const key = cache.generateKey("hh-2", "get_goals_status", {});
    await cache.setAsync(key, { goals: [] });

    const removed = cache.invalidateHousehold("hh-2");
    expect(removed).toBe(1);
    expect(await cache.getAsync(key)).toBeNull();

    cache.stop();
  });
});
