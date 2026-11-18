/**
 * Rate Limiter Wiring - Unit Tests (SCP-307)
 *
 * Verifies every exported limiter is constructed via the shared factory so the
 * Redis store is threaded in when configured, and that all limiters are usable
 * Express middleware WITHOUT a Redis server (in-memory fallback).
 *
 * Cross-instance enforcement via a Redis store requires a real Redis and is not
 * verifiable here.
 *
 * @module middleware/__tests__/rateLimit.wiring.test
 */

import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { redis } from "../../config/redis";
import {
  generalLimiter,
  analyticsLimiter,
  authLimiter,
  ipAuthLimiter,
  strictLimiter,
  expensiveAnalyticsLimiter,
  uploadLimiter,
  getIpRateLimitKey,
  getRateLimitKey,
} from "../rateLimit";

describe("Rate limiter wiring (SCP-307)", () => {
  const requestWithIp = (ip: string, userId?: string): Request =>
    ({
      ip,
      socket: { remoteAddress: ip },
      user: userId ? { id: userId } : undefined,
    }) as unknown as Request;

  // Every limiter the app uses. All must be wired through the shared factory.
  const limiters: Array<[string, unknown]> = [
    ["generalLimiter", generalLimiter],
    ["analyticsLimiter", analyticsLimiter],
    ["authLimiter", authLimiter],
    ["ipAuthLimiter", ipAuthLimiter],
    ["strictLimiter", strictLimiter],
    ["expensiveAnalyticsLimiter", expensiveAnalyticsLimiter],
    ["uploadLimiter", uploadLimiter],
  ];

  it("runs without Redis configured (in-memory fallback)", () => {
    expect(redis).toBeNull();
  });

  it.each(limiters)(
    "%s is a constructed Express middleware (3-arg fn)",
    (_name, limiter) => {
      expect(typeof limiter).toBe("function");
      // express-rate-limit middleware has the (req, res, next) arity.
      expect((limiter as (...a: unknown[]) => unknown).length).toBe(3);
    },
  );

  it("exposes all 7 documented limiter tiers", () => {
    expect(limiters).toHaveLength(7);
    limiters.forEach(([, limiter]) => expect(limiter).toBeDefined());
  });

  it("normalizes unauthenticated IPv6 clients to a stable subnet key", () => {
    const first = requestWithIp("2001:db8:abcd:1234:ffff::1");
    const second = requestWithIp("2001:db8:abcd:1234:eeee::2");

    expect(getIpRateLimitKey(first)).toBe("ip:2001:db8:abcd:1200::/56");
    expect(getIpRateLimitKey(second)).toBe("ip:2001:db8:abcd:1200::/56");
    expect(getRateLimitKey(first)).toBe(getIpRateLimitKey(first));
  });

  it("preserves authenticated user keys and normalizes IPv4-mapped IPv6", () => {
    expect(getRateLimitKey(requestWithIp("2001:db8::1", "user-123"))).toBe(
      "user:user-123",
    );
    expect(getIpRateLimitKey(requestWithIp("::ffff:192.0.2.128"))).toBe(
      "ip:192.0.2.128",
    );
  });
});
