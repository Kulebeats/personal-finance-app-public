import { and, eq } from "drizzle-orm";
import {
  householdMembers,
  householdPreferences,
  households,
  type HouseholdPreferences,
} from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { ForbiddenError, NotFoundError } from "../errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { can } from "./capabilities";

type HouseholdPolicyPatch = Partial<Pick<HouseholdPreferences,
  "showPendingTransactions" | "allowEditPending" | "autoRolloverBudget"
>>;

/**
 * Household -> acting membership -> policy. The household anchor also orders
 * missing-row creation against erasure; membership writers conflict on the
 * actor row, so a stale middleware role never authorizes a committed write.
 */
export async function updateHouseholdPolicy(
  actor: HouseholdContext,
  data: HouseholdPolicyPatch,
  ipAddress?: string,
) {
  return withTransaction(async (tx) => {
    const [household] = await tx
      .select({ id: households.id }).from(households)
      .where(eq(households.id, actor.householdId))
      .for("update");
    if (!household) throw new NotFoundError("Household not found");

    const [membership] = await tx
      .select({ role: householdMembers.role }).from(householdMembers)
      .where(and(
        eq(householdMembers.householdId, actor.householdId),
        eq(householdMembers.userId, actor.userId),
      ))
      .for("update");
    if (!membership || !can(membership.role, "household.policy.write")) {
      throw new ForbiddenError("Household policy requires owner or admin access");
    }

    let [previous] = await tx.select().from(householdPreferences)
      .where(eq(householdPreferences.householdId, actor.householdId)).for("update");
    let created = false;
    if (!previous) {
      const inserted = await tx.insert(householdPreferences).values({ householdId: actor.householdId })
        .onConflictDoNothing().returning();
      created = inserted.length > 0;
      // A legacy writer may not use the household anchor. Lock and capture its
      // committed policy too, rather than reporting an invented empty old value.
      if (!created) [previous] = await tx.select().from(householdPreferences)
        .where(eq(householdPreferences.householdId, actor.householdId)).for("update");
    }
    const [updated] = await tx.update(householdPreferences).set({
      showPendingTransactions: data.showPendingTransactions,
      allowEditPending: data.allowEditPending,
      autoRolloverBudget: data.autoRolloverBudget,
      updatedAt: new Date(),
    })
      .where(eq(householdPreferences.householdId, actor.householdId)).returning();
    await businessAuditService.logUpdate({
      tx,
      householdId: actor.householdId,
      userId: actor.userId,
      entityType: "household_preferences",
      entityId: actor.householdId,
      oldValue: previous,
      newValue: updated,
      ipAddress,
      metadata: created ? { oldValue: null } : undefined,
    });
    return updated;
  });
}
