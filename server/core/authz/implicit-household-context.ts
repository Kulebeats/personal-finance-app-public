import { householdRepository } from "../../repositories/HouseholdRepository";
import { ForbiddenError } from "../errors";
import { isHouseholdRole, type HouseholdRole } from "./capabilities";
import type { Household } from "@shared/schema";

export interface HouseholdContext {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}
export interface ImplicitHouseholdSelection {
  household: Household;
  context: HouseholdContext;
}

/** Bootstrap and implicit guards use the same deterministic membership selection.
 * Missing household is expected; an inconsistent/unknown membership is forbidden.
 * Repository errors deliberately propagate instead of becoming onboarding.
 */
export async function resolveImplicitHouseholdSelection(userId: string): Promise<ImplicitHouseholdSelection | undefined> {
  const household = await householdRepository.findByUserId(userId);
  if (!household) return;
  const membership = await householdRepository.findMember(household.id, userId);
  if (!membership || !isHouseholdRole(membership.role)) {
    throw new ForbiddenError("Access denied. You are not a member of this household.");
  }
  return { household, context: { householdId: household.id, userId, role: membership.role } };
}

export async function resolveImplicitHouseholdContext(userId: string): Promise<HouseholdContext | undefined> {
  return (await resolveImplicitHouseholdSelection(userId))?.context;
}
