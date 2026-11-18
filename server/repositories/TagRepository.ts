import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { tags, transactionTags, transactions, type Tag } from "@shared/schema";
import { withTransaction, type TransactionType } from "../utils/withTransaction";

type CreateTagInput = {
  householdId: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific?: boolean;
  memberId?: string | null;
};

type UpdateTagInput = {
  name?: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific?: boolean;
  memberId?: string | null;
  isArchived?: boolean; // FUNC-002: Archive support
};

export class TagRepository {
  /**
   * Find all tags for a household with optional search filtering
   * P3: Backend tag search filtering
   * FUNC-002: Excludes archived tags by default
   */
  async findByHousehold(
    householdId: string,
    options?: { search?: string; limit?: number; includeArchived?: boolean }
  ): Promise<Tag[]> {
    const conditions = [eq(tags.householdId, householdId)];

    // Exclude archived tags by default
    if (!options?.includeArchived) {
      conditions.push(eq(tags.isArchived, false));
    }

    // Add case-insensitive search filter if provided
    if (options?.search) {
      conditions.push(
        sql`LOWER(${tags.name}) LIKE LOWER(${"%" + options.search + "%"})`
      );
    }

    let query = db
      .select()
      .from(tags)
      .where(and(...conditions))
      .orderBy(tags.name);

    // Apply limit if provided
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return await query;
  }

  async findById(
    id: string,
    householdId: string
  ): Promise<Tag | undefined> {
    const result = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .limit(1);
    return result[0];
  }

  /**
   * Find multiple tags by IDs (batch operation for performance)
   * Returns only tags that belong to the household
   */
  async findByIds(
    ids: string[],
    householdId: string
  ): Promise<Tag[]> {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(tags)
      .where(and(inArray(tags.id, ids), eq(tags.householdId, householdId)));
  }

  async findByName(
    householdId: string,
    name: string
  ): Promise<Tag | undefined> {
    const result = await db
      .select()
      .from(tags)
      .where(and(eq(tags.householdId, householdId), eq(tags.name, name)))
      .limit(1);
    return result[0];
  }

  async create(data: CreateTagInput): Promise<Tag> {
    const result = await db.insert(tags).values(data).returning();
    return result[0];
  }

  async update(
    id: string,
    householdId: string,
    data: UpdateTagInput
  ): Promise<Tag | undefined> {
    const result = await db
      .update(tags)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .returning();
    return result[0];
  }

  async delete(id: string, householdId: string): Promise<Tag | undefined> {
    const result = await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Link a tag to a transaction idempotently.
   *
   * Returns the link row plus an `inserted` flag that is true ONLY when this
   * call actually added a new row. Callers must gate usage-count increments on
   * `inserted`; otherwise re-tagging an already-tagged transaction inflates the
   * usage count that merge and analytics depend on (SCP-335).
   */
  async addTagToTransaction(
    transactionId: string,
    tagId: string,
    tx?: TransactionType
  ): Promise<{ link: typeof transactionTags.$inferSelect; inserted: boolean }> {
    const executor = tx ?? db;
    // TAGS-RACE-001: Use onConflict to handle race conditions atomically
    // Instead of check-then-insert (race condition), use insert with conflict handling
    const result = await executor
      .insert(transactionTags)
      .values({ transactionId, tagId })
      .onConflictDoNothing() // PostgreSQL handles duplicate prevention atomically
      .returning();

    // If insert was skipped due to conflict, fetch the existing row.
    if (result.length === 0) {
      const [existing] = await executor
        .select()
        .from(transactionTags)
        .where(
          and(
            eq(transactionTags.transactionId, transactionId),
            eq(transactionTags.tagId, tagId)
          )
        )
        .limit(1);
      return { link: existing, inserted: false };
    }

    return { link: result[0], inserted: true };
  }

  async removeTagFromTransaction(transactionId: string, tagId: string) {
    const result = await db
      .delete(transactionTags)
      .where(
        and(
          eq(transactionTags.transactionId, transactionId),
          eq(transactionTags.tagId, tagId)
        )
      )
      .returning();
    return result[0];
  }

  async getTransactionTags(transactionId: string) {
    return await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        icon: tags.icon,
      })
      .from(transactionTags)
      .innerJoin(tags, eq(transactionTags.tagId, tags.id))
      .where(eq(transactionTags.transactionId, transactionId));
  }

  /**
   * Replace the full tag set on a transaction.
   *
   * SCP-335: the delete-then-insert must be atomic — wrap it in a transaction
   * so a failure between the delete and the insert cannot leave the
   * transaction with no tags (or a partial set).
   */
  async setTransactionTags(transactionId: string, tagIds: string[]) {
    await withTransaction(async (tx) => {
      await tx
        .delete(transactionTags)
        .where(eq(transactionTags.transactionId, transactionId));

      if (tagIds.length > 0) {
        await tx.insert(transactionTags).values(
          tagIds.map((tagId) => ({ transactionId, tagId }))
        );
      }
    });

    return await this.getTransactionTags(transactionId);
  }

  async incrementUsageCount(
    tagId: string,
    tx?: TransactionType
  ): Promise<void> {
    await (tx ?? db)
      .update(tags)
      .set({ usageCount: sql`${tags.usageCount} + 1` })
      .where(eq(tags.id, tagId));
  }

  async decrementUsageCount(tagId: string): Promise<void> {
    await db
      .update(tags)
      .set({ usageCount: sql`GREATEST(${tags.usageCount} - 1, 0)` })
      .where(eq(tags.id, tagId));
  }

  async findTransactionsByTag(
    tagId: string,
    householdId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ) {
    const visibleTaggedTransactionsWhere = and(
      eq(transactionTags.tagId, tagId),
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, userId))
    );

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactionTags)
      .innerJoin(transactions, eq(transactionTags.transactionId, transactions.id))
      .where(visibleTaggedTransactionsWhere);

    const visibleTransactions = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        name: transactions.name,
        amount: transactions.amount,
        type: transactions.type,
      })
      .from(transactionTags)
      .innerJoin(transactions, eq(transactionTags.transactionId, transactions.id))
      .where(visibleTaggedTransactionsWhere)
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(limit)
      .offset(offset);

    return {
      transactions: visibleTransactions,
      count: Number(countRow?.count ?? 0),
    };
  }
}

export const tagRepository = new TagRepository();
