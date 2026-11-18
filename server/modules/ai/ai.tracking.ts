/**
 * AI Event Tracking Service
 *
 * Tracks AI assistant events for analytics and monitoring.
 * Supports Posthog when configured, falls back to logger.
 *
 * Events tracked:
 * - Query lifecycle (sent, success, failed)
 * - Consent changes (granted, revoked)
 * - Rate limit hits
 * - Cache performance (hit, miss)
 *
 * @module ai/ai.tracking
 */

import { logger } from '../../utils/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Posthog client (lazy loaded when configured)
let posthogClient: PostHogClient | null = null;

interface PostHogClient {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  shutdown: () => Promise<void>;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface AIQuerySentEvent {
  householdId: string;
  userId: string;
  messageLength: number;
  hasSessionContext: boolean;
}

export interface AIQuerySuccessEvent {
  householdId: string;
  userId: string;
  toolsUsed: string[];
  tokenCount: number;
  latencyMs: number;
  cacheHit: boolean;
  usedGemini: boolean;
}

export interface AIQueryFailedEvent {
  householdId: string;
  userId: string;
  errorCode: string;
  errorMessage: string;
  latencyMs: number;
}

export interface AIConsentEvent {
  householdId: string;
  userId: string;
  consentGiven: boolean;
  consentVersion: string | null;
}

export interface AIRateLimitEvent {
  householdId: string;
  userId: string;
  remainingQueries: number;
  resetTime: string;
}

export interface AICacheEvent {
  householdId: string;
  toolName: string;
  queryHash: string;
  hit: boolean;
}

export interface AIPromptInjectionBlockedEvent {
  householdId: string;
  userId: string;
  ruleId: string;
  messageLength: number;
}

// ============================================================================
// AI TRACKING SERVICE
// ============================================================================

class AITrackingService {
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.AI_TRACKING_ENABLED !== 'false';
    this.initializePosthog();
  }

  /**
   * Initialize Posthog client if configured.
   */
  private initializePosthog(): void {
    const apiKey = process.env.POSTHOG_API_KEY;
    const host = process.env.POSTHOG_HOST || 'https://app.posthog.com';

    if (!apiKey) {
      logger.info('Posthog not configured - AI tracking will use logger only');
      return;
    }

    try {
      // Dynamic import to avoid requiring posthog if not used
      // In production, install: npm install posthog-node
      const PostHog = require('posthog-node').PostHog;
      posthogClient = new PostHog(apiKey, { host });
      logger.info('Posthog initialized for AI tracking');
    } catch (error) {
      logger.warn('Posthog package not installed - AI tracking will use logger only');
    }
  }

  /**
   * Track AI query sent event.
   */
  trackQuerySent(event: AIQuerySentEvent): void {
    if (!this.enabled) return;

    this.track('ai_query_sent', {
      household_id: event.householdId,
      user_id: event.userId,
      message_length: event.messageLength,
      has_session_context: event.hasSessionContext,
    });
  }

  /**
   * Track AI query success event.
   */
  trackQuerySuccess(event: AIQuerySuccessEvent): void {
    if (!this.enabled) return;

    this.track('ai_query_success', {
      household_id: event.householdId,
      user_id: event.userId,
      tools_used: event.toolsUsed,
      tool_count: event.toolsUsed.length,
      token_count: event.tokenCount,
      latency_ms: event.latencyMs,
      cache_hit: event.cacheHit,
      used_gemini: event.usedGemini,
    });
  }

  /**
   * Track AI query failed event.
   */
  trackQueryFailed(event: AIQueryFailedEvent): void {
    if (!this.enabled) return;

    this.track('ai_query_failed', {
      household_id: event.householdId,
      user_id: event.userId,
      error_code: event.errorCode,
      error_message: event.errorMessage,
      latency_ms: event.latencyMs,
    });
  }

  /**
   * Track AI consent granted event.
   */
  trackConsentGranted(event: AIConsentEvent): void {
    if (!this.enabled) return;

    this.track('ai_consent_granted', {
      household_id: event.householdId,
      user_id: event.userId,
      consent_version: event.consentVersion,
    });
  }

  /**
   * Track AI consent revoked event.
   */
  trackConsentRevoked(event: AIConsentEvent): void {
    if (!this.enabled) return;

    this.track('ai_consent_revoked', {
      household_id: event.householdId,
      user_id: event.userId,
    });
  }

  /**
   * Track rate limit hit event.
   */
  trackRateLimitHit(event: AIRateLimitEvent): void {
    if (!this.enabled) return;

    this.track('ai_rate_limit_hit', {
      household_id: event.householdId,
      user_id: event.userId,
      remaining_queries: event.remainingQueries,
      reset_time: event.resetTime,
    });
  }

  /**
   * Track cache hit event.
   */
  trackCacheHit(event: AICacheEvent): void {
    if (!this.enabled) return;

    this.track('ai_cache_hit', {
      household_id: event.householdId,
      tool_name: event.toolName,
      query_hash: event.queryHash,
    });
  }

  /**
   * Track cache miss event.
   */
  trackCacheMiss(event: AICacheEvent): void {
    if (!this.enabled) return;

    this.track('ai_cache_miss', {
      household_id: event.householdId,
      tool_name: event.toolName,
      query_hash: event.queryHash,
    });
  }

  /**
   * Track blocked prompt-injection attempts.
   */
  trackPromptInjectionBlocked(event: AIPromptInjectionBlockedEvent): void {
    if (!this.enabled) return;

    this.track('ai_prompt_injection_blocked', {
      household_id: event.householdId,
      user_id: event.userId,
      rule_id: event.ruleId,
      message_length: event.messageLength,
    });
  }

  /**
   * Core tracking method - sends to Posthog or logs.
   */
  private track(eventName: string, properties: Record<string, unknown>): void {
    // Add common properties
    const enrichedProperties = {
      ...properties,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };

    // Send to Posthog if available
    if (posthogClient) {
      try {
        posthogClient.capture(eventName, enrichedProperties);
      } catch (error) {
        logger.error('Failed to send event to Posthog', { eventName, error });
      }
    }

    // Always log for debugging and audit trail
    logger.debug('AI tracking event', {
      event: eventName,
      properties: enrichedProperties,
    });
  }

  /**
   * Flush pending events and shutdown.
   */
  async shutdown(): Promise<void> {
    if (posthogClient) {
      try {
        await posthogClient.shutdown();
        logger.info('Posthog client shutdown complete');
      } catch (error) {
        logger.error('Error shutting down Posthog client', { error });
      }
    }
  }
}

// Export singleton instance
export const aiTracking = new AITrackingService();
