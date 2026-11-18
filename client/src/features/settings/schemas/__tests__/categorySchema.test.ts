import { describe, it, expect } from 'vitest';
import { categorySchema, categoryGroupSchema } from '../categorySchema';

describe('categorySchema', () => {
  describe('name validation', () => {
    it('accepts valid category name', () => {
      const result = categorySchema.safeParse({
        name: 'Groceries',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = categorySchema.safeParse({
        name: '',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Category name is required');
      }
    });

    it('rejects name exceeding 50 characters', () => {
      const result = categorySchema.safeParse({
        name: 'a'.repeat(51),
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Category name cannot exceed 50 characters');
      }
    });
  });

  describe('color validation', () => {
    it('accepts valid hex color', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#FF5733',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });

    it('accepts lowercase hex color', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#ff5733',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid hex color', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: 'red',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
    });

    it('rejects hex color without hash', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: 'FF5733',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
    });

    it('rejects short hex color', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#F53',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('groupId validation', () => {
    it('accepts valid UUID', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000005',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty string', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid UUID', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('budget validation', () => {
    it('accepts positive budget', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
        budget: 500,
      });
      expect(result.success).toBe(true);
    });

    it('accepts zero budget', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
        budget: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative budget', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
        budget: -100,
      });
      expect(result.success).toBe(false);
    });

    it('accepts undefined budget', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('default values', () => {
    it('applies default isArchived', () => {
      const result = categorySchema.safeParse({
        name: 'Test',
        color: '#6366f1',
        groupId: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isArchived).toBe(false);
      }
    });
  });
});

describe('categoryGroupSchema', () => {
  it('accepts valid category group', () => {
    const result = categoryGroupSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Income',
      type: 'income',
    });
    expect(result.success).toBe(true);
  });

  it('accepts expense type', () => {
    const result = categoryGroupSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Expenses',
      type: 'expenses',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = categoryGroupSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});
