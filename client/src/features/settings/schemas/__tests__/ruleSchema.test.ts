import { describe, it, expect } from 'vitest';
import { ruleSchema, ruleConditionSchema, ruleActionSchema } from '../ruleSchema';

describe('ruleConditionSchema', () => {
  it('accepts valid condition', () => {
    const result = ruleConditionSchema.safeParse({
      type: 'description',
      operator: 'contains',
      value: 'grocery',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid fields', () => {
    const fields = [
      'merchant_name',
      'merchant_category',
      'amount',
      'account',
      'description',
      'category',
      'transaction_type',
    ];
    fields.forEach(type => {
      const result = ruleConditionSchema.safeParse({
        type,
        operator: 'equals',
        value: 'test',
      });
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid field', () => {
    const result = ruleConditionSchema.safeParse({
      type: 'invalid',
      operator: 'contains',
      value: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty value', () => {
    const result = ruleConditionSchema.safeParse({
      type: 'description',
      operator: 'contains',
      value: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Condition value is required');
    }
  });
});

describe('ruleActionSchema', () => {
  it('accepts valid action with string value', () => {
    const result = ruleActionSchema.safeParse({
      type: 'categorize',
      value: 'groceries',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid action with number value', () => {
    const result = ruleActionSchema.safeParse({
      type: 'categorize',
      value: 123,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid action types', () => {
    const types = [
      'rename_merchant',
      'categorize',
      'add_tags',
      'add_merchant_alias',
      'hide',
      'mark_reviewed',
      'link_goal',
      'assign_member',
      'set_owner',
      'set_merchant',
      'set_category_from_merchant',
    ];
    types.forEach(type => {
      const result = ruleActionSchema.safeParse({
        type,
        value: 'test',
      });
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid action type', () => {
    const result = ruleActionSchema.safeParse({
      type: 'invalid',
      value: 'test',
    });
    expect(result.success).toBe(false);
  });
});

describe('ruleSchema', () => {
  const validRule = {
    name: 'Grocery Rule',
    conditions: [
      { type: 'description', operator: 'contains', value: 'grocery' },
    ],
    actions: [
      { type: 'categorize', value: 'groceries' },
    ],
    isEnabled: true,
    priority: 1,
  };

  it('accepts valid rule', () => {
    const result = ruleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
  });

  describe('name validation', () => {
    it('rejects empty name', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        name: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Rule name is required');
      }
    });

    it('rejects name exceeding 100 characters', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        name: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('conditions validation', () => {
    it('rejects empty conditions array', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        conditions: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message === 'At least one condition is required')).toBe(true);
      }
    });

    it('accepts multiple conditions', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        conditions: [
          { type: 'description', operator: 'contains', value: 'grocery' },
          { type: 'amount', operator: 'greater_than', value: '50' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('actions validation', () => {
    it('rejects empty actions array', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        actions: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message === 'At least one action is required')).toBe(true);
      }
    });

    it('accepts multiple actions', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        actions: [
          { type: 'categorize', value: 'groceries' },
          { type: 'add_tags', value: 'food' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('priority validation', () => {
    it('accepts zero priority', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        priority: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative priority', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        priority: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer priority', () => {
      const result = ruleSchema.safeParse({
        ...validRule,
        priority: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('default values', () => {
    it('applies default isEnabled', () => {
      const result = ruleSchema.safeParse({
        name: 'Test',
        conditions: [{ type: 'description', operator: 'contains', value: 'test' }],
        actions: [{ type: 'categorize', value: 'test' }],
        priority: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isEnabled).toBe(true);
      }
    });
  });
});
