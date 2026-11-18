/**
 * AI Tool-Arg Validation Tests (SCP-314)
 *
 * Proves that Gemini-supplied tool arguments are validated with their Zod schema
 * BEFORE they can reach any SQL filter (ILIKE / gte / lte / eq) in the analytics
 * layer. Malformed, out-of-range, or injection-shaped args must be rejected and
 * MUST NOT trigger a query; valid args must pass through (defaulted + typed).
 *
 * Two layers:
 *  1. Unit: `validateToolArgs` accepts/rejects directly.
 *  2. Service: drive the REAL `AIService` with a spied analytics layer and assert
 *     the analytics method is never called for bad args, and called with parsed
 *     args for good ones.
 *
 * @module ai/__tests__/ai.tool-arg-validation.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToolArgs } from '../ai.validation';
import type { GeminiToolCall } from '../ai.gemini';

// ---------------------------------------------------------------------------
// Layer 1: validateToolArgs unit tests (no DB, no service)
// ---------------------------------------------------------------------------

describe('validateToolArgs (SCP-314 unit)', () => {
  it('rejects an unknown tool (fail closed)', () => {
    const result = validateToolArgs('drop_tables', {});
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong-type numeric arg (limit as string)', () => {
    const result = validateToolArgs('get_recent_transactions', { limit: 'lots' });
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range numeric arg (limit above max)', () => {
    const result = validateToolArgs('get_recent_transactions', { limit: 100000 });
    expect(result.ok).toBe(false);
  });

  it('rejects a bad period enum value', () => {
    const result = validateToolArgs('get_spending_by_category', { period: '1y' });
    expect(result.ok).toBe(false);
  });

  it('rejects the 7d window for merchant spending (enum mismatch)', () => {
    const result = validateToolArgs('get_merchant_spending', { period: '7d' });
    expect(result.ok).toBe(false);
  });

  it('rejects an injection-shaped search text with LIKE wildcards', () => {
    const result = validateToolArgs('get_transaction_search', { text: "%' OR '1'='1" });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-UUID categoryId that would flow into an eq() filter', () => {
    const result = validateToolArgs('get_transaction_search', {
      categoryId: '1 OR 1=1'
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-existent date (2026-02-30) that would flow into a gte() filter', () => {
    const result = validateToolArgs('get_transaction_search', { dateFrom: '2026-02-30' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric amount that would flow into a lte() filter', () => {
    const result = validateToolArgs('get_transaction_search', { maxAmount: 'abc' });
    expect(result.ok).toBe(false);
  });

  it('accepts valid args and applies the documented default', () => {
    const result = validateToolArgs('get_spending_by_category', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.period).toBe('30d');
    }
  });

  it('accepts a fully-specified valid transaction search', () => {
    const result = validateToolArgs('get_transaction_search', {
      text: 'coffee',
      categoryId: '11111111-2222-3333-4444-555555555555',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-01',
      minAmount: '10.50',
      maxAmount: '500',
      limit: 25
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.text).toBe('coffee');
      expect(result.args.limit).toBe(25);
    }
  });

  it('strips unknown keys the model may inject', () => {
    const result = validateToolArgs('get_recent_transactions', {
      limit: 5,
      __proto__hack: 'x',
      extra: 'ignored'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.extra).toBeUndefined();
      expect(result.args.limit).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2: service-level enforcement (bad args never hit the analytics layer)
// ---------------------------------------------------------------------------

// Hoisted spies (vi.mock factories are hoisted above normal consts).
const { auditLog, generateResponse, searchTransactionsSpy, getRecentTransactionsSpy } =
  vi.hoisted(() => ({
    auditLog: vi.fn().mockResolvedValue(undefined),
    generateResponse: vi.fn().mockResolvedValue({
      response: 'Here is your summary.',
      tokenCount: 50
    }),
    searchTransactionsSpy: vi.fn().mockResolvedValue([]),
    getRecentTransactionsSpy: vi.fn().mockResolvedValue([])
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
      households: {
        findFirst: vi.fn().mockResolvedValue({ currency: 'ZMW' })
      }
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

let selectedToolCalls: GeminiToolCall[] = [];
vi.mock('../ai.gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai.gemini')>();
  return {
    ...actual,
    geminiClient: {
      isAvailable: vi.fn().mockReturnValue(true),
      analyzeQuery: vi.fn().mockImplementation(async () => ({
        toolCalls: selectedToolCalls,
        textResponse: undefined,
        tokenCount: 20
      })),
      generateResponse
    }
  };
});

// Analytics layer is spied: if a query method is invoked, the spy records it.
// For the SCP-314 guarantee, bad args must mean these spies are NEVER called.
vi.mock('../ai.analytics.service', () => ({
  AIAnalyticsService: class {
    searchTransactions = searchTransactionsSpy;
    getRecentTransactions = getRecentTransactionsSpy;
    async getSpendingByCategory() {
      return [];
    }
    async getGoalsStatus() {
      return [];
    }
    async getUpcomingRecurring() {
      return [];
    }
    async getBudgetStatus() {
      return [];
    }
    async getAccountBalances() {
      return [];
    }
    async getMerchantSpending() {
      return [];
    }
    async getCategoryTrends() {
      return [];
    }
    async getMonthlySummary() {
      return {};
    }
    async getGoalAssignments() {
      return [];
    }
    async getCashFlow() {
      return [];
    }
  }
}));

// Import AFTER mocks are registered.
import { AIService } from '../ai.service';

describe('AIService tool-arg validation enforcement (SCP-314)', () => {
  beforeEach(() => {
    auditLog.mockClear();
    generateResponse.mockClear();
    searchTransactionsSpy.mockClear();
    getRecentTransactionsSpy.mockClear();
    selectedToolCalls = [];
  });

  it('does NOT run the transaction-search query when args are injection-shaped', async () => {
    selectedToolCalls = [
      { name: 'get_transaction_search', args: { text: "%' OR '1'='1" } }
    ];
    const service = new AIService();

    await service.processQuery({
      userId: 'user-1',
      householdId: 'household-1',
      message: 'find sneaky transactions'
    });

    // The filter never receives the hostile string: the query is not run.
    expect(searchTransactionsSpy).not.toHaveBeenCalled();
    // Nothing was forwarded to the model (no valid tool result).
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('does NOT run the query when a date filter arg is a non-existent date', async () => {
    selectedToolCalls = [
      { name: 'get_transaction_search', args: { dateFrom: '2026-02-30' } }
    ];
    const service = new AIService();

    await service.processQuery({
      userId: 'user-1',
      householdId: 'household-1',
      message: 'transactions since a fake date'
    });

    expect(searchTransactionsSpy).not.toHaveBeenCalled();
  });

  it('does NOT run the query when limit is the wrong type', async () => {
    selectedToolCalls = [
      { name: 'get_recent_transactions', args: { limit: 'all of them' } }
    ];
    const service = new AIService();

    await service.processQuery({
      userId: 'user-1',
      householdId: 'household-1',
      message: 'show recent'
    });

    expect(getRecentTransactionsSpy).not.toHaveBeenCalled();
  });

  it('runs the query with parsed/typed args when the args are valid', async () => {
    selectedToolCalls = [
      {
        name: 'get_transaction_search',
        args: { text: 'coffee', minAmount: '10.00', limit: 5 }
      }
    ];
    const service = new AIService();

    await service.processQuery({
      userId: 'user-1',
      householdId: 'household-1',
      message: 'coffee spending'
    });

    expect(searchTransactionsSpy).toHaveBeenCalledTimes(1);
    const callArgs = searchTransactionsSpy.mock.calls[0];
    // Second positional arg is the validated filter object.
    expect(callArgs[1]).toMatchObject({
      text: 'coffee',
      minAmount: '10.00',
      limit: 5
    });
  });

  it('applies the default limit (20) when get_recent_transactions is called with no limit', async () => {
    selectedToolCalls = [{ name: 'get_recent_transactions', args: {} }];
    const service = new AIService();

    await service.processQuery({
      userId: 'user-1',
      householdId: 'household-1',
      message: 'recent transactions'
    });

    expect(getRecentTransactionsSpy).toHaveBeenCalledTimes(1);
    // Second positional arg is the limit.
    expect(getRecentTransactionsSpy.mock.calls[0][1]).toBe(20);
  });
});
