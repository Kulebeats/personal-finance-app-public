/**
 * AI Tracking Service - Unit Tests
 *
 * Tests event tracking for Posthog analytics.
 *
 * @module ai/__tests__/ai.tracking.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Import after mocks
import { aiTracking } from '../ai.tracking';
import { logger } from '../../../utils/logger';

describe('AITrackingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('trackQuerySent', () => {
    it('should log query sent event', () => {
      aiTracking.trackQuerySent({
        householdId: 'hh-123',
        userId: 'user-456',
        messageLength: 50,
        hasSessionContext: false
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_query_sent',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            user_id: 'user-456',
            message_length: 50,
            has_session_context: false
          })
        })
      );
    });
  });

  describe('trackQuerySuccess', () => {
    it('should log success event with tool details', () => {
      aiTracking.trackQuerySuccess({
        householdId: 'hh-123',
        userId: 'user-456',
        toolsUsed: ['get_spending_by_category', 'get_budget_status'],
        tokenCount: 250,
        latencyMs: 1500,
        cacheHit: false,
        usedGemini: true
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_query_success',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            tools_used: ['get_spending_by_category', 'get_budget_status'],
            tool_count: 2,
            token_count: 250,
            latency_ms: 1500,
            cache_hit: false,
            used_gemini: true
          })
        })
      );
    });

    it('should track cache hit', () => {
      aiTracking.trackQuerySuccess({
        householdId: 'hh-123',
        userId: 'user-456',
        toolsUsed: ['get_spending_by_category'],
        tokenCount: 100,
        latencyMs: 200,
        cacheHit: true,
        usedGemini: false
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          properties: expect.objectContaining({
            cache_hit: true
          })
        })
      );
    });
  });

  describe('trackQueryFailed', () => {
    it('should log failure event with error details', () => {
      aiTracking.trackQueryFailed({
        householdId: 'hh-123',
        userId: 'user-456',
        errorCode: 'EXTERNAL_API_ERROR',
        errorMessage: 'Gemini API timeout',
        latencyMs: 10000
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_query_failed',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            error_code: 'EXTERNAL_API_ERROR',
            error_message: 'Gemini API timeout',
            latency_ms: 10000
          })
        })
      );
    });
  });

  describe('trackConsentGranted', () => {
    it('should log consent granted event', () => {
      aiTracking.trackConsentGranted({
        householdId: 'hh-123',
        userId: 'user-456',
        consentGiven: true,
        consentVersion: 'v1.0'
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_consent_granted',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            consent_version: 'v1.0'
          })
        })
      );
    });
  });

  describe('trackConsentRevoked', () => {
    it('should log consent revoked event', () => {
      aiTracking.trackConsentRevoked({
        householdId: 'hh-123',
        userId: 'user-456',
        consentGiven: false,
        consentVersion: null
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_consent_revoked',
          properties: expect.objectContaining({
            household_id: 'hh-123'
          })
        })
      );
    });
  });

  describe('trackRateLimitHit', () => {
    it('should log rate limit event', () => {
      aiTracking.trackRateLimitHit({
        householdId: 'hh-123',
        userId: 'user-456',
        remainingQueries: 0,
        resetTime: '2026-01-30T00:00:00Z'
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_rate_limit_hit',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            remaining_queries: 0,
            reset_time: '2026-01-30T00:00:00Z'
          })
        })
      );
    });
  });

  describe('trackCacheHit', () => {
    it('should log cache hit event', () => {
      aiTracking.trackCacheHit({
        householdId: 'hh-123',
        toolName: 'get_spending_by_category',
        queryHash: 'abc123',
        hit: true
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_cache_hit',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            tool_name: 'get_spending_by_category',
            query_hash: 'abc123'
          })
        })
      );
    });
  });

  describe('trackCacheMiss', () => {
    it('should log cache miss event', () => {
      aiTracking.trackCacheMiss({
        householdId: 'hh-123',
        toolName: 'get_budget_status',
        queryHash: 'xyz789',
        hit: false
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_cache_miss',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            tool_name: 'get_budget_status',
            query_hash: 'xyz789'
          })
        })
      );
    });
  });

  describe('trackPromptInjectionBlocked', () => {
    it('should log blocked prompt-injection event', () => {
      aiTracking.trackPromptInjectionBlocked({
        householdId: 'hh-123',
        userId: 'user-456',
        ruleId: 'override_instructions',
        messageLength: 120
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          event: 'ai_prompt_injection_blocked',
          properties: expect.objectContaining({
            household_id: 'hh-123',
            user_id: 'user-456',
            rule_id: 'override_instructions',
            message_length: 120
          })
        })
      );
    });
  });

  describe('Event Properties', () => {
    it('should include timestamp in all events', () => {
      aiTracking.trackQuerySent({
        householdId: 'hh-123',
        userId: 'user-456',
        messageLength: 50,
        hasSessionContext: false
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          properties: expect.objectContaining({
            timestamp: expect.any(String)
          })
        })
      );
    });

    it('should include environment in all events', () => {
      aiTracking.trackQuerySent({
        householdId: 'hh-123',
        userId: 'user-456',
        messageLength: 50,
        hasSessionContext: false
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'AI tracking event',
        expect.objectContaining({
          properties: expect.objectContaining({
            environment: expect.any(String)
          })
        })
      );
    });
  });
});
