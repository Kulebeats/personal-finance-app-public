import { z } from 'zod';

/**
 * Category validation schema using Zod
 * 
 * Validates category fields:
 * - Name is required and limited to 50 characters
 * - Color must be a valid hex color
 * - GroupId must be a UUID string
 * - Budget must be non-negative if provided
 */

// Hex color regex: # followed by 6 hex characters
const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

export const categorySchema = z.object({
  name: z.string()
    .min(1, 'Category name is required')
    .max(50, 'Category name cannot exceed 50 characters'),
  
  icon: z.string().max(50).optional(),
  
  color: z.string()
    .regex(hexColorRegex, 'Invalid color format (use #RRGGBB)'),
  
  groupId: z.string()
    .uuid('Group ID must be a valid UUID'),
  
  budget: z.number()
    .nonnegative('Budget cannot be negative')
    .optional(),
  
  isArchived: z.boolean().default(false),
});

export type CategoryFormData = z.infer<typeof categorySchema>;

// Default category data
export const defaultCategoryData: Partial<CategoryFormData> = {
  name: '',
  color: '#6366f1',
  isArchived: false,
};

/**
 * Category group schema for organizing categories
 */
export const categoryGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  type: z.enum(['income', 'expenses', 'transfers']),
  budgetMode: z.enum(['by_category', 'by_group']).optional(),
  rolloverEnabled: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export type CategoryGroupData = z.infer<typeof categoryGroupSchema>;
