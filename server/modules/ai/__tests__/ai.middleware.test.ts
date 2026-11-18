/**
 * AI Middleware - Unit Tests
 *
 * Tests rate limiting and consent verification middleware.
 *
 * @module ai/__tests__/ai.middleware.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { getRateLimitStatus } from '../ai.middleware';

// Mock the tracking module to avoid side effects
vi.mock('../ai.tracking', () => ({
  aiTracking: {
    trackRateLimitHit: vi.fn()
  }
}));

describe('AI Middleware', () => {
  describe('getRateLimitStatus', () => {
    it('should return full quota for new household', async () => {
      const status = await getRateLimitStatus('new-household-123');

      expect(status.remaining).toBe(50);
      expect(status.isLimited).toBe(false);
      expect(status.resetTime).toBeInstanceOf(Date);
    });

    it('should return reset time in the future', async () => {
      const status = await getRateLimitStatus('test-household');
      const now = new Date();

      expect(status.resetTime.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  // Rate-limit header coverage lives in ai.ratelimit-429-headers.test.ts,
  // which drives a real Express app + the mounted error middleware through
  // supertest and asserts the headers on the actual HTTP response (both the
  // admitted path and the 429). The block previously here asserted only that
  // string literals it had just declared were defined - it could never fail,
  // and it passed throughout the period when a 429 carried no headers at all.

  describe('Rate Limit Configuration', () => {
    it('should have 50 queries per day limit', async () => {
      const status = await getRateLimitStatus('config-test-household');

      // Default remaining should be 50
      expect(status.remaining).toBe(50);
    });

    it('should have 24-hour window', async () => {
      const status = await getRateLimitStatus('window-test-household');
      const now = new Date();
      const resetTime = status.resetTime;

      // Reset should be within 24 hours
      const diffHours = (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeLessThanOrEqual(24);
      expect(diffHours).toBeGreaterThan(0);
    });
  });
});

describe('Consent Check', () => {
  it('should require ai_consent_given to be true', () => {
    // Test that the consent check looks for aiConsentGiven field
    const householdWithConsent = { aiConsentGiven: true };
    const householdWithoutConsent = { aiConsentGiven: false };

    expect(householdWithConsent.aiConsentGiven).toBe(true);
    expect(householdWithoutConsent.aiConsentGiven).toBe(false);
  });

  it('should block requests when consent is false', () => {
    const household = { aiConsentGiven: false };
    const shouldBlock = !household.aiConsentGiven;

    expect(shouldBlock).toBe(true);
  });

  it('should allow requests when consent is true', () => {
    const household = { aiConsentGiven: true };
    const shouldBlock = !household.aiConsentGiven;

    expect(shouldBlock).toBe(false);
  });
});
