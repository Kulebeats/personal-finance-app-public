import { and, eq } from "drizzle-orm";
import { budgetPeriods, budgets } from "@shared/schema";
import type { Money } from "../../core/money";
import { readBudgetMoney } from "../../core/money/budget-denomination";
import { ConflictError, NotFoundError } from "../../core/errors";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";

type BudgetProgressForRollover = { id: string; amount: string; spent: Money; rolloverIn: Money };

/** Housekeeping may refresh shared spend/carry, never a user's manual limit,
 * denomination or optimistic version. Parent locks also serialize absent rows.
 * Every period it creates or updates is audited as a system write in the same
 * transaction (NEW-32), so a failed audit rolls the whole batch back. */
const ROLLOVER_AUDIT = { source: "budget_rollover" } as const;
export class BudgetRolloverRepository {
  async persistBudgetPeriodRollovers(progresses: BudgetProgressForRollover[], startDate: string, endDate: string,
    options: { refreshZero?: boolean } = {}): Promise<{ created: number; updated: number }> {
    const selected = progresses.filter(row => !row.rolloverIn.isZero() || options.refreshZero).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!selected.length) return { created: 0, updated: 0 };
    return withTransaction(async tx => {
      let created = 0, updated = 0;
      for (const progress of selected) {
        const [budget] = await tx.select().from(budgets).where(eq(budgets.id, progress.id)).for("update");
        if (!budget) throw new NotFoundError("Budget not found");
        const denomination = progress.spent.currency;
        if (progress.rolloverIn.currency !== denomination) throw new ConflictError("Budget denomination changed during rollover");
        let [period] = await tx.select().from(budgetPeriods).where(and(eq(budgetPeriods.budgetId, progress.id),
          eq(budgetPeriods.startDate, startDate), eq(budgetPeriods.endDate, endDate))).for("update");
        if (!period) {
          if (progress.rolloverIn.isZero()) continue;
          if (budget.amount === null) throw new ConflictError("Monthly budget limit changed during rollover");
          const limit = readBudgetMoney(budget.amount, budget.currency, denomination);
          const inserted = await tx.insert(budgetPeriods).values({ budgetId: progress.id, startDate, endDate,
            budgetAmount: limit.toString(), currency: denomination, spentAmount: progress.spent.toString(),
            rolloverIn: progress.rolloverIn.toString(), version: 1 })
            .onConflictDoNothing({ target: [budgetPeriods.budgetId, budgetPeriods.startDate, budgetPeriods.endDate] }).returning();
          if (inserted.length) {
            await businessAuditService.logCreate({ tx, userId: null, householdId: budget.householdId, entityType: "budget_period",
              entityId: inserted[0].id, metadata: ROLLOVER_AUDIT, newValue: { budgetId: progress.id, startDate, endDate,
                budgetAmount: inserted[0].budgetAmount, spentAmount: inserted[0].spentAmount, rolloverIn: inserted[0].rolloverIn, currency: denomination } });
            created++;
            continue;
          }
          [period] = await tx.select().from(budgetPeriods).where(and(eq(budgetPeriods.budgetId, progress.id),
            eq(budgetPeriods.startDate, startDate), eq(budgetPeriods.endDate, endDate))).for("update");
          if (!period) throw new ConflictError("Budget period changed during rollover");
        }
        // Verify the locked row's actual denomination; never use a default or
        // rewrite a manual amount/version from the earlier progress snapshot.
        readBudgetMoney(period.budgetAmount, period.currency, denomination);
        const [after] = await tx.update(budgetPeriods).set({ spentAmount: progress.spent.toString(), rolloverIn: progress.rolloverIn.toString(), updatedAt: new Date() })
          .where(eq(budgetPeriods.id, period.id)).returning();
        await businessAuditService.logUpdate({ tx, userId: null, householdId: budget.householdId, entityType: "budget_period",
          entityId: period.id, metadata: ROLLOVER_AUDIT,
          oldValue: { budgetId: progress.id, spentAmount: period.spentAmount, rolloverIn: period.rolloverIn },
          newValue: { budgetId: progress.id, spentAmount: after.spentAmount, rolloverIn: after.rolloverIn } });
        updated++;
      }
      return { created, updated };
    });
  }
}
export const budgetRolloverRepository = new BudgetRolloverRepository();
