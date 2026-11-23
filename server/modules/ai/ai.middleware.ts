/**
 * AI Module Middleware
 *
 * Consent verification per Zambia DPA requirements, and the quota response
 * headers.
 *
 * R17 (17c): the per-household chat quota (50 per rolling 24 hours) is no
 * longer an evictable Redis/in-process counter charged before dispatch. It is
 * the durable Postgres admission ledger (`ai_requests`, see
 * ai.admission.repository.ts), which reserves one unit per LOGICAL request and
 * refunds it at most once when no answer is produced. The route-level
 * The global general API limiter (mounted in server/routes.ts) still throttles raw request volume.
 *
 * @module ai/ai.middleware
 */

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { aiTracking } from './ai.tracking';
import { AI_CONSENT_REQUIRED_MESSAGE, readHouseholdConsent, type HouseholdConsentState } from './ai.consent-policy';
import type { QuotaSnapshot } from './ai.admission.repository';

declare global {
  namespace Express {
    interface Request {
      /** The household's consent standing, published by consentCheckMiddleware. */
      aiConsent?: HouseholdConsentState;
    }
  }
}

/**
 * Attach the standard quota headers to a response, admitted or rejected.
 *
 * DIALECT: the IETF draft-6 `RateLimit-*` names, matching what
 * `express-rate-limit` emits for every other limiter in the app. `Reset` is
 * delta-seconds, matching `Retry-After` (RFC 9110 §10.2.3). Headers set here
 * survive a later throw: the global error middleware only calls
 * `res.status().json()`, which never clears already-set headers.
 */
export function setQuotaHeaders(res: Response, quota: QuotaSnapshot, now: number = Date.now()): number {
  const resetSeconds = Math.max(1, Math.ceil((quota.resetAt.getTime() - now) / 1000));
  res.setHeader('RateLimit-Limit', quota.limit.toString());
  res.setHeader('RateLimit-Remaining', quota.remaining.toString());
  res.setHeader('RateLimit-Reset', resetSeconds.toString());
  return resetSeconds;
}

/** The 429 carries Retry-After alongside the quota trio, and is tracked. */
export function rejectForQuota(req: Request, res: Response, quota: QuotaSnapshot): void {
  const retryAfter = setQuotaHeaders(res, quota);
  res.setHeader('Retry-After', retryAfter.toString());
  const householdId = req.householdContext!.householdId;
  logger.warn('AI chat quota exhausted', { householdId, userId: req.user!.id, used: quota.used, retryAfter });
  aiTracking.trackRateLimitHit({
    householdId,
    userId: req.user!.id,
    remainingQueries: 0,
    resetTime: quota.resetAt.toISOString()
  });
}

// ============================================================================
// CONSENT VERIFICATION MIDDLEWARE
// ============================================================================

/**
 * Consent check middleware for AI features.
 *
 * No consent: 403 before admission. An OUTDATED version (accepted before the
 * disclosure named the current processors) is admitted, but the request stays
 * in the labelled local mode until an owner/admin accepts the current version.
 */
export const consentCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const householdId = req.householdContext!.householdId;
    const consent = await readHouseholdConsent(householdId);

    if (!consent) {
      throw new ForbiddenError('Household not found');
    }

    if (consent.standing === 'none') {
      logger.info('AI query blocked: consent not given', {
        householdId,
        userId: req.user!.id
      });

      throw new ForbiddenError(AI_CONSENT_REQUIRED_MESSAGE);
    }

    req.aiConsent = consent;
    next();
  } catch (error) {
    next(error);
  }
};
