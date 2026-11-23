/**
 * AI Sanitizer - Unit Tests
 *
 * Tests PII removal, data minimization, and sanitization rules.
 *
 * @module ai/__tests__/ai.sanitizer.test
 */

import { describe, it, expect } from 'vitest';
import { Money } from '../../../core/money';
import {
  sanitizeSpendingData,
  sanitizeGoalData,
  sanitizeTransactionData,
  sanitizeMerchantData,
  sanitizeAccountData,
  getSanitizationSummary
} from '../ai.sanitizer';
import type {
  SpendingByCategoryResult,
  GoalStatusResult,
  RecentTransactionResult,
  TopMerchantResult,
  AccountBalanceResult
} from '../ai.types';

describe('AI Sanitizer', () => {
  const currency = 'ZMW';

  describe('sanitizeSpendingData', () => {
    it('should convert Money objects to strings', () => {
      const data: SpendingByCategoryResult[] = [
        {
          category: 'Food',
          amount: Money.from('1000.00', currency),
          transactionCount: 10,
          percentOfTotal: 50
        }
      ];

      const result = sanitizeSpendingData(data, currency);

      expect(typeof result.categories[0].amount).toBe('string');
      expect(typeof result.total).toBe('string');
    });

    it('should limit to 20 categories', () => {
      const data: SpendingByCategoryResult[] = Array.from({ length: 30 }, (_, i) => ({
        category: `Category ${i}`,
        amount: Money.from('100.00', currency),
        transactionCount: 5,
        percentOfTotal: 3.33
      }));

      const result = sanitizeSpendingData(data, currency);

      expect(result.categories.length).toBe(20);
      expect(result.total).toBe('3000.00');

      data[29].amount = null;
      expect(sanitizeSpendingData(data, currency)).toMatchObject({ total: null, rankingAvailability: 'unavailable' });
    });

    it('should calculate total correctly', () => {
      const data: SpendingByCategoryResult[] = [
        { category: 'Food', amount: Money.from('100.00', currency), transactionCount: 5, percentOfTotal: 50 },
        { category: 'Transport', amount: Money.from('50.00', currency), transactionCount: 3, percentOfTotal: 25 }
      ];

      const result = sanitizeSpendingData(data, currency);

      // Total should contain 150 (the value) - format may vary based on Money.toString()
      expect(result.total).toContain('150');
    });
  });

  describe('sanitizeGoalData', () => {
    it('should limit to 10 goals', () => {
      const data: GoalStatusResult[] = Array.from({ length: 15 }, (_, i) => ({
        goalId: `goal-${i}`,
        name: `Goal ${i}`,
        target: Money.from('1000.00', currency),
        current: Money.from('500.00', currency),
        status: 'on_track' as const,
        projectedCompletion: '2026-12-31',
        monthlyContribution: Money.from('100.00', currency)
      }));

      const result = sanitizeGoalData(data);

      expect(result.goals.length).toBe(10);
    });

    it('should remove goal IDs', () => {
      const data: GoalStatusResult[] = [
        {
          goalId: 'secret-uuid-12345',
          name: 'Emergency Fund',
          target: Money.from('10000.00', currency),
          current: Money.from('5000.00', currency),
          status: 'on_track',
          projectedCompletion: '2026-12-31',
          monthlyContribution: Money.from('500.00', currency)
        }
      ];

      const result = sanitizeGoalData(data);

      expect(result.goals[0]).not.toHaveProperty('goalId');
    });

    it('should sanitize goal names containing possessives', () => {
      const data: GoalStatusResult[] = [
        {
          goalId: 'goal-1',
          name: "John's Emergency Fund",
          target: Money.from('10000.00', currency),
          current: Money.from('5000.00', currency),
          status: 'on_track',
          projectedCompletion: '2026-12-31',
          monthlyContribution: Money.from('500.00', currency)
        }
      ];

      const result = sanitizeGoalData(data);

      expect(result.goals[0].name).not.toContain("John's");
      expect(result.goals[0].name).toContain('Emergency Fund');
    });

    it('should calculate progress percentage correctly', () => {
      const data: GoalStatusResult[] = [
        {
          goalId: 'goal-1',
          name: 'Savings Goal',
          target: Money.from('1000.00', currency),
          current: Money.from('250.00', currency),
          status: 'on_track',
          projectedCompletion: null,
          monthlyContribution: Money.zero(currency)
        }
      ];

      const result = sanitizeGoalData(data);

      expect(result.goals[0].progressPercent).toBe(25);
    });

    it('should cap progress at 100%', () => {
      const data: GoalStatusResult[] = [
        {
          goalId: 'goal-1',
          name: 'Savings Goal',
          target: Money.from('1000.00', currency),
          current: Money.from('1500.00', currency),
          status: 'completed',
          projectedCompletion: null,
          monthlyContribution: Money.zero(currency)
        }
      ];

      const result = sanitizeGoalData(data);

      expect(result.goals[0].progressPercent).toBe(100);
    });
  });

  describe('sanitizeTransactionData', () => {
    it('should limit to 20 transactions', () => {
      const data: RecentTransactionResult[] = Array.from({ length: 30 }, (_, i) => ({
        transactionId: `txn-${i}`,
        date: '2026-01-15',
        description: `Transaction ${i}`,
        amount: Money.from('50.00', currency),
        category: 'Shopping',
        merchant: `Merchant ${i}`
      }));

      const result = sanitizeTransactionData(data);

      expect(result.transactions.length).toBe(20);
    });

    it('should remove transaction IDs', () => {
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'secret-txn-uuid',
          date: '2026-01-15',
          description: 'Shoprite',
          amount: Money.from('150.00', currency),
          category: 'Groceries',
          merchant: 'Shoprite'
        }
      ];

      const result = sanitizeTransactionData(data);

      expect(result.transactions[0]).not.toHaveProperty('transactionId');
    });

    it('should mark transactions with @ symbol as private', () => {
      // The sanitizer treats @ as a personal indicator and masks the entire description
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'txn-1',
          date: '2026-01-15',
          description: 'Shoprite Purchase john@example.com',
          amount: Money.from('100.00', currency),
          category: 'Shopping',
          merchant: null
        }
      ];

      const result = sanitizeTransactionData(data);

      // Email addresses trigger privacy masking
      expect(result.transactions[0].description).not.toContain('john@example.com');
      expect(result.transactions[0].description).toBe('Private Transaction');
    });

    it('should mark personal payment descriptions as private', () => {
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'txn-1',
          date: '2026-01-15',
          description: 'Payment to John Doe',
          amount: Money.from('100.00', currency),
          category: 'Transfer',
          merchant: null
        }
      ];

      const result = sanitizeTransactionData(data);

      // Personal transfers should be completely masked
      expect(result.transactions[0].description).toBe('Private Transaction');
    });

    it('should mask phone numbers', () => {
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'txn-1',
          date: '2026-01-15',
          description: 'Transfer to +260971234567',
          amount: Money.from('100.00', currency),
          category: 'Transfer',
          merchant: null
        }
      ];

      const result = sanitizeTransactionData(data);

      expect(result.transactions[0].description).not.toContain('+260971234567');
    });

    it('should mask account numbers', () => {
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'txn-1',
          date: '2026-01-15',
          description: 'Bank Transfer Ref: 123456789',
          amount: Money.from('500.00', currency),
          category: 'Transfer',
          merchant: null
        }
      ];

      const result = sanitizeTransactionData(data);

      expect(result.transactions[0].description).not.toContain('123456789');
      expect(result.transactions[0].description).toContain('####');
    });

    it('should mark personal transfers as private', () => {
      const data: RecentTransactionResult[] = [
        {
          transactionId: 'txn-1',
          date: '2026-01-15',
          description: 'Transfer to John Doe',
          amount: Money.from('200.00', currency),
          category: 'Transfer',
          merchant: 'Transfer to John'
        }
      ];

      const result = sanitizeTransactionData(data);

      expect(result.transactions[0].description).toBe('Private Transaction');
    });
  });

  describe('sanitizeMerchantData', () => {
    it('should limit to 10 merchants', () => {
      const data: TopMerchantResult[] = Array.from({ length: 15 }, (_, i) => ({
        merchantId: `merchant-${i}`,
        merchantName: `Merchant ${i}`,
        totalSpent: Money.from('500.00', currency),
        transactionCount: 10,
        avgTransactionAmount: Money.from('50.00', currency)
      }));

      const result = sanitizeMerchantData(data);

      expect(result.length).toBe(10);
    });

    it('should remove merchant IDs', () => {
      const data: TopMerchantResult[] = [
        {
          merchantId: 'secret-merchant-id',
          merchantName: 'Shoprite',
          totalSpent: Money.from('1000.00', currency),
          transactionCount: 20,
          avgTransactionAmount: Money.from('50.00', currency)
        }
      ];

      const result = sanitizeMerchantData(data);

      expect(result[0]).not.toHaveProperty('merchantId');
    });
  });

  describe('sanitizeAccountData', () => {
    it('should limit to 20 accounts', () => {
      const data: AccountBalanceResult[] = Array.from({ length: 25 }, (_, i) => ({
        accountId: `account-${i}`,
        accountName: `Account ${i}`,
        accountType: 'checking',
        balance: Money.from('1000.00', currency),
        currency,
        isActive: true
      }));

      const result = sanitizeAccountData(data);

      expect(result.length).toBe(20);
    });

    it('should remove account IDs', () => {
      const data: AccountBalanceResult[] = [
        {
          accountId: 'secret-account-uuid',
          accountName: "John's Checking",
          accountType: 'checking',
          balance: Money.from('5000.00', currency),
          currency,
          isActive: true
        }
      ];

      const result = sanitizeAccountData(data);

      expect(result[0]).not.toHaveProperty('accountId');
    });

    it('should generalize account names', () => {
      const data: AccountBalanceResult[] = [
        {
          accountId: 'acc-1',
          accountName: "John's Personal Savings at ABC Bank",
          accountType: 'savings',
          balance: Money.from('10000.00', currency),
          currency,
          isActive: true
        }
      ];

      const result = sanitizeAccountData(data);

      expect(result[0].name).toBe('savings_1');
      expect(result[0].name).not.toContain('John');
      expect(result[0].name).not.toContain('ABC Bank');
    });
  });

  describe('getSanitizationSummary', () => {
    it('should generate correct summary', () => {
      const summary = getSanitizationSummary(30, 20, 'transactions');
      expect(summary).toBe('transactions: 20 items sent (10 removed for privacy)');
    });

    it('should handle no removal', () => {
      const summary = getSanitizationSummary(10, 10, 'categories');
      expect(summary).toBe('categories: 10 items sent (0 removed for privacy)');
    });
  });
});
