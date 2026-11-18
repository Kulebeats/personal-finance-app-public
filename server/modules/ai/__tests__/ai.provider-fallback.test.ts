/**
 * AI Service - provider-failure fallback (live-testing finding, 2026-07-20)
 *
 * Found by exercising the real Gemini path against a real key: the key's
 * Google project had `free_tier_requests limit: 0`, so every generation
 * returned 429. The service turned that into a 500 INTERNAL_ERROR.
 *
 * Two defects, both proven here:
 *
 * 1. RESILIENCE. The keyword fallback is only reachable when the provider is
 *    unconfigured (`isAvailable() === false`) — i.e. the service degrades
 *    gracefully when it has no key, but hard-fails when it HAS a key and the
 *    provider errors. That is backwards: quota exhaustion, provider outages,
 *    and transient 5xx are the LIKELY production failures, and the fallback
 *    can answer all of them. A provider error must degrade to the fallback,
 *    not surface as an internal error.
 *
 * 2. AUDIT HONESTY (Rule 9 / Rule 4.2). `used_gemini` was written from
 *    `geminiClient.isAvailable()` — the CONFIGURATION state — so a
 *    keyword-generated reply produced during a provider outage would be
 *    attested in the DPA audit log as having used the external processor.
 *    Same class of false attestation as the hardcoded `data_sanitized: true`
 *    the 2026-06-04 audit flagged. It must reflect what actually happened.
 *
 * The positive-control test is deliberate: it proves the `used_gemini: false`
 * assertions below are not vacuously passing.
 *
 * @module ai/__tests__/ai.provider-fallback.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Money } from '../../../core/money';
import { AIErrorCode } from '../ai.types';

const currency = 'ZMW';

// Hoisted spies (vi.mock factories hoist above plain `const`s).
const { auditLog, analyzeQuery, generateResponse, recordExchange } = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  analyzeQuery: vi.fn(),
  generateResponse: vi.fn(),
  recordExchange: vi.fn().mockResolvedValue('conversation-1')
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../services/BusinessAuditService', () => ({
  businessAuditService: { log: auditLog, getIpAddress: vi.fn() }
}));

vi.mock('../../../db', () => ({
  db: {
    query: {
      households: { findFirst: vi.fn().mockResolvedValue({ currency: 'ZMW' }) }
    }
  }
}));

vi.mock('../ai.cache', () => ({
  aiCache: {
    isCacheable: vi.fn().mockReturnValue(false),
    generateKey: vi.fn().mockReturnValue('key'),
    getAsync: vi.fn().mockResolvedValue(null),
    setAsync: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../ai.conversation.service', () => ({
  AIConversationService: class {
    recordExchange = recordExchange;
    async get() {
      return { messages: [] };
    }
  }
}));

// The provider is CONFIGURED throughout this file — that is the whole point.
// The failure being modelled is a configured provider that errors at runtime.
vi.mock('../ai.gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai.gemini')>();
  return {
    ...actual,
    geminiClient: {
      isAvailable: vi.fn().mockReturnValue(true),
      analyzeQuery,
      generateResponse
    }
  };
});

vi.mock('../ai.analytics.service', () => ({
  AIAnalyticsService: class {
    async getSpendingByCategory() {
      return [
        {
          category: 'Groceries',
          amount: Money.from('1250.00', 'ZMW'),
          transactionCount: 12,
          percentOfTotal: 42
        }
      ];
    }
    async getAccountBalances() {
      return [];
    }
    async getMerchantSpending() {
      return [];
    }
    async getGoalAssignments() {
      return [];
    }
    async getUpcomingRecurring() {
      return [];
    }
    async getGoalsStatus() {
      return [];
    }
    async getRecentTransactions() {
      return [];
    }
    async getBudgetStatus() {
      return [];
    }
    async getCategoryTrends() {
      return [];
    }
    async getMonthlySummary() {
      return {
        month: '2026-07',
        income: Money.from('0', 'ZMW'),
        expenses: Money.from('0', 'ZMW'),
        netSavings: Money.from('0', 'ZMW'),
        savingsRate: 0
      };
    }
    async searchTransactions() {
      return [];
    }
    async getCashFlow() {
      return [];
    }
  }
}));

// Import AFTER mocks are registered.
import { AIService } from '../ai.service';

/** Build the exact error shape the real client throws (see ai.gemini.ts handleError). */
function providerError(code: AIErrorCode, message: string): Error {
  const err = new Error(message) as Error & { code: AIErrorCode; retryable: boolean };
  err.code = code;
  err.retryable = true;
  return err;
}

function auditDetails(): Record<string, unknown> {
  expect(auditLog).toHaveBeenCalledTimes(1);
  return auditLog.mock.calls[0][0].details as Record<string, unknown>;
}

const query = {
  userId: 'user-1',
  householdId: 'household-1',
  message: 'How much did I spend on groceries?'
};

describe('AI Service - provider failure degrades to keyword fallback', () => {
  beforeEach(() => {
    auditLog.mockClear();
    analyzeQuery.mockReset();
    generateResponse.mockReset();
    recordExchange.mockClear();
  });

  it('answers via the fallback when the provider is quota-exhausted (429) instead of throwing', async () => {
    // This is the live failure: key valid, project quota limit 0.
    analyzeQuery.mockRejectedValue(
      providerError(AIErrorCode.RATE_LIMIT_EXCEEDED, 'Gemini API rate limit exceeded')
    );

    const result = await new AIService().processQuery(query);

    // Before the fix this threw, and the controller returned 500 INTERNAL_ERROR.
    expect(result.reply).toBeTruthy();
    expect(result.reply.length).toBeGreaterThan(0);
    // The fallback genuinely answered from real tool data, not an error string.
    expect(result.reply.toLowerCase()).not.toContain('internal error');
    expect(result.toolsUsed.length).toBeGreaterThan(0);
  });

  it('records used_gemini: false when the reply came from the fallback', async () => {
    analyzeQuery.mockRejectedValue(
      providerError(AIErrorCode.RATE_LIMIT_EXCEEDED, 'Gemini API rate limit exceeded')
    );

    await new AIService().processQuery(query);

    const details = auditDetails();
    // Provenance: the reply did NOT come from the provider.
    expect(details.used_gemini).toBe(false);
    expect(details.provider_error).toBe(AIErrorCode.RATE_LIMIT_EXCEEDED);
    // ...but the message WAS transmitted before the call failed. Both facts are
    // recorded, so the audit trail can't be read as "nothing left the boundary".
    expect(details.provider_attempted).toBe(true);
  });

  it('does NOT swallow non-provider errors (a real bug must still surface)', async () => {
    // A bug in our own code has no provider error code. If this degraded to a
    // keyword answer, defects would hide behind plausible replies — the exact
    // failure mode the 2026-06-04 audit documented.
    analyzeQuery.mockRejectedValue(new TypeError('cannot read property of undefined'));

    await expect(new AIService().processQuery(query)).rejects.toThrow();
  });

  it('degrades on a generic provider outage too, not just 429', async () => {
    analyzeQuery.mockRejectedValue(
      providerError(AIErrorCode.EXTERNAL_API_ERROR, 'Request timed out')
    );

    const result = await new AIService().processQuery(query);

    expect(result.reply).toBeTruthy();
    expect(auditDetails().used_gemini).toBe(false);
  });

  it('degrades when the provider fails AFTER tool selection, during response generation', async () => {
    // Partial failure: analysis succeeded, tools ran, then generation died.
    analyzeQuery.mockResolvedValue({
      toolCalls: [{ name: 'get_spending_by_category', args: { period: '30d' } }],
      textResponse: undefined,
      tokenCount: 20
    });
    generateResponse.mockRejectedValue(
      providerError(AIErrorCode.RATE_LIMIT_EXCEEDED, 'Gemini API rate limit exceeded')
    );

    const result = await new AIService().processQuery(query);

    expect(result.reply).toBeTruthy();
    expect(auditDetails().used_gemini).toBe(false);
  });

  it('POSITIVE CONTROL: a healthy provider still reports used_gemini: true', async () => {
    // Without this, the assertions above would pass even if `used_gemini` were
    // hardcoded to false — the mirror image of the bug being fixed.
    analyzeQuery.mockResolvedValue({
      toolCalls: [{ name: 'get_spending_by_category', args: { period: '30d' } }],
      textResponse: undefined,
      tokenCount: 20
    });
    generateResponse.mockResolvedValue({
      response: 'You spent K1,250.00 on Groceries.',
      tokenCount: 50
    });

    const result = await new AIService().processQuery(query);

    expect(result.reply).toBe('You spent K1,250.00 on Groceries.');
    const details = auditDetails();
    expect(details.used_gemini).toBe(true);
    expect(details.provider_error).toBeUndefined();
  });
});
