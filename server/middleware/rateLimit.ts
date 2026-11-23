import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { productionRedis, redis } from "../config/redis";
import { createProductionRateLimiter, type RateLimitPrefix } from "../config/redis/production-rate-limit.mjs";

/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting for API endpoints.
 *
 * PRODUCTION SETUP:
 * - Uses Redis store when REDIS_URL is configured
 * - Production refuses to boot without REDIS_URL (see validateEnv.ts)
 * - Falls back to in-memory store for development/test only
 *
 * Tier sizes: general and shared-IP credential limits follow spec R00.3. Those
 * two numbers are D22 proposals (policy, not arithmetic) until the owner
 * ratifies them; the spec gives no number for the other tiers, so they keep
 * their earlier values.
 */

/** R00.3 proposal (D22): 600 requests per authenticated user per 60 s window. */
const GENERAL_LIMIT_PER_MINUTE = 600;
/** R00.3 proposal (D22): credential POSTs, 10 per minute per IP. */
const IP_AUTH_LIMIT_PER_MINUTE = 10;

// ============================================================================
// REDIS STORE CONFIGURATION (SCP-307)
// ============================================================================

/**
 * Builds a per-limiter Redis store backed by the shared ioredis client
 * (`server/config/redis.ts`), or `undefined` to use the default in-memory
 * store when no Redis is configured.
 *
 * IMPORTANT: For multi-server deployments, the Redis store is REQUIRED so
 * rate limits are enforced across all instances. Without it, each instance
 * keeps its own counter and an attacker can multiply the limit by hitting
 * different instances. Every limiter below threads this store in via the
 * `createLimiter` factory so none are accidentally left per-process.
 *
 * Each limiter gets its own RedisStore instance with a distinct key prefix
 * (required by rate-limit-redis) but they all share one Redis connection.
 *
 * @param prefix Distinct key namespace for this limiter (e.g. "rl:general:").
 */
function buildStore(prefix: RateLimitPrefix): Options["store"] | undefined {
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "Rate limiting using in-memory store. Production should fail startup " +
          "without REDIS_URL; set REDIS_URL to enable distributed rate limiting.",
      );
    }
    return undefined; // Use default in-memory store (single-instance fallback)
  }

  // rate-limit-redis works with any client exposing sendCommand. ioredis's
  // `call` takes the command name + args and returns the raw reply, which is
  // exactly the shape RedisStore expects.
  return new RedisStore({
    prefix,
    // ioredis `call(command, ...args)` returns the raw reply. rate-limit-redis
    // types sendCommand as returning RedisReply; ioredis types it as unknown,
    // so narrow it through a typed wrapper.
    sendCommand: (...args: string[]): Promise<string | number | (string | number)[]> =>
      redis!.call(args[0], ...args.slice(1)) as Promise<
        string | number | (string | number)[]
      >,
  }) as Options["store"];
}

/**
 * Creates a rate limiter with the shared Redis store wired in (SCP-307).
 *
 * Centralizing construction here guarantees every limiter is distributed when
 * Redis is configured and degrades to in-memory otherwise — no limiter can be
 * accidentally left without a `store`.
 */
function createLimiter(
  prefix: RateLimitPrefix,
  options: Partial<Options>,
): ReturnType<typeof rateLimit> {
  if (productionRedis) {
    return createProductionRateLimiter(productionRedis, prefix, options);
  }
  return rateLimit({
    ...options,
    store: buildStore(prefix),
  });
}

// ============================================================================
// RATE LIMITING HELPERS
// ============================================================================

/**
 * Gets the client IP address from Express. Express already applies the app's
 * configured `trust proxy` policy, so this works for boolean, numeric hop count,
 * and proxy-list TRUST_PROXY values without manually trusting spoofable headers.
 *
 * @param req - Express request object
 * @returns Client IP address or "unknown" if not determinable
 */
const getClientIp = (req: Request): string => {
  return req.ip || req.socket.remoteAddress || "unknown";
};

const RATE_LIMIT_IPV6_SUBNET = 56;

export const getIpRateLimitKey = (req: Request): string => {
  return `ip:${ipKeyGenerator(getClientIp(req), RATE_LIMIT_IPV6_SUBNET)}`;
};

export const getRateLimitKey = (req: Request): string => {
  const user = (req as Request & { user?: { id?: string } }).user;
  if (user?.id) {
    return `user:${user.id}`;
  }
  return getIpRateLimitKey(req);
};

/**
 * Creates a rate limit handler with logging and Retry-After header.
 * Complies with RFC 6585 (429 status) and NIST SP 800-92 (security logging).
 */
const createRateLimitHandler = (windowMs: number) => {
  const retryAfterSeconds = Math.ceil(windowMs / 1000);

  return (req: Request, res: Response) => {
    // Log rate limit events for security monitoring (NIST SP 800-92)
    const user = (req as Request & { user?: { id?: string } }).user;
    logger.warn("Rate limit exceeded", {
      ip: getClientIp(req),
      path: req.path,
      method: req.method,
      userId: user?.id?.substring(0, 8) + "..." || undefined,
    });

    // RFC 6585 recommends Retry-After header for 429 responses
    res.setHeader("Retry-After", retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
        retryAfter: retryAfterSeconds,
      },
    });
  };
};

/**
 * General API rate limiter, mounted once on /api in routes.ts. Keyed per user,
 * with the client IP as the anonymous fallback.
 */
export const generalLimiter = createLimiter("rl:general:", {
  windowMs: 60 * 1000, // 1 minute
  max: GENERAL_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test", // Skip in tests
});

/**
 * Analytics rate limiter: 30 requests per minute
 * Used for heavy computation endpoints like reports
 */
export const analyticsLimiter = createLimiter("rl:analytics:", {
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * Auth rate limiter: 10 requests per minute
 * Stricter limit for login/register to prevent brute force.
 * Uses both IP and UserID (if available).
 */
export const authLimiter = createLimiter("rl:auth:", {
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey, // Uses userId if available, falls back to IP
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * IP-based credential limiter on the credential POSTs only (never /me or
 * /logout). Purely IP-based to prevent brute force when userId isn't known yet.
 */
export const ipAuthLimiter = createLimiter("rl:ipauth:", {
  windowMs: 60 * 1000, // 1 minute
  max: IP_AUTH_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getIpRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * Strict limiter: 5 requests per minute
 * For sensitive operations like password reset
 */
export const strictLimiter = createLimiter("rl:strict:", {
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getIpRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * Expensive Analytics limiter: 10 requests per minute
 * For resource-intensive reports like Sankey diagrams
 */
export const expensiveAnalyticsLimiter = createLimiter("rl:expensive:", {
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * Upload limiter: 20 requests per hour
 * Prevents abuse of file upload endpoints (CSV imports, receipts, etc.)
 */
export const uploadLimiter = createLimiter("rl:upload:", {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});
