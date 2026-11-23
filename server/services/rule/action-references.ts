/**
 * Apply-time household scope for the category and tag ids a rule's actions
 * name (ORG-003). Save and edit refuse foreign ids, but a legacy rule row can
 * still carry one. Before planning, every category id (categorize and split
 * categories) and tag id (add_tags) is resolved against the transaction's
 * household inside the caller's transaction; an id that does not resolve
 * blocks the action that names it.
 *
 * @module services/rule/action-references
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { categories, tags } from "@shared/schema";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import type { BlockedRuleReferences, RuleAction } from "./types";

const uuid = z.string().uuid();

/** Ids of this household's live categories and tags that the actions name. */
export type OwnedActionReferences = {
  categoryIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
};

const lower = (id: string): string => id.toLowerCase();
const validIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.filter((id) => uuid.safeParse(id).success).map(lower))).sort();

/** Tag ids an add_tags action names, exactly as the planner reads them. */
export function actionTagIds(action: RuleAction): string[] {
  const values = Array.isArray(action.value) ? action.value : [String(action.value)];
  return values.filter((id) => typeof id === "string" && id.trim() !== "");
}

/** Category ids a split_transaction action names (an uncategorized split names none). */
export function splitCategoryIds(action: RuleAction): string[] {
  return (action.splitConfig ?? []).flatMap((split) => (split.categoryId ? [split.categoryId] : []));
}

function collect(actions: readonly RuleAction[]): { categoryIds: string[]; tagIds: string[] } {
  const categoryIds: string[] = [];
  const tagIds: string[] = [];
  for (const action of actions) {
    if (action.type === "categorize") categoryIds.push(String(action.value));
    else if (action.type === "split_transaction") categoryIds.push(...splitCategoryIds(action));
    else if (action.type === "add_tags") tagIds.push(...actionTagIds(action));
  }
  return { categoryIds: validIds(categoryIds), tagIds: validIds(tagIds) };
}

async function resolve(
  actions: readonly RuleAction[],
  householdId: string,
  executor: TransactionType,
): Promise<OwnedActionReferences> {
  const wanted = collect(actions);
  // KEY SHARE keeps each resolved row from being deleted until the apply
  // commits, and stays compatible with the usage-count UPDATE the apply makes.
  const ownedCategories = wanted.categoryIds.length === 0 ? [] : await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), inArray(categories.id, wanted.categoryIds), isNull(categories.deletedAt)))
    .orderBy(asc(categories.id))
    .for("key share");
  const ownedTags = wanted.tagIds.length === 0 ? [] : await executor
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.householdId, householdId), inArray(tags.id, wanted.tagIds)))
    .orderBy(asc(tags.id))
    .for("key share");
  return {
    categoryIds: new Set(ownedCategories.map((row) => lower(row.id))),
    tagIds: new Set(ownedTags.map((row) => lower(row.id))),
  };
}

/**
 * Resolve the category and tag ids of the enabled actions in the household.
 * Real applies pass their transaction; previews get a short read transaction.
 */
export async function resolveOwnedActionReferences(
  actions: readonly RuleAction[],
  householdId: string,
  tx?: TransactionType,
): Promise<OwnedActionReferences> {
  if (tx) return resolve(actions, householdId, tx);
  return withTransaction((executor) => resolve(actions, householdId, executor));
}

/** The ids among `ids` that are not this household's, in first-seen order. */
export function unownedIds(ids: readonly string[], owned: ReadonlySet<string>): string[] {
  return Array.from(new Set(ids.filter((id) => !owned.has(lower(id)))));
}

/** Append newly blocked ids, keeping each list unique and in first-seen order. */
export function withBlocked(
  blocked: BlockedRuleReferences,
  added: Partial<BlockedRuleReferences>,
): BlockedRuleReferences {
  return {
    categoryIds: Array.from(new Set([...blocked.categoryIds, ...(added.categoryIds ?? [])])),
    tagIds: Array.from(new Set([...blocked.tagIds, ...(added.tagIds ?? [])])),
  };
}
