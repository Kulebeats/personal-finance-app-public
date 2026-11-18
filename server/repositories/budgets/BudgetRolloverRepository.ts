import { and, eq, inArray } from "drizzle-orm";
import { budgetPeriods } from "@shared/schema";
import type { Money } from "../../core/money";
import { logger } from "../../utils/logger";
import {
  withTransaction,
  type TransactionType,
} from "../../utils/withTransaction";
import type {
  BudgetPeriod,
  InsertBudgetPeriod,
} from "./BudgetPeriodRepository";

type BudgetProgressForRollover = {
  id: string;
  amount: string;
  spent: Money;
  rolloverIn: Money;
};

type UpsertBudgetPeriod = (
  data: InsertBudgetPeriod,
  tx: TransactionType,
) => Promise<BudgetPeriod>;

export class BudgetRolloverRepository {
  async persistBudgetPeriodRollovers(
    budgetProgresses: BudgetProgressForRollover[],
    startDate: string,
    endDate: string,
    upsertPeriod: UpsertBudgetPeriod,
  ): Promise<{ created: number; updated: number }> {
    const nonZeroProgresses = budgetProgresses.filter(
      (progress) => !progress.rolloverIn.isZero(),
    );

    if (nonZeroProgresses.length === 0) {
      return { created: 0, updated: 0 };
    }

    const budgetIds = nonZeroProgresses.map((progress) => progress.id);

    // One transaction for the whole batch: a rollover snapshot is only
    // trustworthy if every period row landed, so any failure rolls the
    // batch back loudly instead of silently dropping rejected upserts.
    return await withTransaction(async (tx) => {
      const existingPeriods = await tx
        .select()
        .from(budgetPeriods)
        .where(
          and(
            inArray(budgetPeriods.budgetId, budgetIds),
            eq(budgetPeriods.startDate, startDate),
            eq(budgetPeriods.endDate, endDate),
          ),
        );

      const existingMap = new Map(
        existingPeriods.map((period) => [period.budgetId, period]),
      );

      let created = 0;
      let updated = 0;

      for (const progress of nonZeroProgresses) {
        try {
          await upsertPeriod(
            {
              budgetId: progress.id,
              startDate,
              endDate,
              budgetAmount: progress.amount,
              spentAmount: progress.spent.toString(),
              rolloverIn: progress.rolloverIn.toString(),
            },
            tx,
          );
        } catch (error) {
          logger.error(
            "Budget rollover persistence failed; rolling back batch",
            { budgetId: progress.id, startDate, endDate, error },
          );
          throw error;
        }

        if (existingMap.has(progress.id)) {
          updated += 1;
        } else {
          created += 1;
        }
      }

      return { created, updated };
    });
  }
}

export const budgetRolloverRepository = new BudgetRolloverRepository();
