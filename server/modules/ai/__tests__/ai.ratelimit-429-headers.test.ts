/**
 * AI Rate Limit - 429 Header Ergonomics (v1.1 Workstream C)
 *
 * A 429 from the AI limiter must be self-describing: it carries the full
 * RateLimit-* trio plus a Retry-After so the client can render "resets in
 * about N hours" WITHOUT an extra GET /api/ai/status round-trip.
 *
 * HEADER DIALECT: these are the IETF draft-6 `RateLimit-*` headers, which is
 * what `express-rate-limit` already emits for the other eight limiters
 * (server/middleware/rateLimit.ts sets `standardHeaders: true`). The AI limiter
 * previously hand-rolled an `X-RateLimit-*` set whose `Reset` was an ISO
 * timestamp rather than delta-seconds, so the same conceptual field carried two
 * incompatible types depending on which route you hit. One dialect now, and
 * `Reset` is delta-seconds everywhere — matching `Retry-After` too.
 *
 * These tests drive a REAL Express app through supertest so they prove the
 * headers survive the global error middleware onto the actual HTTP response —
 * not merely that res.setHeader was called.
 *
 * The app under test mounts `apiErrorMiddleware` (server/utils/errorHandler),
 * which is what `server/app.ts:265` actually mounts — NOT the `errorHandler`
 * exported from server/core/errors, which is dead code no app mounts.
 *
 * Both limiter backends are covered: the in-process Map fallback (no Redis
 * configured, as in CI) and the Redis-backed path (helper mocked).
 *
 * @module ai/__tests__/ai.ratelimit-429-headers.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { apiErrorMiddleware } from "../../../utils/errorHandler";

// Avoid posthog/logger side effects from the tracking singleton.
vi.mock("../ai.tracking", () => ({
  aiTracking: {
    trackRateLimitHit: vi.fn(),
  },
}));

// The Redis helpers are mocked so we can exercise BOTH limiter backends.
// Default: return null => middleware uses the in-process Map fallback.
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
const WINDOW_SECONDS = 24 * 60 * 60;

/**
 * The limiter reads only `householdContext.householdId` and `user.id`. Stub
 * exactly that surface rather than fabricating a full User/HouseholdContext.
 */
type LimiterReqFields = {
  householdContext: { householdId: string };
  user: { id: string };
};

/** Minimal app: auth context stub -> limiter -> 200, with the real error middleware. */
function makeApp(householdId: string) {
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
    (_req: Request, res: Response) => {
      res.status(200).json({ success: true, data: { reply: "ok" } });
    },
  );
  app.use(apiErrorMiddleware);
  return app;
}

/** Burn the household's quota so the next request is the 429. */
async function exhaustQuota(app: express.Express): Promise<void> {
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });
    expect(res.status).toBe(200);
  }
}

describe("AI limiter 429 headers (Workstream C) - in-process fallback", () => {
  beforeEach(() => {
    vi.mocked(redisIncrementWithTtl).mockResolvedValue(null);
  });

  it("still sets the full header trio on the admitted path (no regression)", async () => {
    const app = makeApp(`hh-admit-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("50");
    expect(res.headers["ratelimit-remaining"]).toBe("49");
    expect(res.headers["ratelimit-reset"]).toBeDefined();
    // Retry-After is meaningless on a 200 and must not be sent.
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("no longer emits the legacy X-RateLimit-* dialect", async () => {
    const app = makeApp(`hh-legacy-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    // Emitting both families would leave two sources of truth for the same
    // quota, and the legacy Reset carried an incompatible type (ISO vs
    // delta-seconds). Exactly one dialect on the wire.
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(res.headers["x-ratelimit-reset"]).toBeUndefined();
  });

  it("sets RateLimit-* and Retry-After on the 429 response itself", async () => {
    const app = makeApp(`hh-429-${Date.now()}-${Math.random()}`);
    await exhaustQuota(app);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");

    // The headers must survive the global errorHandler onto the real response.
    expect(res.headers["ratelimit-limit"]).toBe("50");
    expect(res.headers["ratelimit-remaining"]).toBe("0");
    expect(res.headers["ratelimit-reset"]).toBeDefined();
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("sends Retry-After as RFC 9110 delta-seconds (a positive integer)", async () => {
    const app = makeApp(`hh-delta-${Date.now()}-${Math.random()}`);
    await exhaustQuota(app);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    const retryAfter = res.headers["retry-after"];
    expect(retryAfter).toMatch(/^\d+$/); // integer seconds, no HTTP-date, no decimals
    const seconds = Number(retryAfter);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it("sends RateLimit-Reset as delta-seconds matching Retry-After", async () => {
    const app = makeApp(`hh-reset-${Date.now()}-${Math.random()}`);
    await exhaustQuota(app);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    // draft-6 RateLimit-Reset is delta-seconds, NOT an ISO timestamp. This is
    // the field that used to disagree with the other eight limiters.
    const reset = res.headers["ratelimit-reset"];
    expect(reset).toMatch(/^\d+$/);

    const resetSeconds = Number(reset);
    expect(resetSeconds).toBeGreaterThan(0);
    expect(resetSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);

    // Same instant, same units, so the two must agree (±2s for clock drift
    // across the two setHeader calls).
    expect(Math.abs(resetSeconds - Number(res.headers["retry-after"]))).toBeLessThanOrEqual(2);
  });

  it("keeps the error envelope intact alongside the headers", async () => {
    const app = makeApp(`hh-envelope-${Date.now()}-${Math.random()}`);
    await exhaustQuota(app);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
      },
    });
  });
});

describe("AI limiter 429 headers (Workstream C) - Redis-backed path", () => {
  it("sets the headers from the Redis counter TTL when over quota", async () => {
    // Redis reports the household is already past the cap, with 2h left.
    vi.mocked(redisIncrementWithTtl).mockResolvedValue({
      count: RATE_LIMIT_MAX + 1,
      ttlSeconds: 7200,
    });
    const app = makeApp(`hh-redis-429-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.status).toBe(429);
    expect(res.headers["ratelimit-limit"]).toBe("50");
    expect(res.headers["ratelimit-remaining"]).toBe("0");
    // Retry-After must track the Redis TTL, not the full 24h window.
    const seconds = Number(res.headers["retry-after"]);
    expect(seconds).toBeGreaterThan(7100);
    expect(seconds).toBeLessThanOrEqual(7200);
    expect(res.headers["ratelimit-reset"]).toBeDefined();
  });

  it("sets headers from the Redis counter on the admitted path", async () => {
    vi.mocked(redisIncrementWithTtl).mockResolvedValue({
      count: 10,
      ttlSeconds: 3600,
    });
    const app = makeApp(`hh-redis-ok-${Date.now()}-${Math.random()}`);

    const res = await request(app).post("/api/ai/chat").send({ message: "hi" });

    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("50");
    expect(res.headers["ratelimit-remaining"]).toBe("40");
    expect(res.headers["retry-after"]).toBeUndefined();
  });
});
