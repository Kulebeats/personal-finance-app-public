import { db } from "../db";
import {
  recurringTransactions,
  type RecurringTransaction,
  type RecurringTransactionHistory,
  type RecurringTransactionLink,
  type InsertRecurringTransaction,
  type InsertRecurringTransactionHistory,
  type InsertRecurringTransactionLink,
} from "@shared/schema";
import { eq, and, gte, isNull, lte, or } from "drizzle-orm";
import { shiftCalendarDate } from "@shared/household-calendar";
import { calculateNextDate } from "../core/calculations";
import type {
  Frequency,
  IntervalUnit,
  RecurrenceOptions,
} from "../core/calculations/recurring/types";
import type { TransactionType } from "../utils/withTransaction";
import { recurringQueryRepository } from "./RecurringQueryRepository";
import { householdToday } from "../services/householdCalendarToday";

/**
 * R14: the rule has not reached its inclusive end date. Its end date is still
 * today or later, and its next occurrence is not after that end date. Shared
 * by upcoming, the list and the forecast so none of them shows an occurrence
 * past the end (services/recurring/RecurringLifecycleRules.ts).
 */
export function ruleNotEndedPredicate(today: string) {
  return or(
    isNull(recurringTransactions.endDate),
    and(gte(recurringTransactions.endDate, today), lte(recurringTransactions.nextDueDate, recurringTransactions.endDate)),
  )!;
}

/** Date window shared by the bill list and its summary count, including overdue bills. */
export function upcomingDatePredicate(today: string, withinDays: number) {
  const through = shiftCalendarDate(today, withinDays);
  return and(
    lte(recurringTransactions.nextDueDate, through),
    ruleNotEndedPredicate(today),
  )!;
}

/**
 * RecurringRepository
 *
 * Data access layer for recurring transaction rules.
 * Supports:
 * - CRUD for recurring rules
 * - Finding due transactions
 * - Next date calculation
 *
 * Link, history, and summary operations are delegated to RecurringQueryRepository.
 */
export class RecurringRepository {
  /**
   * Find all recurring rules for a household
   */
  async findByHousehold(
    householdId: string,
    options?: { includeInactive?: boolean; includePaused?: boolean },
  ): Promise<RecurringTransaction[]> {
    const results = await db
      .select()
      .from(recurringTransactions)
      .where(eq(recurringTransactions.householdId, householdId))
      .orderBy(recurringTransactions.nextDueDate);

    return results.filter((r) => {
      if (!options?.includeInactive && !r.isActive) return false;
      if (!options?.includePaused && r.isPaused) return false;
      return true;
    });
  }

  /**
   * Find a recurring rule by ID
   */
  async findById(
    id: string,
    householdId: string,
    tx?: TransactionType,
  ): Promise<RecurringTransaction | undefined> {
    const [rule] = await (tx ?? db)
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.householdId, householdId),
        ),
      )
      .limit(1);

    return rule;
  }

  /**
   * Find a recurring rule by ID and lock the row FOR UPDATE.
   *
   * Used by the materialization path (Rule 10) to serialize concurrent/retried
   * cron runs on the same rule: the caller locks the row, re-checks due-ness
   * INSIDE the transaction, then materializes exactly once. MUST be called with
   * an active transaction — a lock outside a transaction is released immediately.
   */
  async findByIdForUpdate(
    id: string,
    householdId: string,
    tx: TransactionType,
  ): Promise<RecurringTransaction | undefined> {
    const [rule] = await tx
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.householdId, householdId),
        ),
      )
      .for("update")
      .limit(1);

    return rule;
  }

  /**
   * Find rules that are due by a specific date
   */
  async findDue(
    householdId: string,
    byDate: string,
  ): Promise<RecurringTransaction[]> {
    const results = await db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.householdId, householdId),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.isPaused, false),
          lte(recurringTransactions.nextDueDate, byDate),
        ),
      )
      .orderBy(recurringTransactions.nextDueDate);

    // A-12: the inclusive end date bounds the occurrence, not the run date, so an
    // occurrence on endDate still posts when the run comes a day or more late.
    return results.filter((r) => !(r.endDate && r.endDate < r.nextDueDate));
  }

  /**
   * Find upcoming bills within days
   */
  async findUpcoming(
    householdId: string,
    withinDays: number = 14,
  ): Promise<RecurringTransaction[]> {
    const today = await householdToday(db, householdId);
    return db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.householdId, householdId),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.isPaused, false),
          upcomingDatePredicate(today, withinDays),
        ),
      )
      .orderBy(recurringTransactions.nextDueDate);

  }

  /**
   * Create a new recurring rule
   */
  async create(
    data: InsertRecurringTransaction,
  ): Promise<RecurringTransaction> {
    const [rule] = await db
      .insert(recurringTransactions)
      .values(data)
      .returning();
    return rule;
  }

  /**
   * Update a recurring rule
   */
  async update(
    id: string,
    householdId: string,
    data: Partial<RecurringTransaction>,
    tx?: TransactionType,
  ): Promise<RecurringTransaction | undefined> {
    const [rule] = await (tx ?? db)
      .update(recurringTransactions)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.householdId, householdId),
        ),
      )
      .returning();

    return rule;
  }

  /**
   * Delete a recurring rule
   */
  async delete(id: string, householdId: string): Promise<boolean> {
    const result = await db
      .delete(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.householdId, householdId),
        ),
      )
      .returning({ id: recurringTransactions.id });

    return result.length > 0;
  }

  /**
   * Update next due date after processing
   */
  async updateNextDueDate(
    id: string,
    nextDueDate: string,
  ): Promise<RecurringTransaction | undefined> {
    const [rule] = await db
      .update(recurringTransactions)
      .set({ nextDueDate, updatedAt: new Date() })
      .where(eq(recurringTransactions.id, id))
      .returning();

    return rule;
  }

  calculateNextDate(
    currentDate: string,
    frequency: Frequency,
    options?: RecurrenceOptions,
  ): string {
    return calculateNextDate(currentDate, frequency, options);
  }

  /**
   * Pause a recurring rule
   */
  async pause(
    id: string,
    householdId: string,
  ): Promise<RecurringTransaction | undefined> {
    return this.update(id, householdId, { isPaused: true });
  }

  /**
   * Resume a recurring rule
   */
  async resume(
    id: string,
    householdId: string,
  ): Promise<RecurringTransaction | undefined> {
    return this.update(id, householdId, { isPaused: false });
  }

  /**
   * Skip next occurrence (advance next due date)
   */
  async skipNext(
    id: string,
    householdId: string,
  ): Promise<RecurringTransaction | undefined> {
    const rule = await this.findById(id, householdId);
    if (!rule) return undefined;

    return this.updateNextDueDate(id, this.nextDateAfter(rule));
  }

  nextDateAfter(rule: RecurringTransaction): string {
    return this.calculateNextDate(
      rule.nextDueDate,
      rule.frequency as Frequency,
      {
        dayOfMonth: rule.dayOfMonth || undefined,
        dayOfWeek: rule.dayOfWeek ?? undefined,
        intervalValue: rule.intervalValue ?? undefined,
        intervalUnit: (rule.intervalUnit as IntervalUnit | null) ?? undefined,
      },
    );
  }

  // ====================================================================
  // Delegated methods (for backward compatibility)
  // These delegate to RecurringQueryRepository for link/history/summary
  // ====================================================================

  /**
   * Create a link between a transaction and recurring rule
   * @delegate RecurringQueryRepository
   */
  async createLink(
    data: InsertRecurringTransactionLink,
    tx?: TransactionType,
  ): Promise<RecurringTransactionLink> {
    return recurringQueryRepository.createLink(data, tx);
  }

  /**
   * Find links for a recurring rule within a household
   * @delegate RecurringQueryRepository
   */
  async findLinksByRecurring(
    recurringId: string,
    householdId: string,
  ): Promise<RecurringTransactionLink[]> {
    return recurringQueryRepository.findLinksByRecurring(recurringId, householdId);
  }

  /**
   * Find a link by transaction within a household
   * @delegate RecurringQueryRepository
   */
  async findLinkByTransaction(
    transactionId: string,
    householdId: string,
    tx?: TransactionType,
  ): Promise<RecurringTransactionLink | undefined> {
    return recurringQueryRepository.findLinkByTransaction(transactionId, householdId, tx);
  }

  /**
   * Delete a link by id with household validation
   * @delegate RecurringQueryRepository
   */
  async deleteLink(
    linkId: string,
    householdId: string,
  ): Promise<
    | {
        id: string;
        transactionId: string;
        recurringTransactionId: string;
      }
    | undefined
  > {
    return recurringQueryRepository.deleteLink(linkId, householdId);
  }

  /**
   * Log a recurring history event
   * @delegate RecurringQueryRepository
   */
  async logHistory(
    data: InsertRecurringTransactionHistory,
    tx?: TransactionType,
  ): Promise<RecurringTransactionHistory> {
    return recurringQueryRepository.logHistory(data, tx);
  }

  /**
   * Find history entries for a recurring rule
   * @delegate RecurringQueryRepository
   */
  async findHistory(
    recurringId: string,
    householdId: string,
    limit: number = 50,
  ): Promise<RecurringTransactionHistory[]> {
    return recurringQueryRepository.findHistory(recurringId, householdId, limit);
  }

}

// Export singleton instance
export const recurringRepository = new RecurringRepository();
