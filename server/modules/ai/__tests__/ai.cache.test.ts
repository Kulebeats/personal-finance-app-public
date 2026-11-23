/**
 * AI Cache - Unit Tests
 *
 * Tests disabled tool admission and the retained legacy cache primitives.
 *
 * @module ai/__tests__/ai.cache.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AICache } from '../ai.cache';

describe('AICache', () => {
  let cache: AICache;

  beforeEach(() => {
    cache = new AICache();
  });

  afterEach(() => {
    cache.stop();
    cache.clear();
  });

  describe('isCacheable', () => {
    it.each([
      'get_spending_by_category',
      'get_goals_status',
      'get_upcoming_recurring',
      'get_account_balances',
      'get_merchant_spending',
      'get_category_trends',
      'get_monthly_summary',
      'get_goal_assignments',
      'get_cash_flow',
    ])('bypasses unsafe result reuse for %s', toolName => {
      expect(cache.isCacheable(toolName)).toBe(false);
    });

    it('should return false for non-cacheable tools', () => {
      expect(cache.isCacheable('get_budget_status')).toBe(false);
      expect(cache.isCacheable('get_recent_transactions')).toBe(false);
      expect(cache.isCacheable('get_transaction_search')).toBe(false);
    });

    it('should return false for unknown tools', () => {
      expect(cache.isCacheable('unknown_tool')).toBe(false);
    });
  });

  describe('generateKey', () => {
    it('should generate consistent keys for same inputs', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      const key2 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different households', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      const key2 = cache.generateKey({ householdId: 'hh-2', userId: 'member-a' }, 'get_spending', { period: '30d' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different tools', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      const key2 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_budget', { period: '30d' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different args', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      const key2 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '90d' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different members of one household', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'get_spending', { period: '30d' });
      const key2 = cache.generateKey({ householdId: 'hh-1', userId: 'member-b' }, 'get_spending', { period: '30d' });
      expect(key1).not.toBe(key2);
    });

    it('should refuse a key without the acting member', () => {
      expect(() => cache.generateKey({ householdId: 'hh-1', userId: '' }, 'get_spending', {})).toThrow();
    });

    it('should sort args for consistent keys', () => {
      const key1 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'tool', { a: 1, b: 2 });
      const key2 = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'tool', { b: 2, a: 1 });
      expect(key1).toBe(key2);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      const data = { categories: [{ name: 'Food', amount: '100' }] };
      cache.set('test-key', data);

      const result = cache.get('test-key');
      expect(result).toEqual(data);
    });

    it('should return null for missing keys', () => {
      const result = cache.get('nonexistent-key');
      expect(result).toBeNull();
    });

    it('should expire entries after TTL', async () => {
      const data = { test: 'value' };
      cache.set('expiring-key', data, 50); // 50ms TTL

      // Should exist immediately
      expect(cache.get('expiring-key')).toEqual(data);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should be expired
      expect(cache.get('expiring-key')).toBeNull();
    });
  });

  describe('invalidateHousehold', () => {
    it('should remove all entries for a household', () => {
      cache.set('ai:hh-1:tool1:', { data: 1 });
      cache.set('ai:hh-1:tool2:', { data: 2 });
      cache.set('ai:hh-2:tool1:', { data: 3 });

      const count = cache.invalidateHousehold('hh-1');

      expect(count).toBe(2);
      expect(cache.get('ai:hh-1:tool1:')).toBeNull();
      expect(cache.get('ai:hh-1:tool2:')).toBeNull();
      expect(cache.get('ai:hh-2:tool1:')).not.toBeNull();
    });

    it('should return 0 when no entries exist', () => {
      const count = cache.invalidateHousehold('nonexistent');
      expect(count).toBe(0);
    });
  });

  describe('invalidateTool', () => {
    it('should remove every generated member entry for the tool', () => {
      const memberA = cache.generateKey({ householdId: 'hh-1', userId: 'member-a' }, 'tool1', {});
      const memberB = cache.generateKey({ householdId: 'hh-1', userId: 'member-b' }, 'tool1', {});
      cache.set(memberA, { data: 1 });
      cache.set(memberB, { data: 2 });

      expect(cache.invalidateTool('hh-1', 'tool1')).toBe(2);
      expect(cache.get(memberA)).toBeNull();
      expect(cache.get(memberB)).toBeNull();
    });

    it('should remove entries for specific tool', () => {
      cache.set('ai:hh-1:tool1:a=1', { data: 1 });
      cache.set('ai:hh-1:tool1:b=2', { data: 2 });
      cache.set('ai:hh-1:tool2:a=1', { data: 3 });

      const count = cache.invalidateTool('hh-1', 'tool1');

      expect(count).toBe(2);
      expect(cache.get('ai:hh-1:tool1:a=1')).toBeNull();
      expect(cache.get('ai:hh-1:tool1:b=2')).toBeNull();
      expect(cache.get('ai:hh-1:tool2:a=1')).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should track cache hits and misses', () => {
      cache.set('key1', { data: 1 });

      // One hit
      cache.get('key1');
      // One miss
      cache.get('key2');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should track cache size', () => {
      cache.set('key1', { data: 1 });
      cache.set('key2', { data: 2 });

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', { data: 1 });
      cache.set('key2', { data: 2 });

      cache.clear();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.getStats().size).toBe(0);
    });
  });
});
