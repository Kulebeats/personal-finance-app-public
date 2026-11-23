import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { getVisibleRecurringRuleById } from "./RecurringAudienceQuery";
import { lockRecurringReferences, type RecurringAudienceLockOptions } from "./RecurringAudienceReferences";
export type { RecurringAudienceLockOptions } from "./RecurringAudienceReferences";

/** Existing callers retain the rule-only result; financial posting also consumes held facts. */
export async function lockRecurringAudienceWithReferences(tx: TransactionType, id: string, actor: HouseholdContext, options?: RecurringAudienceLockOptions) {
  const locked = await recurringRepository.findByIdForUpdate(id, actor.householdId, tx);
  if (!locked) throw new NotFoundError("Recurring rule");
  const rule = await getVisibleRecurringRuleById(id, actor, tx);
  const audience = await lockRecurringReferences(tx, [rule], actor.householdId, actor, options);
  await getVisibleRecurringRuleById(id, actor, tx);
  return { rule, audience };
}
export async function lockRecurringAudience(tx: TransactionType, id: string, actor: HouseholdContext, options?: RecurringAudienceLockOptions) {
  return (await lockRecurringAudienceWithReferences(tx, id, actor, options)).rule;
}
