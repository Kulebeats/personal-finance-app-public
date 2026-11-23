/**
 * Household roles and the members-screen contract, shared by the server
 * routes in server/modules/household and the client members screen (Rule 18).
 */

export const HOUSEHOLD_ROLES = ["owner", "admin", "member", "view_only", "professional"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/**
 * Roles an invitation may carry. Never "owner": ownership only moves by
 * transfer. Only the owner may invite an admin (spec §A3).
 */
export const INVITABLE_ROLES = ["admin", "member", "view_only", "professional"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * One row of GET /api/household/members. `name` is the member's full name,
 * display name or username, in that order. `email` is sent only to owners
 * and admins.
 */
export interface HouseholdMemberDto {
  userId: string;
  name: string;
  email?: string;
  role: HouseholdRole;
  joinedAt: string | null;
}

/** POST /api/household/invite body. */
export interface InviteMemberRequest {
  email: string;
  role: InvitableRole;
}
