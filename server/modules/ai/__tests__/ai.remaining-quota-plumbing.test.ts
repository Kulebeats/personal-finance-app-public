/**
 * Remaining-quota plumbing: middleware -> controller.
 *
 * The controller used to recover the household's remaining quota by reading
 * back a response header the limiter had set moments earlier in the same
 * request (`res.getHeader('X-RateLimit-Remaining')`) — using the response
 * object as a side channel between two pieces of server code. That coupling
 * made an outbound header name load-bearing for an internal value: renaming
 * the header silently degraded `remainingQueries` to 0 via
 * `parseInt(undefined || '0')`, with no type error and no failing test.
 *
 * The limiter now publishes the value on `req.aiRateLimit`, so the header is
 * purely an outbound concern. These tests pin that: the quota reaches the
 * handler correctly, and it does so WITHOUT depending on any header.
 *
 * @module ai/__tests__/ai.remaining-quota-plumbing.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

vi.mock("../ai.tracking", () => ({
  aiTracking: { trackRateLimitHit: vi.fn() },
}));

vi.mock("../../../config/redis", async () => {
  const actual =
    await vi.importActual<typeof import("../../../config/redis")>(
      "../../../config/redis",
    );
  return {
    ...actual,
    redisIncrementWithTtl: vi.fn(async () => null),
    redisReadCounter: vi.fn(async () => null),
  };
});

import { rateLimitMiddleware } from "../ai.middleware";
import { redisIncrementWithTtl } from "../../../config/redis";

const RATE_LIMIT_MAX = 50;

type LimiterReqFields = {
  householdContext: { householdId: string };
  user: { id: string };
};

/**
 * App whose handler reports what it can see of the remaining quota, mirroring
 * how `ai.controller` builds `remainingQueries`. `stripHeaders` simulates the
 * header being renamed or absent, proving the handler no longer depends on it.
 */
function makeApp(householdId: string, stripHeaders = false) {
  const app = express();
  app.post(
    "/api/ai/chat",
    (req: Request, _res: Response, next: NextFunction) => {
      const stub = req as unknown as LimiterReqFields;
      stub.householdContext = { householdId };
      stub.user = { id: "user-1" };
      next();
    },
    rateLimitMiddleware,
    (req: Request, res: Response) => {
      if (stripHeaders) {
        res.removeHeader("RateLimit-Limit");
        res.removeHeader("RateLimit-Remaining");
        res.removeHeader("RateLimit-Reset");
      }
      res.status(200).json({
        success: true,
        data: { remainingQueries: req.aiRateLimit?.remaining ?? null },
      });
    },
  );
  return app;
}

describe("AI remaining-quota plumbing (middleware -> controller)", () => {
  beforeEach(() => {
    vi.mocked(redisIncrementWithTtl).mockResolvedValue(null);
  });

  it("publishes the remaining quota on req for the handler to read", async () => {
    const app = makeApp(`hh-plumb-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.status).toBe(200);
    // First query of the window: one consumed, 49 left.
    expect(res.body.data.remainingQueries).toBe(RATE_LIMIT_MAX - 1);
  });

  it("decrements across successive requests", async () => {
    const app = makeApp(`hh-plumb-dec-${Date.now()}-${Math.random()}`);

    await request(app).post("/api/ai/chat").send({ message: "hi" });
    await request(app).post("/api/ai/chat").send({ message: "hi" });
    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.body.data.remainingQueries).toBe(RATE_LIMIT_MAX - 3);
  });

  it("still reports the quota when the response headers are stripped", async () => {
    // The decisive assertion: the value survives with no rate-limit header on
    // the response at all, so the header name is not load-bearing internally.
    const app = makeApp(`hh-plumb-strip-${Date.now()}-${Math.random()}`, true);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.headers["ratelimit-remaining"]).toBeUndefined();
    expect(res.body.data.remainingQueries).toBe(RATE_LIMIT_MAX - 1);
  });

  it("reports the Redis-backed count when Redis is the source of truth", async () => {
    vi.mocked(redisIncrementWithTtl).mockResolvedValue({
      count: 10,
      ttlSeconds: 3600,
    });
    const app = makeApp(`hh-plumb-redis-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.body.data.remainingQueries).toBe(RATE_LIMIT_MAX - 10);
  });
});
