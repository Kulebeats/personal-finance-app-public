/**
 * R05.2 named household saved views (AH-13).
 *
 * Every role lists; owner and admin write ("household.policy.write", §A3).
 * Writes lock household -> acting membership -> view, recheck the role under
 * that lock (a stale middleware role never authorizes a committed write),
 * check the optimistic-lock version, and audit inside the same transaction.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { householdMembers, householdSavedViews, households, type HouseholdSavedView } from "@shared/schema";
import type { CreateSavedViewInput, SavedViewResponse, UpdateSavedViewInput } from "@shared/saved-views";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { ConflictError, ForbiddenError, NotFoundError } from "../../core/errors";
import { can } from "../../core/authz/capabilities";
import { businessAuditService } from "../../services/BusinessAuditService";
import { isPostgresError } from "../../utils/postgresError";
import { assertFilterReferences, toViewerViews } from "./saved-views.references";

const NAME_INDEX = "uq_household_saved_views_name";
const STALE_MESSAGE = "This saved view was changed by someone else. Reload it and try again.";

async function lockManager(tx: TransactionType, actor: HouseholdContext) {
  const [household] = await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, actor.householdId)).for("update");
  if (!household) throw new NotFoundError("Household not found");
  const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId)))
    .for("update");
  if (!membership || !can(membership.role, "household.policy.write")) {
    throw new ForbiddenError("Shared views can only be managed by an owner or admin");
  }
}

async function lockView(tx: TransactionType, actor: HouseholdContext, id: string, version: number) {
  const [view] = await tx.select().from(householdSavedViews)
    .where(and(eq(householdSavedViews.id, id), eq(householdSavedViews.householdId, actor.householdId)))
    .for("update");
  if (!view) throw new NotFoundError("Saved view not found");
  if (view.version !== version) throw new ConflictError(STALE_MESSAGE);
  return view;
}

/** The name index is the only unique constraint a view write can hit. */
async function uniqueName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPostgresError(error, "23505", NAME_INDEX)) throw new ConflictError("A saved view with this name already exists");
    throw error;
  }
}

const auditValue = (view: HouseholdSavedView) => ({ name: view.name, filter: view.filter, version: view.version });

async function viewFor(tx: TransactionType, actor: HouseholdContext, view: HouseholdSavedView) {
  const [response] = await toViewerViews(tx, actor, [view]);
  return response;
}

export const savedViewsService = {
  async list(actor: HouseholdContext): Promise<SavedViewResponse[]> {
    const rows = await db.select().from(householdSavedViews)
      .where(eq(householdSavedViews.householdId, actor.householdId))
      .orderBy(asc(sql`lower(${householdSavedViews.name})`), asc(householdSavedViews.createdAt));
    return toViewerViews(db, actor, rows);
  },

  async create(actor: HouseholdContext, input: CreateSavedViewInput, ipAddress?: string): Promise<SavedViewResponse> {
    return withTransaction(async (tx) => {
      await lockManager(tx, actor);
      await assertFilterReferences(tx, actor, input.filter);
      const [view] = await uniqueName(() => tx.insert(householdSavedViews).values({
        householdId: actor.householdId, name: input.name, filter: input.filter, createdBy: actor.userId,
      }).returning());
      await businessAuditService.logCreate({
        tx, userId: actor.userId, householdId: actor.householdId, entityType: "saved_view", entityId: view.id,
        newValue: auditValue(view), ipAddress,
      });
      return viewFor(tx, actor, view);
    });
  },

  async update(actor: HouseholdContext, id: string, input: UpdateSavedViewInput, ipAddress?: string): Promise<SavedViewResponse> {
    return withTransaction(async (tx) => {
      await lockManager(tx, actor);
      const current = await lockView(tx, actor, id, input.version);
      if (input.filter) await assertFilterReferences(tx, actor, input.filter);
      const [view] = await uniqueName(() => tx.update(householdSavedViews).set({
        name: input.name ?? current.name,
        filter: input.filter ?? current.filter,
        version: current.version + 1,
        updatedAt: new Date(),
      }).where(eq(householdSavedViews.id, current.id)).returning());
      await businessAuditService.logUpdate({
        tx, userId: actor.userId, householdId: actor.householdId, entityType: "saved_view", entityId: view.id,
        oldValue: auditValue(current), newValue: auditValue(view), ipAddress,
      });
      return viewFor(tx, actor, view);
    });
  },

  async remove(actor: HouseholdContext, id: string, version: number, ipAddress?: string): Promise<void> {
    await withTransaction(async (tx) => {
      await lockManager(tx, actor);
      const current = await lockView(tx, actor, id, version);
      await tx.delete(householdSavedViews).where(eq(householdSavedViews.id, current.id));
      await businessAuditService.logDelete({
        tx, userId: actor.userId, householdId: actor.householdId, entityType: "saved_view", entityId: current.id,
        oldValue: auditValue(current), ipAddress,
      });
    });
  },
};
