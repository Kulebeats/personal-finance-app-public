/**
 * R05.2 saved views: what a view may refer to, and what each viewer sees of it.
 *
 * Only accounts carry privacy, so the account is the one reference that can
 * leak. A view may name only a shared account (writer side), and a viewer who
 * cannot see a named account never receives its id (reader side; the account
 * may have become private after the view was saved).
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { accounts, categories, tags, type HouseholdSavedView } from "@shared/schema";
import { savedViewFilterSchema, type SavedViewFilter, type SavedViewResponse } from "@shared/saved-views";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { NotFoundError, ValidationError } from "../../core/errors";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { logger } from "../../utils/logger";

type Executor = typeof db | TransactionType;

/** R04.3 reference revalidation for every id in a filter, against the writer's household. */
export async function assertFilterReferences(tx: TransactionType, actor: HouseholdContext, filter: SavedViewFilter) {
  if (filter.accountId) {
    const [account] = await tx.select({ isPrivate: accounts.isPrivate, ownerUserId: accounts.ownerUserId })
      .from(accounts)
      .where(and(eq(accounts.id, filter.accountId), eq(accounts.householdId, actor.householdId), isNull(accounts.deletedAt)));
    if (!account || (account.isPrivate && account.ownerUserId !== actor.userId)) throw new NotFoundError("Account not found");
    if (account.isPrivate) {
      throw new ValidationError("A shared view can only use a shared account", [
        { field: "filter.accountId", message: "Choose an account every member can see" },
      ]);
    }
  }
  const householdOrSystem = (column: typeof categories.householdId | typeof tags.householdId) =>
    or(eq(column, actor.householdId), isNull(column));
  if (filter.categoryId) {
    const [category] = await tx.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, filter.categoryId), householdOrSystem(categories.householdId)));
    if (!category) throw new NotFoundError("Category not found");
  }
  if (filter.tagIds) {
    const wanted = [...new Set(filter.tagIds)];
    const found = await tx.select({ id: tags.id }).from(tags)
      .where(and(inArray(tags.id, wanted), householdOrSystem(tags.householdId)));
    if (found.length !== wanted.length) throw new NotFoundError("Tag not found");
  }
}

/** Never throws: one unreadable stored filter must not take down the household's whole list. */
function readStoredFilter(stored: unknown) {
  try {
    return savedViewFilterSchema.safeParse(stored);
  } catch {
    return { success: false as const };
  }
}

/** Each view as this viewer may see it; an unreadable stored filter fails closed (restricted, empty). */
export async function toViewerViews(
  executor: Executor, actor: HouseholdContext, rows: HouseholdSavedView[],
): Promise<SavedViewResponse[]> {
  const parsed = rows.map((row) => ({ row, result: readStoredFilter(row.filter) }));
  const accountIds = [...new Set(parsed.flatMap(({ result }) => (result.success && result.data.accountId ? [result.data.accountId] : [])))];
  const visible = new Set(accountIds.length === 0 ? [] : (await executor.select({ id: accounts.id }).from(accounts)
    .where(and(inArray(accounts.id, accountIds), visibleAccountPredicate(actor)))).map(({ id }) => id));

  return parsed.map(({ row, result }) => {
    if (!result.success) logger.warn("Saved view has an unreadable filter", { savedViewId: row.id });
    const stored = result.success ? result.data : {};
    const hidden = !result.success || (!!stored.accountId && !visible.has(stored.accountId));
    const { accountId, ...rest } = stored;
    return {
      id: row.id,
      name: row.name,
      filter: hidden ? rest : { ...rest, ...(accountId ? { accountId } : {}) },
      restricted: hidden,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  });
}
