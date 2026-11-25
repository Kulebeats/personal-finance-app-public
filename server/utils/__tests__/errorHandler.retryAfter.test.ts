/**
 * Central `Retry-After` emission for every RateLimitError thrower.
 *
 * `RateLimitError` has always carried a `retryAfter` value, but neither error
 * handler emitted it as a header. PR #124 fixed this for the AI limiter only,
 * by calling `res.setHeader` in `ai.middleware.ts` before throwing — leaving
 * every OTHER thrower returning a 429 with no `Retry-After`, so clients have
 * nothing to back off on.
 *
 * These tests drive a REAL Express app through supertest so they prove the
 * header lands on the actual HTTP response, not merely that `res.setHeader`
 * was called. The app mounts `apiErrorMiddleware` (server/utils/errorHandler),
 * which is what `server/app.ts:265` actually mounts — NOT the `errorHandler`
 * exported from server/core/errors, which is dead code no app mounts.
 *
 * Format is RFC 9110 §10.2.3 delta-seconds, matching the two paths that
 * already emit it (server/middleware/rateLimit.ts:133 and the AI limiter), so
 * the API speaks one format throughout.
 *
 * @module utils/__tests__/errorHandler.retryAfter.test
 */

import { describe, it, expect } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { apiErrorMiddleware } from "../errorHandler";
import { RateLimitError, NotFoundError } from "../../core/errors";

/**
 * Minimal app whose single route throws `err`, with the real error middleware
 * mounted behind it. Mirrors how a router-level throw reaches the handler in
 * production.
 */
function makeApp(err: Error) {
  const app = express();
  app.get("/boom", (_req: Request, _res: Response, next: NextFunction) => {
    next(err);
  });
  app.use(apiErrorMiddleware);
  return app;
}

it("returns a generic 400 when PostgreSQL rejects the input syntax", async () => {
  const cause = Object.assign(new Error("synthetic internal SQL detail"), { code: "22P02" });
  const res = await request(makeApp(new Error("synthetic query wrapper", { cause }))).get("/boom");
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "Invalid input" },
  });
  expect(res.text).not.toContain("synthetic");
});

describe("apiErrorMiddleware — central Retry-After on RateLimitError", () => {
  it("emits Retry-After from the error's retryAfter for a non-AI thrower", async () => {
    const res = await request(makeApp(new RateLimitError(42))).get("/boom");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("42");
  });

  it("emits the 60s default when the thrower passes no retryAfter", async () => {
    const res = await request(makeApp(new RateLimitError())).get("/boom");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
  });

  it("sends Retry-After as RFC 9110 delta-seconds, not an HTTP-date", async () => {
    const res = await request(makeApp(new RateLimitError(7200))).get("/boom");

    // Integer seconds only: no decimals, no "Wed, 21 Oct 2015 07:28:00 GMT".
    expect(res.headers["retry-after"]).toMatch(/^\d+$/);
    expect(Number(res.headers["retry-after"])).toBe(7200);
  });

  it("keeps emitting RATE_LIMIT_EXCEEDED, the documented client-facing code", async () => {
    // docs/ai-integration/specifications/ai-assistant-api-spec.md §3.4 documents
    // RATE_LIMIT_EXCEEDED and clients branch on it. Adding the header must not
    // flip the code to the dead branch's RATE_LIMITED.
    const res = await request(makeApp(new RateLimitError(30))).get("/boom");

    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
      },
    });
  });

  it("does not put Retry-After on a non-rate-limit HttpError", async () => {
    const res = await request(makeApp(new NotFoundError("Budget not found"))).get(
      "/boom",
    );

    expect(res.status).toBe(404);
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("makes the error's retryAfter authoritative over a pre-set header", async () => {
    // A thrower may set the header itself before throwing (the AI limiter does,
    // per PR #124). The error carries the same value it computed, so the error
    // is the single source of truth — a divergent pre-set header is stale and
    // must not survive. Emitting exactly one value keeps the header and the
    // error object from ever disagreeing.
    const app = express();
    app.get("/boom", (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Retry-After", "1");
      next(new RateLimitError(99));
    });
    app.use(apiErrorMiddleware);

    const res = await request(app).get("/boom");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("99");
  });
});
