import type { HouseholdRole } from "@shared/household-members";

/**
 * AH-13: what each household role can do, as the server grants it
 * (server/core/authz/capabilities.ts). View Only and Professional hold the
 * same grants: read, no financial writes, no household export. Professional
 * is a label for an outside adviser, not extra access, so it promises none.
 * The members screen and the invite dialog both read these lines.
 */
export const ROLE_LABELS: Readonly<Record<HouseholdRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  view_only: "View Only",
  professional: "Professional",
};

export const ROLE_DESCRIPTIONS: Readonly<Record<HouseholdRole, string>> = {
  owner: "Full control over household",
  admin: "Can manage members and settings",
  member: "Can add/edit transactions",
  view_only: "Read-only access; cannot export household data",
  professional: "Read-only access for an outside adviser; cannot export household data",
};
