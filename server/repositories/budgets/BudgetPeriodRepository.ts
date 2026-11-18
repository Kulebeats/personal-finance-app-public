import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { budgetPeriods } from "@shared/schema";
import { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { ConflictError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";

export type BudgetPeriod = typeof budgetPeriods.$inferSelect;
export type InsertBudgetPeriod = typeof budgetPeriods.$inferInsert;

export class BudgetPeriodRepository {
  async findPeriod(
    budgetId: string,
    startDate: string,
    endDate: string,
    tx?: TransactionType,
    forUpdate: boolean = false,
  ): Promise<BudgetPeriod | undefined> {
    const queryRunner = tx || db;
    let query = queryRunner
      .select()
      .from(budgetPeriods)
      .where(
        and(
          eq(budgetPeriods.budgetId, budgetId),
          eq(budgetPeriods.startDate, startDate),
          eq(budgetPeriods.endDate, endDate),
        ),
      )
      .limit(1);

    if (forUpdate && tx) {
      query = query.for("update") as typeof query;
    }

    const [period] = await query;
    return period;
  }

  async upsertPeriod(
    data: InsertBudgetPeriod,
    tx?: TransactionType,
  ): Promise<BudgetPeriod> {
    const queryRunner = tx || db;
    const existing = await this.findPeriod(
      data.budgetId,
      data.startDate,
      data.endDate,
      tx,
      !!tx,
    );

    if (existing) {
      const [updated] = await queryRunner
        .update(budgetPeriods)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(budgetPeriods.id, existing.id))
        .returning();
      return updated;
    }

    try {
      const [period] = await queryRunner
        .insert(budgetPeriods)
        .values(data)
        .returning();
      return period;
    } catch (error: unknown) {
      if (isPostgresError(error, "23505")) {
        const retryExisting = await this.findPeriod(
          data.budgetId,
          data.startDate,
          data.endDate,
          tx,
          !!tx,
        );
        if (retryExisting) {
          const [updated] = await queryRunner
            .update(budgetPeriods)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(budgetPeriods.id, retryExisting.id))
            .returning();
          return updated;
        }
      }
      throw error;
    }
  }

  /**
   * Idempotently ensures a budget-period row exists for (budgetId, startDate,
   * endDate), seeded from `data.budgetAmount` if it needs to be created.
   *
   * BUDGET-RACE-002: Postgres does not support gap/next-key locking, so a
   * `SELECT ... FOR UPDATE` against a row that does not exist yet locks
   * nothing - it is a no-op "phantom read" that a concurrent transaction can
   * race straight past. Callers that need a real row lock (e.g. the
   * move-money path) MUST call this first, inside the same transaction, so
   * the subsequent `findPeriod(..., forUpdate: true)` locks a real row and
   * therefore genuinely serializes concurrent writers.
   */
  async ensurePeriodExists(
    data: InsertBudgetPeriod,
    tx: TransactionType,
  ): Promise<void> {
    await tx
      .insert(budgetPeriods)
      .values({ ...data, version: 1 })
      .onConflictDoNothing({
        target: [
          budgetPeriods.budgetId,
          budgetPeriods.startDate,
          budgetPeriods.endDate,
        ],
      });
  }

  async updatePeriodWithLock(
    id: string,
    expectedVersion: number,
    data: Partial<InsertBudgetPeriod>,
    tx?: TransactionType,
  ): Promise<BudgetPeriod | null> {
    const queryRunner = tx || db;
    const [updated] = await queryRunner
      .update(budgetPeriods)
      .set({
        ...data,
        version: sql`${budgetPeriods.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(budgetPeriods.id, id),
          eq(budgetPeriods.version, expectedVersion),
        ),
      )
      .returning();

    return updated || null;
  }

  async upsertPeriodWithLock(
    data: InsertBudgetPeriod,
    expectedVersion?: number,
    tx?: TransactionType,
  ): Promise<{ period: BudgetPeriod; conflict: boolean }> {
    const queryRunner = tx || db;
    const existing = await this.findPeriod(
      data.budgetId,
      data.startDate,
      data.endDate,
      tx,
    );

    if (existing) {
      if (expectedVersion !== undefined) {
        const updated = await this.updatePeriodWithLock(
          existing.id,
          expectedVersion,
          data,
          tx,
        );
        if (!updated) {
          return { period: existing, conflict: true };
        }
        return { period: updated, conflict: false };
      }

      const [updated] = await queryRunner
        .update(budgetPeriods)
        .set({
          ...data,
          version: sql`${budgetPeriods.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(budgetPeriods.id, existing.id))
        .returning();
      return { period: updated, conflict: false };
    }

    let period: BudgetPeriod;
    try {
      [period] = await queryRunner
        .insert(budgetPeriods)
        .values({ ...data, version: 1 })
        .returning();
    } catch (error: unknown) {
      if (isPostgresError(error, "23505")) {
        throw new ConflictError(
          "Budget period was modified by another request, please retry",
        );
      }
      throw error;
    }
    return { period, conflict: false };
  }

  async getBudgetPeriodsForRange(
    budgetIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<BudgetPeriod[]> {
    if (budgetIds.length === 0) return [];

    return await db
      .select()
      .from(budgetPeriods)
      .where(
        and(
          inArray(budgetPeriods.budgetId, budgetIds),
          gte(budgetPeriods.startDate, startDate),
          lte(budgetPeriods.startDate, endDate),
        ),
      );
  }
}

export const budgetPeriodRepository = new BudgetPeriodRepository();
