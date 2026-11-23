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

import { PostHog } from 'posthog-node';
import { logger } from '../../utils/logger';
import { posthogAnalyticsFetch } from './ai.tracking-transport';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Configuration is optional; the declared ESM dependency is always resolvable.
let posthogClient: Pick<PostHog, 'capture' | 'shutdown'> | null = null;
const externalEventNames = new Set([
  'ai_query_sent', 'ai_query_success', 'ai_query_failed', 'ai_consent_granted',
  'ai_consent_revoked', 'ai_rate_limit_hit', 'ai_cache_hit', 'ai_cache_miss',
  'ai_prompt_injection_blocked',
]);

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
    if (this.enabled) this.initializePosthog();
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

    // SDK v1 consumes response JSON; this capture-only adapter supports v0.
    if (process.env.POSTHOG_CAPTURE_MODE === 'v1') {
      logger.warn('Posthog capture mode v1 is unsupported - AI tracking will use logger only');
      return;
    }

    try {
      posthogClient = new PostHog(apiKey, { host, fetch: posthogAnalyticsFetch });
      logger.info('Posthog initialized for AI tracking');
    } catch {
      logger.warn('Posthog initialization failed - AI tracking will use logger only');
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
    if (!externalEventNames.has(eventName)) return;
    // Add common properties
    const enrichedProperties = {
      ...properties,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };

    // Send to Posthog if available
    if (posthogClient) {
      try {
        // External analytics is aggregate-only. Never spread raw event context:
        // identifiers, error text, query hashes and tool names remain local.
        const externalProperties: Record<string, unknown> = {
          timestamp: enrichedProperties.timestamp,
          environment: ['development', 'test', 'production'].includes(enrichedProperties.environment)
            ? enrichedProperties.environment : 'unknown',
          $process_person_profile: false,
        };
        for (const key of ['message_length', 'tool_count', 'token_count', 'remaining_queries']) {
          const value = properties[key];
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) externalProperties[key] = value;
        }
        const latency = properties.latency_ms;
        if (typeof latency === 'number' && Number.isFinite(latency) && latency >= 0 && latency <= Number.MAX_SAFE_INTEGER) {
          externalProperties.latency_ms = latency;
        }
        for (const key of ['has_session_context', 'cache_hit', 'used_gemini']) {
          if (typeof properties[key] === 'boolean') externalProperties[key] = properties[key];
        }
        posthogClient.capture({ distinctId: 'capital-ai-tracking', event: eventName, properties: externalProperties });
      } catch {
        logger.error('Failed to send event to Posthog', { action: eventName });
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
      } catch {
        logger.error('Error shutting down Posthog client');
      }
    }
  }
}

// Export singleton instance
export const aiTracking = new AITrackingService();
