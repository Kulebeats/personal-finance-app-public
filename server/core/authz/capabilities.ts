/** Household role grants; resource visibility and consent remain separate checks. */
const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
export type HouseholdRole = (typeof roles)[number];
export type Capability =
  | "financial.read"
  | "financial.write"
  | "financial.export"
  | "household.policy.write"
  | "personal.settings"
  | "personal.export"
  | "ai.read";

const grants: Record<Capability, readonly HouseholdRole[]> = {
  "financial.read": roles,
  "financial.write": ["owner", "admin", "member"],
  "financial.export": ["owner", "admin", "member"],
  "household.policy.write": ["owner", "admin"],
  "personal.settings": roles,
  "personal.export": roles,
  "ai.read": roles,
};

export function isHouseholdRole(role: unknown): role is HouseholdRole {
  return roles.some((known) => known === role);
}

export function can(role: unknown, capability: Capability): boolean {
  return isHouseholdRole(role) &&
    Object.hasOwn(grants, capability) && grants[capability].includes(role);
}
