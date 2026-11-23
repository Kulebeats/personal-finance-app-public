import type { HouseholdContext } from "../middleware/householdGuard";
import { can } from "../core/authz/capabilities";
import { ForbiddenError } from "../core/errors";

/** HTTP readers always supply their verified actor. Household-wide reads must
 * name the internal system operation rather than infer it from a missing actor. */
export type BudgetReadContext =
  | { kind: "actor"; actor: HouseholdContext }
  | { kind: "system"; purpose: string; sharedOnly?: boolean };

export function assertBudgetReadContext(householdId: string, context: BudgetReadContext): void {
  if (context?.kind === "actor" && context.actor?.householdId === householdId && context.actor.userId && can(context.actor.role, "financial.read")) return;
  if (context?.kind === "system" && context.purpose?.trim()) return;
  throw new ForbiddenError("A verified budget read context is required");
}
