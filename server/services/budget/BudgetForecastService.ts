import type { Budget } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { Money } from "../../core/money";
import { budgetRepository } from "../../repositories/BudgetRepository";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { BudgetCoreService } from "./BudgetCoreService";
import { withTransaction } from "../../utils/withTransaction";
import { ensureFlexBudget, type FlexBudgetActor } from "./flexBudget";
import type { BudgetCreateActor } from "./budgetCreate";
import { businessAuditService } from "../BusinessAuditService";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
// BUDGET-TIME-001: Import timezone-safe date utilities
import { getMonthStart, getMonthEnd } from "../../utils/dateUtils";

const MAX_RETRY_ATTEMPTS = 3;

export class BudgetForecastService extends BudgetCoreService {
  protected getMonthRange(
    year: number,
    month: number,
    months: number
  ): Array<{ year: number; month: number }> {
    const range: Array<{ year: number; month: number }> = [];
    let currentYear = year;
    let currentMonth = month;

    for (let i = 0; i < months; i += 1) {
      range.push({ year: currentYear, month: currentMonth });
      currentMonth += 1;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear += 1;
      }
    }

    return range;
  }

  // BUDGET-TIME-001: Use imported timezone-safe utility functions
  protected getMonthStart(year: number, month: number) {
    return getMonthStart(year, month);
  }

  protected getMonthEnd(year: number, month: number) {
    return getMonthEnd(year, month);
  }

  /** Creates the flex budget at most once per household, audited, under the preferences lock. */
  async ensureFlexBudget(actor: FlexBudgetActor): Promise<Budget> {
    return ensureFlexBudget(actor, "ensure_flex_budget");
  }

  async getBudgetForecast(
    householdId: string,
    year: number,
    month: number,
    months: number
  ) {
    const budgetsList = await budgetRepository.findByHousehold(householdId, {
      includeInactive: true,
    });

    const range = this.getMonthRange(year, month, months);
    if (budgetsList.length === 0) {
      return {
        range,
        budgets: [],
      };
    }

    const startDate = this.getMonthStart(range[0].year, range[0].month);
    const lastRange = range[range.length - 1];
    const endDate = this.getMonthEnd(lastRange.year, lastRange.month);

    const periodRows = await budgetRepository.getBudgetPeriodsForRange(
      budgetsList.map((budget) => budget.id),
      startDate,
      endDate
    );

    const periodMap = new Map<string, Map<string, { amount: string; currency: string }>>();
    for (const period of periodRows) {
      if (!isCurrencyCode(period.currency)) throw new ConflictError("Budget period denomination is unavailable");
      const key = `${period.startDate}`;
      if (!periodMap.has(period.budgetId)) {
        periodMap.set(period.budgetId, new Map());
      }
      periodMap.get(period.budgetId)!.set(key, { amount: period.budgetAmount, currency: period.currency });
    }

    const budgetsWithPeriods = budgetsList.map((budget) => {
      if (!isCurrencyCode(budget.currency)) throw new ConflictError("Budget denomination is unavailable");
      const budgetPeriods = range.map((rangeItem) => {
        const start = this.getMonthStart(rangeItem.year, rangeItem.month);
        const override = periodMap.get(budget.id)?.get(start);
        const amount = override?.amount ?? budget.amount;
        return {
          year: rangeItem.year,
          month: rangeItem.month,
          amount,
          currency: override?.currency ?? budget.currency,
        };
      });

      return {
        ...budget,
        periods: budgetPeriods,
      };
    });

    return {
      range,
      budgets: budgetsWithPeriods,
    };
  }

  async updateBudgetForecast(
    householdId: string,
    budgetId: string,
    input: {
      year: number;
      month: number;
      amount: string;
      currency?: string;
      applyScope?: "this_month" | "all_future";
      months?: number;
    },
    actor?: BudgetCreateActor,
  ) {
    const scope = input.applyScope || "this_month";
    const months = scope === "all_future" ? input.months || 12 : 1;
    const range = this.getMonthRange(input.year, input.month, months);
    // NEW-32: with an actor, the override and its one audit row commit together.
    return withTransaction(async tx => {
      // Household first, as the confirmed apply locks it (P1-1): the audit FK takes KEY SHARE on it.
      await lockAccountHousehold(tx, householdId);
      const budget = await budgetRepository.findById(budgetId, householdId, tx, true);
      if (!budget) throw new NotFoundError("Budget not found");
      // Older internal callers supply a decimal string. Their only safe
      // implicit denomination is the persisted row, never a display setting.
      const currency = input.currency ?? budget.currency;
      if (!isCurrencyCode(currency)) throw new ConflictError("Budget denomination is unavailable");
      const value = new Money(input.amount, currency);
      if (!value.amount.isFinite() || value.isNegative() || value.gt(new Money("9999999999999.99", currency))) {
        throw new ValidationError("Invalid budget forecast amount");
      }
      const targets: Array<{ startDate: string; endDate: string }> = [];
      for (const rangeItem of range) {
        const startDate = this.getMonthStart(rangeItem.year, rangeItem.month);
        const endDate = this.getMonthEnd(rangeItem.year, rangeItem.month);
        const existing = await budgetRepository.findPeriod(budget.id, startDate, endDate, tx, true);
        const actualCurrency = existing?.currency ?? budget.currency;
        if (!isCurrencyCode(actualCurrency) || actualCurrency !== currency) {
          throw new ConflictError("Forecast amount currency disagrees with a selected month's budget denomination");
        }
        targets.push({ startDate, endDate });
      }
      // Validate the entire range before any mutation; row locks and one
      // transaction keep concurrent edits from changing the admitted currency.
      for (const target of targets) await budgetRepository.upsertPeriod({
        budgetId: budget.id, ...target, budgetAmount: value.toString(), currency,
      }, tx);
      if (actor) {
        await businessAuditService.logUpdate({
          tx, userId: actor.userId, householdId, entityId: budget.id, entityType: "budget",
          newValue: { amount: value.toString(), currency, year: input.year, month: input.month, applyScope: scope, months },
          ipAddress: actor.ipAddress, metadata: { operation: "forecastUpdate" },
        });
      }
      return { budgetId: budget.id, scope, months };
    });
  }

  async moveBudgetAmount(
    householdId: string,
    input: {
      fromBudgetId: string;
      toBudgetId: string;
      amount: string;
      year: number;
      month: number;
      applyScope?: "this_month" | "all_future";
      months?: number;
    },
    actor?: BudgetCreateActor,
  ) {
    const fromBudget = await budgetRepository.findById(
      input.fromBudgetId,
      householdId
    );
    const toBudget = await budgetRepository.findById(
      input.toBudgetId,
      householdId
    );

    if (!fromBudget || !toBudget) {
      throw new NotFoundError("Budget not found");
    }

    const scope = input.applyScope || "this_month";
    const months = scope === "all_future" ? input.months || 12 : 1;
    const range = this.getMonthRange(input.year, input.month, months);
    const moveAmount = new Money(input.amount);

    if (moveAmount.isNegative() || moveAmount.isZero()) {
      throw new ValidationError("Invalid move amount", [
        { field: "amount", message: "Must be a positive number" },
      ]);
    }

    // A move from a budget to itself nets to zero (subtract X, add X back
    // to the same period row) - treat it as a no-op rather than performing
    // two version-guarded updates against the same row, which would always
    // conflict on the second write.
    if (fromBudget.id === toBudget.id) {
      return { scope, months };
    }

    // BUDGET-RACE-002: always lock the two budget-period rows in a
    // consistent (lower-id-first) order, computed once per call so every
    // attempt (and every concurrent mover touching this same budget pair,
    // regardless of move direction) agrees on the order. This prevents a
    // deadlock between opposing concurrent moves (A->B while B->A is
    // in flight).
    const [firstBudget, secondBudget] =
      fromBudget.id < toBudget.id
        ? [fromBudget, toBudget]
        : [toBudget, fromBudget];

    // ISSUE-009 / BUDGET-RACE-002: Retry loop for locking conflicts
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        await withTransaction(async (tx) => {
          // Household first, as the confirmed apply locks it (P1-1): the audit FK takes KEY SHARE on it.
          await lockAccountHousehold(tx, householdId);
          for (const rangeItem of range) {
            const startDate = this.getMonthStart(rangeItem.year, rangeItem.month);
            const endDate = this.getMonthEnd(rangeItem.year, rangeItem.month);

            // BUDGET-RACE-002: Ensure both period rows exist BEFORE locking.
            // Postgres has no gap/next-key locking, so `SELECT ... FOR
            // UPDATE` against a row that doesn't exist yet locks nothing -
            // it's a no-op "phantom read" that lets a concurrent mover race
            // straight past the lock and compute its own sufficiency check
            // against the stale/base budget amount instead of the real,
            // just-written period value (the root cause of the
            // double-spend: BUDGET-RACE-002).
            for (const candidate of [firstBudget, secondBudget]) {
              if (candidate.amount === null) {
                const explicit = await budgetRepository.findPeriod(candidate.id, startDate, endDate, tx, true);
                if (!explicit) throw new ValidationError("Cannot move money from or to an unbudgeted month");
              } else {
                await budgetRepository.ensurePeriodExists({ budgetId: candidate.id, startDate, endDate,
                  budgetAmount: candidate.amount }, tx);
              }
            }

            // Now take a REAL row lock on both, same consistent order, so a
            // concurrent transaction touching the same pair blocks here
            // until we commit or roll back, then sees our committed values.
            const firstLocked = await budgetRepository.findPeriod(
              firstBudget.id,
              startDate,
              endDate,
              tx,
              true, // Use FOR UPDATE lock
            );
            const secondLocked = await budgetRepository.findPeriod(
              secondBudget.id,
              startDate,
              endDate,
              tx,
              true, // Use FOR UPDATE lock
            );

            const fromPeriod =
              firstBudget.id === fromBudget.id ? firstLocked : secondLocked;
            const toPeriod =
              firstBudget.id === fromBudget.id ? secondLocked : firstLocked;

            if (!fromPeriod || !toPeriod) {
              // Unreachable in practice: ensurePeriodExists just guaranteed
              // both rows exist inside this same transaction. Treat as a
              // conflict so the retry loop re-attempts rather than silently
              // proceeding with an assumed value.
              throw new ConflictError(
                "Budget period was modified by another request, please retry",
              );
            }

            // Re-check sufficiency against the value we just locked - never
            // the budget's base amount, and never a value read before we
            // held the lock - so a concurrent mover that already spent this
            // period is always visible here.
            const fromAmount = new Money(fromPeriod.budgetAmount);
            const toAmount = new Money(toPeriod.budgetAmount);

            if (fromAmount.lt(moveAmount)) {
              throw new ValidationError("Insufficient budget to move", [
                { field: "amount", message: "Move amount exceeds available budget" },
              ]);
            }

            const newFromAmount = fromAmount.subtract(moveAmount).toString();
            const newToAmount = toAmount.add(moveAmount).toString();

            // Both rows have been under a real FOR UPDATE lock since the
            // reads above for the rest of this transaction, so no other
            // transaction can have changed their version out from under us;
            // the version check here is defense-in-depth, not the primary
            // guard.
            const fromResult = await budgetRepository.updatePeriodWithLock(
              fromPeriod.id,
              fromPeriod.version,
              { budgetAmount: newFromAmount },
              tx,
            );

            if (!fromResult) {
              throw new ConflictError(
                "Budget was modified by another request, please retry",
              );
            }

            const toResult = await budgetRepository.updatePeriodWithLock(
              toPeriod.id,
              toPeriod.version,
              { budgetAmount: newToAmount },
              tx,
            );

            if (!toResult) {
              throw new ConflictError(
                "Budget was modified by another request, please retry",
              );
            }
          }
          // NEW-32: one TRANSFER audit row per committed move, in its transaction.
          if (actor) {
            await businessAuditService.log({
              tx, householdId, userId: actor.userId, action: "TRANSFER", entityType: "budget", entityId: fromBudget.id,
              details: { toBudgetId: toBudget.id, amount: input.amount }, ipAddress: actor.ipAddress,
            });
          }
        });

        // Success - exit retry loop
        return {
          scope,
          months,
        };
      } catch (error) {
        if (error instanceof ConflictError && attempt < MAX_RETRY_ATTEMPTS) {
          // Retry on conflict
          continue;
        }
        throw error;
      }
    }

    // Should not reach here, but TypeScript needs a return
    throw new ConflictError(
      "Budget move failed after maximum retries due to concurrent modifications"
    );
  }
}
