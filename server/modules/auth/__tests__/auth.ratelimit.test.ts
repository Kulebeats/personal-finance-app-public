/**
 * Auth Rate Limit Tests
 *
 * Verifies that the authLimiter correctly blocks excessive requests based on IP.
 *
 * @module modules/auth/__tests__/auth.ratelimit.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { authLimiter } from "../../../middleware/rateLimit";

describe("Auth Rate Limiting", () => {
  let app: express.Express;
  const originalEnv = process.env.NODE_ENV;
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    // Force enable rate limiter for these tests by tricking it into thinking we are NOT in test env
    // Also use "production" and numeric TRUST_PROXY to mirror Render.
    process.env.NODE_ENV = "production";
    process.env.TRUST_PROXY = "1";

    app = express();
    app.use(express.json());
    app.set("trust proxy", 1);

    app.post("/test/login", authLimiter, (req, res) => {
      res.json({ success: true });
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  it("should enforce 10 requests per minute limit per IP", async () => {
    const ip = "192.168.1.100";

    // 1. Make 10 allowed requests
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/test/login")
        .set("X-Forwarded-For", ip);

      expect(res.status).toBe(200);
      // Check standard header (RateLimit-Remaining -> ratelimit-remaining)
      expect(res.header["ratelimit-remaining"]).toBeDefined();
    }

    // 2. Make 11th request (Blocked)
    const blockedRes = await request(app)
      .post("/test/login")
      .set("X-Forwarded-For", ip);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error.code).toBe("RATE_LIMITED");
  });

  it("should allow requests from a different IP", async () => {
    const ip = "192.168.1.101";

    const res = await request(app)
      .post("/test/login")
      .set("X-Forwarded-For", ip);

    expect(res.status).toBe(200);
  });
});
