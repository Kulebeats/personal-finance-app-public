import { z } from "zod";

export const createMerchantSchema = z.object({
  name: z.string().min(1).max(255),
  logoUrl: z.string().url().nullable().optional(),
  category: z.string().max(100).optional().nullable(),
  defaultCategoryId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  iconType: z.string().max(20).optional().nullable(),
  customIcon: z.string().optional().nullable(),
});

export const updateMerchantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  logoUrl: z.string().url().nullable().optional(),
  category: z.string().max(100).optional().nullable(),
  defaultCategoryId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  iconType: z.string().max(20).optional().nullable(),
  customIcon: z.string().optional().nullable(),
});

export const mergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export const mergeBySourceSchema = z.object({
  targetMerchantId: z.string().uuid(),
});

export const undoMergeParamsSchema = z.object({
  historyId: z.string().uuid(),
});
