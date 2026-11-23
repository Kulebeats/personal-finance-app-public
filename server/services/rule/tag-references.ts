import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tags } from "@shared/schema";
import { ValidationError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

const uuid = z.string().uuid();
const invalidTagReference = () => new ValidationError("Invalid rule tag reference");

/** Validate all authored add_tags references, including disabled actions. */
export async function validateRuleTagReferenceSets(
  actionSets: readonly unknown[],
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  const ids: string[] = [];
  for (const actions of actionSets) {
    if (!Array.isArray(actions)) throw invalidTagReference();
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const candidate = action as { type?: unknown; value?: unknown };
      if (candidate.type !== "add_tags") continue;
      const values = typeof candidate.value === "string" ? [candidate.value] : candidate.value;
      if (!Array.isArray(values) || values.length === 0) throw invalidTagReference();
      for (const value of values) {
        if (typeof value !== "string" || !uuid.safeParse(value).success) throw invalidTagReference();
        ids.push(value.toLowerCase());
      }
    }
  }

  const uniqueIds = Array.from(new Set(ids)).sort();
  if (uniqueIds.length === 0) return;

  // Application tag writers cannot change householdId. FOR KEY SHARE blocks
  // delete/key replacement while remaining compatible with legacy usage-count
  // UPDATEs, whose tag order is not guaranteed to match this lookup.
  const owned = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.householdId, householdId), inArray(tags.id, uniqueIds)))
    .orderBy(asc(tags.id))
    .for("key share");
  if (owned.length !== uniqueIds.length) throw invalidTagReference();
}

export async function validateRuleTagReferences(
  actions: unknown,
  householdId: string,
  tx: TransactionType,
): Promise<void> {
  return validateRuleTagReferenceSets([actions], householdId, tx);
}
