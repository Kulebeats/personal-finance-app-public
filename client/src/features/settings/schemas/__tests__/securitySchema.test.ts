import { describe, it, expect } from 'vitest';
import { passwordChangeSchema, calculatePasswordStrength, getPasswordStrengthLabel } from '../securitySchema';

describe('passwordChangeSchema', () => {
  describe('currentPassword validation', () => {
    it('rejects empty current password', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: '',
        newPassword: 'NewPass123',
        confirmPassword: 'NewPass123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('newPassword validation', () => {
    it('accepts valid password', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'NewPass123',
        confirmPassword: 'NewPass123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects password shorter than 8 characters', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'Pass1',
        confirmPassword: 'Pass1',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('8 characters'))).toBe(true);
      }
    });

    it('rejects password without uppercase letter', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('uppercase'))).toBe(true);
      }
    });

    it('rejects password without lowercase letter', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'NEWPASS123',
        confirmPassword: 'NEWPASS123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('lowercase'))).toBe(true);
      }
    });

    it('rejects password without number', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'NewPassword',
        confirmPassword: 'NewPassword',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('number'))).toBe(true);
      }
    });
  });

  describe('password confirmation', () => {
    it('rejects mismatched passwords', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: 'NewPass123',
        confirmPassword: 'DifferentPass123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message === 'Passwords do not match')).toBe(true);
      }
    });
  });
});

describe('calculatePasswordStrength', () => {
  it('returns 0 for very weak password', () => {
    expect(calculatePasswordStrength('abc')).toBe(0);
  });

  it('returns higher score for longer password', () => {
    expect(calculatePasswordStrength('abcdefgh')).toBeGreaterThan(0);
  });

  it('returns higher score for mixed case', () => {
    const lowerOnly = calculatePasswordStrength('abcdefgh');
    const mixedCase = calculatePasswordStrength('Abcdefgh');
    expect(mixedCase).toBeGreaterThan(lowerOnly);
  });

  it('returns higher score for numbers', () => {
    const noNumbers = calculatePasswordStrength('Abcdefgh');
    const withNumbers = calculatePasswordStrength('Abcdefg1');
    expect(withNumbers).toBeGreaterThan(noNumbers);
  });

  it('returns max score of 4', () => {
    expect(calculatePasswordStrength('VeryStr0ng!Pass')).toBeLessThanOrEqual(4);
  });
});

describe('getPasswordStrengthLabel', () => {
  it('returns correct labels', () => {
    expect(getPasswordStrengthLabel(0)).toBe('Very Weak');
    expect(getPasswordStrengthLabel(1)).toBe('Weak');
    expect(getPasswordStrengthLabel(2)).toBe('Fair');
    expect(getPasswordStrengthLabel(3)).toBe('Strong');
    expect(getPasswordStrengthLabel(4)).toBe('Very Strong');
  });

  it('returns Unknown for invalid score', () => {
    expect(getPasswordStrengthLabel(5)).toBe('Unknown');
    expect(getPasswordStrengthLabel(-1)).toBe('Unknown');
  });
});
