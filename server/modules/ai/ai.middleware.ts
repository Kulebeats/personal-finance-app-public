/**
 * AI Module Middleware
 *
 * FIX AI-RATE-001: Rate limiting for AI endpoints (50 queries/household/day)
 * Also implements consent verification per Zambia DPA requirements.
 *
 * @module ai/ai.middleware
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimitError, ForbiddenError } from '../../core/errors';
import { db } from '../../db';
import { households } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger';
import { aiTracking } from './ai.tracking';
import { redisIncrementWithTtl, redisReadCounter } from '../../config/redis';

// ============================================================================
// PER-HOUSEHOLD RATE LIMITER (AI-RATE-001 / SCP-328)
// ============================================================================
//
// Backed by the shared Redis client (server/config/redis.ts) so the
// 50-queries-per-household-per-day cap is enforced cluster-wide. When Redis is
// not configured (local dev/test, single instance) it falls back to the
// in-process Map below — correct for one instance, just not multi-instance.

interface RateLimitEntry {
  count: number;
  resetTime: number; // Timestamp in ms
}

/**
 * Quota state the limiter publishes for downstream handlers.
 *
 * The controller needs the household's remaining quota to build
 * `remainingQueries`. It used to recover that by reading back the response
 * header the limiter had just set, which made an OUTBOUND header name
 * load-bearing for an INTERNAL value — renaming the header degraded the field
 * to 0 silently. Passing it on the request keeps the two concerns separate.
 */
export interface AiRateLimitContext {
  limit: number;
  remaining: number;
  resetTime: number; // Timestamp in ms
}

declare global {
  namespace Express {
    interface Request {
      aiRateLimit?: AiRateLimitContext;
    }
  }
}

// In-memory fallback used only when Redis is unavailable.
// Key: householdId, Value: { count, resetTime }
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = 50; // queries per household
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in ms
const RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours in seconds

/** Redis key for a household's AI query counter. */
const rateLimitKey = (householdId: string): string =>
  `ai:ratelimit:${householdId}`;

interface RateLimitResult {
  count: number;
  resetTime: number; // Timestamp in ms
  limited: boolean;
}

/**
 * Consume one AI query from the household's quota.
 * Uses Redis when available, otherwise the in-process Map.
 */
async function consumeRateLimit(
  householdId: string,
): Promise<RateLimitResult> {
  const now = Date.now();

  // Try Redis-backed counter first (cluster-wide enforcement).
  const redisResult = await redisIncrementWithTtl(
    rateLimitKey(householdId),
    RATE_LIMIT_WINDOW_SECONDS,
  );

  if (redisResult) {
    const resetTime = now + redisResult.ttlSeconds * 1000;
    // If this increment pushed us over, treat as limited (don't refund -
    // the cap is best-effort and a single extra increment is harmless).
    return {
      count: redisResult.count,
      resetTime,
      limited: redisResult.count > RATE_LIMIT_MAX,
    };
  }

  // Fallback: in-process Map.
  let entry = rateLimitStore.get(householdId);
  if (!entry || now >= entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimitStore.set(householdId, entry);
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { count: entry.count, resetTime: entry.resetTime, limited: true };
  }

  entry.count++;
  rateLimitStore.set(householdId, entry);
  return { count: entry.count, resetTime: entry.resetTime, limited: false };
}

/**
 * Attach the standard quota headers to a response.
 *
 * Called on BOTH the admitted and the rejected path so a 429 is
 * self-describing (v1.1 Workstream C). Headers set here survive the throw:
 * the global error middleware (`apiErrorMiddleware`, server/app.ts) only calls
 * `res.status().json()`, which never clears already-set headers.
 *
 * DIALECT: the IETF draft-6 `RateLimit-*` names, which is what
 * `express-rate-limit` already emits for every other limiter in the app
 * (server/middleware/rateLimit.ts sets `standardHeaders: true`). This module
 * used to hand-roll `X-RateLimit-*` with `Reset` as an ISO timestamp, so the
 * same conceptual field carried two incompatible types depending on the route
 * — `Number()` on the ISO form is NaN, and `new Date()` on the delta form is
 * 1970. `Reset` is delta-seconds everywhere now, matching `Retry-After`.
 */
function setRateLimitHeaders(
  res: Response,
  count: number,
  resetTime: number,
  now: number,
): void {
  const remaining = Math.max(0, RATE_LIMIT_MAX - count);
  const resetSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));
  res.setHeader('RateLimit-Limit', RATE_LIMIT_MAX.toString());
  res.setHeader('RateLimit-Remaining', remaining.toString());
  res.setHeader('RateLimit-Reset', resetSeconds.toString());
}

/**
 * Rate limiting middleware for AI endpoints.
 * Limits: 50 queries per household per 24 hours.
 *
 * This fixes AI-RATE-001 by preventing abuse of expensive AI API calls,
 * and SCP-328 by enforcing the cap cluster-wide via Redis.
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const householdId = req.householdContext!.householdId;
    const now = Date.now();

    const result = await consumeRateLimit(householdId);

    // Quota headers go on EVERY response, admitted or rejected, so a 429 tells
    // the client when the quota resets without a follow-up GET /api/ai/status.
    setRateLimitHeaders(res, result.count, result.resetTime, now);

    // Publish the same state on the request so handlers read it from here
    // rather than parsing it back out of an outbound header.
    req.aiRateLimit = {
      limit: RATE_LIMIT_MAX,
      remaining: Math.max(0, RATE_LIMIT_MAX - result.count),
      resetTime: result.resetTime,
    };

    // Check if limit exceeded
    if (result.limited) {
      const retryAfter = Math.max(1, Math.ceil((result.resetTime - now) / 1000));

      // RFC 9110 §10.2.3: Retry-After is delta-seconds or an HTTP-date. Use
      // delta-seconds, matching the existing 429 path in
      // server/middleware/rateLimit.ts (no clock-skew ambiguity for clients).
      res.setHeader('Retry-After', retryAfter.toString());

      // Log rate limit hit for monitoring
      logger.warn('AI rate limit exceeded', {
        householdId,
        userId: req.user!.id,
        count: result.count,
        retryAfter
      });

      // Track rate limit event
      aiTracking.trackRateLimitHit({
        householdId,
        userId: req.user!.id,
        remainingQueries: 0,
        resetTime: new Date(result.resetTime).toISOString()
      });

      throw new RateLimitError(retryAfter);
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Cleanup old rate limit entries (run periodically).
 * Only relevant for the in-memory fallback; Redis keys expire on their own TTL.
 */
export const cleanupRateLimitStore = (): void => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now >= entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupRateLimitStore, 60 * 60 * 1000).unref();

// ============================================================================
// CONSENT VERIFICATION MIDDLEWARE
// ============================================================================

/**
 * Consent check middleware for AI features.
 * Verifies household has granted consent for AI processing per Zambia DPA.
 */
export const consentCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const householdId = req.householdContext!.householdId;

    // Query household to check AI consent
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
      columns: {
        aiConsentGiven: true
      }
    });

    if (!household) {
      throw new ForbiddenError('Household not found');
    }

    // Check if consent given
    if (!household.aiConsentGiven) {
      logger.info('AI query blocked: consent not given', {
        householdId,
        userId: req.user!.id
      });

      throw new ForbiddenError(
        'AI features require consent. Please enable AI assistant in Settings.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to get current rate limit status for a household without consuming
 * quota. Reads from the shared Redis counter when available, otherwise the
 * in-process Map (SCP-328).
 */
export const getRateLimitStatus = async (
  householdId: string,
): Promise<{
  remaining: number;
  resetTime: Date;
  isLimited: boolean;
}> => {
  const now = Date.now();

  // Redis-backed status (read-only; does not increment).
  const redisCounter = await redisReadCounter(rateLimitKey(householdId));
  if (redisCounter) {
    const remaining = Math.max(0, RATE_LIMIT_MAX - redisCounter.count);
    return {
      remaining,
      resetTime: new Date(now + redisCounter.ttlSeconds * 1000),
      isLimited: remaining === 0,
    };
  }

  // Fallback: in-process Map.
  const entry = rateLimitStore.get(householdId);
  if (!entry || now >= entry.resetTime) {
    return {
      remaining: RATE_LIMIT_MAX,
      resetTime: new Date(now + RATE_LIMIT_WINDOW),
      isLimited: false,
    };
  }

  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  return {
    remaining,
    resetTime: new Date(entry.resetTime),
    isLimited: remaining === 0,
  };
};
