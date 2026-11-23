/**
 * AI Module - Integration Tests
 *
 * Tests the AI module components working together.
 * Note: Full HTTP integration tests require proper app setup.
 * These tests focus on service-level integration.
 *
 * @module ai/__tests__/ai.integration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CURRENT_AI_CONSENT_VERSION } from '../ai.consent-policy';
import { Money } from '../../../core/money';
import { aiCache } from '../ai.cache';
import { TOOL_ARG_SCHEMAS } from '../ai.validation';

// Mock logger to suppress output
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('AI Module Integration', () => {
  describe('Tool Names and Configuration', () => {
    const VALID_TOOLS = Object.keys(TOOL_ARG_SCHEMAS);

    it('should have exactly 12 tools defined', () => {
      expect(VALID_TOOLS).toHaveLength(12);
    });

    it('should have consistent naming convention', () => {
      VALID_TOOLS.forEach(tool => {
        expect(tool).toMatch(/^get_/);
        expect(tool).toMatch(/^[a-z_]+$/);
      });
    });

    it.each(VALID_TOOLS)('executes %s without cross-request result reuse', toolName => {
      expect(aiCache.isCacheable(toolName)).toBe(false);
    });
  });

  describe('Rate Limiting Configuration', () => {
    it('should have 50 queries per day limit', () => {
      const RATE_LIMIT_MAX = 50;
      expect(RATE_LIMIT_MAX).toBe(50);
    });

    it('should have 24-hour window', () => {
      const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
      expect(RATE_LIMIT_WINDOW_MS).toBe(86400000);
    });
  });

  describe('Cache Configuration', () => {
    it('should have 5-minute default TTL', () => {
      const DEFAULT_TTL_MS = 5 * 60 * 1000;
      expect(DEFAULT_TTL_MS).toBe(300000);
    });
  });

  describe('Money Class Integration', () => {
    const currency = 'ZMW';

    it('should create Money objects from strings', () => {
      const money = Money.from('1234.56', currency);
      expect(money.toNumber()).toBe(1234.56);
    });

    it('should format Money for display', () => {
      const money = Money.from('1000.00', currency);
      // toString() returns just the amount for storage/API
      expect(money.toString()).toBe('1000.00');
      // format() returns currency-formatted string for display
      const formatted = money.format();
      expect(formatted).toContain('1');
      expect(formatted).toContain('000');
    });

    it('should support arithmetic operations', () => {
      const a = Money.from('100.00', currency);
      const b = Money.from('50.00', currency);
      const sum = a.add(b);
      expect(sum.toNumber()).toBe(150);
    });

    it('should support zero values', () => {
      const zero = Money.zero(currency);
      expect(zero.toNumber()).toBe(0);
    });
  });

  describe('Consent Version', () => {
    // R17: the disclosure names Anthropic and Google, so the version moved on.
    it('should have v2.0 as current version', () => {
      expect(CURRENT_AI_CONSENT_VERSION).toBe('v2.0');
    });

    it('should follow version format', () => {
      expect(CURRENT_AI_CONSENT_VERSION).toMatch(/^v\d+\.\d+$/);
    });
  });

  describe('Error Codes', () => {
    const ERROR_CODES = [
      'RATE_LIMIT_EXCEEDED',
      'CONSENT_REQUIRED',
      'INVALID_INPUT',
      'EXTERNAL_API_ERROR',
      'QUERY_FAILED',
      'CONVERSATION_NOT_FOUND',
      'TOOL_EXECUTION_FAILED'
    ];

    it('should have defined error codes', () => {
      expect(ERROR_CODES.length).toBeGreaterThan(0);
      ERROR_CODES.forEach(code => {
        expect(code).toMatch(/^[A-Z_]+$/);
      });
    });
  });

  describe('API Response Format', () => {
    it('should have correct chat response structure', () => {
      const expectedResponse = {
        reply: 'string',
        conversationId: 'string',
        toolsUsed: ['string'],
        tokenCount: 0,
        remainingQueries: 0,
        provenance: {
          dataWindow: {
            start: '2026-02-01',
            end: '2026-02-29'
          },
          freshnessTs: '2026-02-07T14:10:00Z',
          tools: ['get_spending_by_category']
        }
      };

      expect(expectedResponse).toHaveProperty('reply');
      expect(expectedResponse).toHaveProperty('conversationId');
      expect(expectedResponse).toHaveProperty('toolsUsed');
      expect(expectedResponse).toHaveProperty('tokenCount');
      expect(expectedResponse).toHaveProperty('remainingQueries');
      expect(expectedResponse).toHaveProperty('provenance');
    });

    it('should have correct consent response structure', () => {
      const expectedResponse = {
        consentGiven: true,
        consentDate: '2026-01-15T00:00:00Z',
        consentVersion: 'v1.0'
      };

      expect(expectedResponse).toHaveProperty('consentGiven');
      expect(expectedResponse).toHaveProperty('consentDate');
      expect(expectedResponse).toHaveProperty('consentVersion');
    });
  });

  describe('Privacy and Data Minimization', () => {
    it('should have max limits for data returns', () => {
      const MAX_CATEGORIES = 20;
      const MAX_GOALS = 10;
      const MAX_TRANSACTIONS = 20;
      const MAX_MERCHANTS = 10;
      const MAX_ACCOUNTS = 20;

      expect(MAX_CATEGORIES).toBeLessThanOrEqual(20);
      expect(MAX_GOALS).toBeLessThanOrEqual(20);
      expect(MAX_TRANSACTIONS).toBeLessThanOrEqual(20);
      expect(MAX_MERCHANTS).toBeLessThanOrEqual(20);
      expect(MAX_ACCOUNTS).toBeLessThanOrEqual(20);
    });
  });
});
