import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { accounts, goals, householdMembers, merchants } from "@shared/schema";
import { ValidationError } from "../../core/errors";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";

/**
 * Household/visibility validation for every id-valued rule action other than
 * categories and tags (those have their own validators): set_owner,
 * link_goal and set_merchant (ORG-003, spec R04.3). The removed assign_member
 * action (A-44) is refused by the request schema and ignored here, so a rule
 * stored with it before the removal still saves edits and applies.
 *
 * The same checks run when a rule is saved (every authored action, disabled
 * ones included) and again when it is applied or previewed (enabled actions
 * only), because a member can leave or a goal can go after the rule was saved.
 */

const uuid = z.string().uuid();
const invalidOwner = () => new ValidationError("Invalid rule owner reference");
const invalidGoal = () => new ValidationError("Invalid rule goal reference");
const invalidMerchant = () => new ValidationError("Invalid rule merchant reference");

type EntityReferences = {
  ownerIds: string[];
  goalIds: string[];
  merchantIds: string[];
};

function readId(value: unknown, fail: () => ValidationError): string {
  if (typeof value !== "string" || !uuid.safeParse(value).success) throw fail();
  return value.toLowerCase();
}

/** Pull the id references out of authored actions; malformed values throw. */
function collectEntityReferences(
  actionSets: readonly unknown[],
  onlyEnabled: boolean,
): EntityReferences {
  const refs: EntityReferences = { ownerIds: [], goalIds: [], merchantIds: [] };
  for (const actions of actionSets) {
    if (!Array.isArray(actions)) throw new ValidationError("Invalid rule actions");
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const { type, value, enabled } = action as { type?: unknown; value?: unknown; enabled?: unknown };
      if (onlyEnabled && enabled === false) continue;
      if (type === "set_owner") {
        // "shared" (or empty) clears the owner; anything else must be a member id.
        if (value === "shared" || value === "") continue;
        refs.ownerIds.push(readId(value, invalidOwner));
      } else if (type === "link_goal") {
        refs.goalIds.push(readId(value, invalidGoal));
      } else if (type === "set_merchant") {
        refs.merchantIds.push(readId(value, invalidMerchant));
      }
    }
  }
  return refs;
}

const unique = (ids: string[]): string[] => Array.from(new Set(ids)).sort();

async function verifyMembers(
  refs: EntityReferences,
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  const ids = unique(refs.ownerIds);
  if (ids.length === 0) return;
  // SHARE keeps membership and role stable through the write; rows are locked in
  // user-id order for single and bulk authoring.
  const members = await tx
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, ids)))
    .orderBy(asc(householdMembers.userId))
    .for("share");
  const roleById = new Map(members.map((member) => [member.userId, member.role]));
  // An owner must be able to own transactions: not view-only, not professional.
  if (refs.ownerIds.some((id) => !can(roleById.get(id), "financial.write"))) throw invalidOwner();
}

async function verifyGoals(
  refs: EntityReferences,
  householdId: string,
  tx: TransactionType,
  actor?: HouseholdContext,
): Promise<void> {
  const ids = unique(refs.goalIds);
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: goals.id, linkedAccountId: goals.linkedAccountId, debtAccountId: goals.debtAccountId })
    .from(goals)
    .where(and(eq(goals.householdId, householdId), inArray(goals.id, ids)))
    .orderBy(asc(goals.id))
    .for("share");
  if (found.length !== ids.length) throw invalidGoal();
  if (!actor) return;

  // A goal tied to an account the actor cannot see is not visible to the actor
  // (Rule 11): same error as an unknown goal, so existence does not leak.
  const accountIds = unique(
    found.flatMap((goal) => [goal.linkedAccountId, goal.debtAccountId])
      .filter((id): id is string => id !== null)
      .map((id) => id.toLowerCase()),
  );
  if (accountIds.length === 0) return;
  const visible = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), visibleAccountPredicate(actor)));
  if (visible.length !== accountIds.length) throw invalidGoal();
}

async function verifyMerchants(
  refs: EntityReferences,
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  const ids = unique(refs.merchantIds);
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: merchants.id })
    .from(merchants)
    .where(and(eq(merchants.householdId, householdId), inArray(merchants.id, ids)))
    .orderBy(asc(merchants.id))
    .for("key share");
  if (found.length !== ids.length) throw invalidMerchant();
}

/**
 * Save-time check: every authored owner/member/goal/merchant reference,
 * disabled actions included, must belong to this household and be visible to
 * the saver. Runs inside the authoring transaction.
 */
export async function validateRuleEntityReferenceSets(
  actionSets: readonly unknown[],
  actor: HouseholdContext,
  tx: TransactionType,
): Promise<void> {
  const refs = collectEntityReferences(actionSets, false);
  await verifyMembers(refs, actor.householdId, tx);
  await verifyGoals(refs, actor.householdId, tx, actor);
  await verifyMerchants(refs, actor.householdId, tx);
}

export async function validateRuleEntityReferences(
  actions: unknown,
  actor: HouseholdContext,
  tx: TransactionType,
): Promise<void> {
  return validateRuleEntityReferenceSets([actions], actor, tx);
}

/**
 * Apply-time re-check of the enabled actions: the owner or member must still be
 * a current member, the goal still in the household. Fails closed (the apply
 * aborts) instead of writing a stale id. The saver is not known here, so goal
 * visibility is not re-evaluated; household membership is. Uses the caller's
 * transaction when there is one, otherwise a short read transaction.
 */
export async function assertRuleActionReferencesCurrent(
  actions: unknown,
  householdId: string,
  tx?: TransactionType,
): Promise<void> {
  const refs = collectEntityReferences([actions], true);
  if (refs.ownerIds.length + refs.goalIds.length === 0) return;
  // Merchants are not re-checked here: planRuleActions already resolves them
  // inside the household and writes nothing for an unknown one.
  const run = async (executor: TransactionType) => {
    await verifyMembers(refs, householdId, executor);
    await verifyGoals(refs, householdId, executor);
  };
  if (tx) return run(tx);
  return withTransaction(run);
}
