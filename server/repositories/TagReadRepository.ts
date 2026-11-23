import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { householdMembers, tags, transactionTags, transactions, type Tag } from "@shared/schema";
import { db } from "../db";
import type { HouseholdContext } from "../middleware/householdGuard";
import type { TransactionType } from "../utils/withTransaction";
import { ForbiddenError, NotFoundError } from "../core/errors";
import { can } from "../core/authz/capabilities";
import { visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { couponCashDescriptionFields } from "../services/grz/couponCashDescription";

type Executor = typeof db | TransactionType;
export type TagListOptions = { search?: string; limit?: number };

function visibleUsage(actor: HouseholdContext) {
  return sql<number>`(select count(*)::int from ${transactionTags}
    inner join ${transactions} on ${eq(transactions.id, transactionTags.transactionId)}
    where ${and(eq(transactionTags.tagId, tags.id), visibleTransactionPredicate(actor))})`.mapWith(Number);
}

function tagDto(row: Tag, usageCount: number) {
  return {
    id: row.id, householdId: row.householdId, name: row.name, color: row.color,
    icon: row.icon, memberSpecific: row.memberSpecific, memberId: row.memberId,
    isArchived: row.isArchived, createdAt: row.createdAt, updatedAt: row.updatedAt,
    usageCount,
  };
}

function selection(actor: HouseholdContext) {
  return {
    id: tags.id, householdId: tags.householdId, name: tags.name, color: tags.color,
    icon: tags.icon, memberSpecific: tags.memberSpecific, memberId: tags.memberId,
    isArchived: tags.isArchived, createdAt: tags.createdAt, updatedAt: tags.updatedAt,
    usageCount: visibleUsage(actor),
  };
}

class TagReadRepository {
  private async read<T>(actor: HouseholdContext, operation: (tx: TransactionType) => Promise<T>) {
    if (!actor || !can(actor.role, "financial.read")) throw new ForbiddenError("Financial read access required");
    return db.transaction(async (tx) => {
      const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId)));
      if (!member || !can(member.role, "financial.read")) throw new ForbiddenError("Household access required");
      return operation(tx);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async list(actor: HouseholdContext, options: TagListOptions = {}) {
    return this.read(actor, async (tx) => {
      const conditions = [eq(tags.householdId, actor.householdId), eq(tags.isArchived, false)];
      if (options.search) conditions.push(sql`lower(${tags.name}) like lower(${`%${options.search}%`})`);
      const query = tx.select(selection(actor)).from(tags).where(and(...conditions)).orderBy(asc(tags.name), asc(tags.id));
      return options.limit === undefined ? query : query.limit(options.limit);
    });
  }

  private async tag(tx: TransactionType, actor: HouseholdContext, id: string) {
    // Direct detail/archive outcomes historically include archived household tags.
    const [tag] = await tx.select(selection(actor)).from(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, actor.householdId)));
    if (!tag) throw new NotFoundError("Tag not found");
    return tag;
  }

  async get(actor: HouseholdContext, id: string) {
    return this.read(actor, (tx) => this.tag(tx, actor, id));
  }

  async page(actor: HouseholdContext, id: string, limit: number, offset: number) {
    return this.read(actor, async (tx) => {
      const tag = await this.tag(tx, actor, id);
      const rows = await tx.select({ id: transactions.id, date: transactions.date, name: couponCashDescriptionFields().name, amount: transactions.amount, type: transactions.type })
        .from(transactionTags).innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
        .innerJoin(tags, eq(tags.id, transactionTags.tagId))
        .where(and(eq(tags.id, id), eq(tags.householdId, actor.householdId), visibleTransactionPredicate(actor)))
        .orderBy(desc(transactions.date), desc(transactions.id)).limit(limit).offset(offset);
      return { tag, transactions: rows, count: tag.usageCount };
    });
  }

  private async hydrate(executor: Executor, actor: HouseholdContext, transactionId: string) {
    return executor.select({ id: tags.id, name: tags.name, color: tags.color, icon: tags.icon })
      .from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
      .where(and(eq(transactions.id, transactionId), eq(tags.householdId, actor.householdId), visibleTransactionPredicate(actor)))
      .orderBy(asc(tags.name), asc(tags.id));
  }

  async transactionTags(actor: HouseholdContext, id: string) {
    return this.read(actor, async (tx) => {
      const [transaction] = await tx.select({ id: transactions.id }).from(transactions)
        .where(and(eq(transactions.id, id), visibleTransactionPredicate(actor)));
      if (!transaction) throw new NotFoundError("Transaction not found");
      return this.hydrate(tx, actor, id);
    });
  }

  /** Response only: admission already happened. Never reject a committed write for lost membership. */
  async mutationTags(actor: HouseholdContext, rows: Tag[]) {
    if (rows.length === 0) return [];
    const counts = await db.select({ id: tags.id, usageCount: visibleUsage(actor) }).from(tags)
      .where(and(eq(tags.householdId, actor.householdId), inArray(tags.id, rows.map((row) => row.id))));
    const byId = new Map(counts.map((row) => [row.id, row.usageCount]));
    return rows.map((row) => tagDto(row, byId.get(row.id) ?? 0));
  }

  /** Separate from internal currentTagIds/counter bookkeeping in TagRepository. */
  async mutationTransactionTags(actor: HouseholdContext, id: string) {
    return this.hydrate(db, actor, id);
  }
}

export const tagReadRepository = new TagReadRepository();
