/**
 * Household Module Validation Schemas
 *
 * Zod schemas for validating household-related requests.
 *
 * @module modules/household/household.validation
 */

import { z } from "zod";

// ============================================================================
// Household Role Enum
// ============================================================================

export const householdRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "view_only",
]);

// ============================================================================
// Household CRUD Schemas
// ============================================================================

export const createHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  currency: z.string().length(3).default("USD"),
  timezone: z.string().max(50).optional(),
});

export const updateHouseholdSchema = createHouseholdSchema.partial();

// ============================================================================
// Member Management Schemas
// ============================================================================

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: householdRoleSchema.default("member"),
  message: z.string().max(500).optional(),
});

export const updateMemberRoleSchema = z.object({
  role: householdRoleSchema,
});

export const acceptInviteSchema = z.object({
  inviteCode: z.string().min(1).max(100),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
