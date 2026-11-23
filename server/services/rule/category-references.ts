import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { categories, categoryGroups } from "@shared/schema";
import { ValidationError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

const uuid = z.string().uuid();
const invalidCategoryReference = () => new ValidationError("Invalid rule category reference");

/** Validate authored category references, including disabled actions and stored merged actions. */
export async function validateRuleCategoryReferenceSets(
  actionSets: readonly unknown[],
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  const ids: string[] = [];
  for (const actions of actionSets) {
    if (!Array.isArray(actions)) throw invalidCategoryReference();
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const candidate = action as { type?: unknown; value?: unknown; splitConfig?: unknown };
      if (candidate.type === "categorize") {
        if (typeof candidate.value !== "string" || !uuid.safeParse(candidate.value).success) {
          throw invalidCategoryReference();
        }
        ids.push(candidate.value.toLowerCase());
      } else if (candidate.type === "split_transaction" && candidate.splitConfig != null) {
        if (!Array.isArray(candidate.splitConfig)) throw invalidCategoryReference();
        for (const split of candidate.splitConfig) {
          if (!split || typeof split !== "object") throw invalidCategoryReference();
          const categoryId = (split as { categoryId?: unknown }).categoryId;
          if (categoryId == null) continue; // An uncategorized split has no category reference.
          if (typeof categoryId !== "string" || !uuid.safeParse(categoryId).success) {
            throw invalidCategoryReference();
          }
          ids.push(categoryId.toLowerCase());
        }
      }
    }
  }

  const uniqueIds = Array.from(new Set(ids)).sort();
  if (uniqueIds.length === 0) return;

  // Category updates may change groupId or deletedAt. SHARE keeps those fields
  // stable through the authoring write; ordinary category editors do not move
  // householdId. Rows are locked in UUID order for single and bulk authoring.
  const owned = await tx
    .select({ id: categories.id, groupId: categories.groupId, deletedAt: categories.deletedAt })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), inArray(categories.id, uniqueIds)))
    .orderBy(asc(categories.id))
    .for("share");
  if (owned.length !== uniqueIds.length || owned.some((category) => category.deletedAt !== null)) {
    throw invalidCategoryReference();
  }

  // groupId is nullable in the persisted schema and the normal category reader
  // accepts ungrouped household categories. A supplied group must belong to the
  // same household; nullable-household rows carry no global entitlement here.
  const groupIds = Array.from(new Set(owned.map((category) => category.groupId).filter((id): id is string => id !== null))).sort();
  if (groupIds.length === 0) return;
  const groups = await tx
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(and(eq(categoryGroups.householdId, householdId), inArray(categoryGroups.id, groupIds)))
    .orderBy(asc(categoryGroups.id))
    .for("key share");
  if (groups.length !== groupIds.length) throw invalidCategoryReference();
}

export async function validateRuleCategoryReferences(
  actions: unknown,
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  return validateRuleCategoryReferenceSets([actions], householdId, tx);
}
