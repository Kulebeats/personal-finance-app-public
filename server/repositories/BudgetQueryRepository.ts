import type { Budget } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import Decimal from "decimal.js";
import { Money } from "../core/money";
import { BudgetDenominationUnavailable, readBudgetMoney } from "../core/money/budget-denomination";
import { ConflictError } from "../core/errors";
import { logger } from "../utils/logger";
import type { BudgetReadContext } from "./BudgetReadContext";
import { readBudgetProgressInputs, type BudgetProgressInputs } from "./BudgetProgressReadRepository";
import { assembleBudgetSpentBatch, type BudgetSpentBatch } from "./BudgetSpendBatchQueries";
import { unbudgetedSpend, type UnbudgetedSpend } from "./BudgetUnbudgetedSpend";

export type BudgetProgressRow = Budget & { amount: string; spent: Money; remaining: Money; percentUsed: number; rolloverIn: Money };
type Options = { context: BudgetReadContext; currency?: string; autoRolloverBudget?: boolean; rolloverPercentage?: number; rolloverOnly?: boolean };
export const BUDGET_CURRENCY_MISMATCH = "BUDGET_CURRENCY_MISMATCH";
/** A budget whose limit cannot be reported in the household currency. It is
 * listed with its reason instead of failing every other budget's progress. */
export type UnavailableBudget = { id: string; name: string; categoryId: string | null; categoryGroupId: string | null;
  currency: string; reason: { code: typeof BUDGET_CURRENCY_MISMATCH; message: string } };
export type BudgetProgressProjection = { progress: BudgetProgressRow[]; unavailable: UnavailableBudget[]; preferences: BudgetProgressInputs["preferences"];
  /** This month's spending in categories no budget covers (N3). */
  unbudgeted: UnbudgetedSpend };

function bounds(year: number, month: number) {
  return { from: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
function periodFor(input: BudgetProgressInputs, budgetId: string, range: ReturnType<typeof bounds>) {
  const matching = input.periods.filter(row => row.budgetId === budgetId && row.from <= range.to && row.to >= range.from);
  if (matching.length > 1 || matching.some(row => row.from !== range.from || row.to !== range.to)) throw new BudgetDenominationUnavailable();
  return matching[0];
}
type DenominationEvidence = { budget: BudgetProgressInputs["budgets"][number]; current?: { currency: string | null }; enabled: unknown };
/** The first valid currency this budget's limit is held in that is not the
 * household's: its default, this month's limit, or (with rollover) any month
 * it carries from. A limit is never converted with an assumed rate. */
function foreignDenomination(input: BudgetProgressInputs, row: DenominationEvidence, currency: string): string | undefined {
  const carried = row.enabled ? input.periods.filter(period => period.budgetId === row.budget.id).map(period => period.currency) : [];
  return [row.budget.currency, row.current?.currency, ...carried].find(value => isCurrencyCode(value) && value !== currency) ?? undefined;
}
function unavailableBudget(budget: DenominationEvidence["budget"], foreign: string, currency: string): UnavailableBudget {
  return { id: budget.id, name: budget.name, categoryId: budget.categoryId ?? null, categoryGroupId: budget.categoryGroupId ?? null,
    currency: foreign, reason: { code: BUDGET_CURRENCY_MISMATCH,
      message: `This budget's limit is in ${foreign} but the household reports in ${currency}. No verified conversion is applied, so its progress is not shown.` } };
}
export function assembleBudgetProgress(input: BudgetProgressInputs, year: number, month: number, options: Options): BudgetProgressProjection {
  if (options.rolloverOnly && !input.preferences.autoRolloverBudget) {
    return { progress: [], unavailable: [], preferences: input.preferences, unbudgeted: { expense: null, income: null } };
  }
  const currency = input.currency;
  if (!isCurrencyCode(currency) || (options.currency !== undefined && options.currency !== currency)) throw new BudgetDenominationUnavailable();
  const currentRange = bounds(year, month);
  const categorySettings = new Map(input.categorySettings.map(row => [row.id, row]));
  const groupSettings = new Map(input.groupSettings.map(row => [row.id, row]));
  const autoRollover = options.autoRolloverBudget ?? input.preferences.autoRolloverBudget;
  const percentage = new Decimal(Math.min(Math.max(options.rolloverPercentage ?? input.preferences.rolloverPercentage, 0), 100)).dividedBy(100);
  const candidates = input.budgets.map(budget => {
    const category = budget.categoryId ? categorySettings.get(budget.categoryId) : undefined;
    const group = budget.categoryGroupId ? groupSettings.get(budget.categoryGroupId) : undefined;
    const current = periodFor(input, budget.id, currentRange);
    const enabled = autoRollover && (budget.rolloverEnabled || category?.rolloverEnabled || group?.rolloverEnabled);
    const seed = !budget.rolloverEnabled && category?.rolloverEnabled ? category.rolloverStartBalance ?? "0" : budget.rolloverAmount ?? "0";
    const born = new Date(budget.createdAt).toISOString().slice(0, 7);
    const earliest = input.periods.filter(row => row.budgetId === budget.id).map(row => row.from.slice(0, 7)).sort()[0];
    // R5-03: rollover starts at the first month with a limit. A budget with no
    // recurring default (month-only) has none before its earliest period.
    const firstLimit = budget.amount === null ? earliest : [born, earliest ?? born].sort()[0];
    const anchor = [firstLimit ?? currentRange.from.slice(0, 7), currentRange.from.slice(0, 7)].sort()[0];
    return { budget, current, enabled, seed, anchor };
  }).filter(row => (row.current?.amount ?? row.budget.amount) !== null)
    .map(row => ({ ...row, foreign: foreignDenomination(input, row, currency) }));
  // A foreign-denominated budget is set aside on its own. It does not change
  // any other budget's spend (flex spend never depends on the budget list).
  const configured = candidates.filter(row => !row.foreign);
  const unavailable = candidates.flatMap(row => row.foreign ? [unavailableBudget(row.budget, row.foreign, currency)] : []);
  const categoryTypes = new Map<string, "income" | "expense">(), groupTypes = new Map<string, "income" | "expense">();
  for (const { budget } of configured) {
    if (budget.categoryId) {
      const groupId = categorySettings.get(budget.categoryId)?.groupId;
      categoryTypes.set(budget.categoryId, groupId && groupSettings.get(groupId)?.type === "income" ? "income" : "expense");
    }
    if (budget.categoryGroupId) groupTypes.set(budget.categoryGroupId, groupSettings.get(budget.categoryGroupId)?.type === "income" ? "income" : "expense");
  }
  const spentFor = (range: ReturnType<typeof bounds>, rows: typeof configured) => assembleBudgetSpentBatch(
    { ...input, flows: input.flows.filter(row => row.date >= range.from && row.date <= range.to) },
    rows.map(row => row.budget.categoryId).filter((id): id is string => Boolean(id)),
    rows.map(row => row.budget.categoryGroupId).filter((id): id is string => Boolean(id)), currency,
    categoryTypes, groupTypes, rows.some(row => row.budget.isFlexBucket));
  const currentSpent = spentFor(currentRange, configured);
  const pastSpend = new Map<string, BudgetSpentBatch>();
  const amountSpent = (budget: Pick<Budget, "isFlexBucket" | "categoryId" | "categoryGroupId">, spent: BudgetSpentBatch) => budget.isFlexBucket ? spent.flexTotal
    : budget.categoryId ? spent.byCategoryId.get(budget.categoryId) ?? Money.zero(currency)
      : budget.categoryGroupId ? spent.byCategoryGroupId.get(budget.categoryGroupId) ?? Money.zero(currency) : Money.zero(currency);
  const progress = configured.map(({ budget, current, enabled, seed, anchor }): BudgetProgressRow => {
    const currentLimit = readBudgetMoney((current?.amount ?? budget.amount)!, current ? current.currency : budget.currency, currency);
    const spent = amountSpent(budget, currentSpent);
    let rolloverIn = Money.zero(currency);
    if (enabled) {
      rolloverIn = new Money(seed, currency).isZero() ? Money.zero(currency) : readBudgetMoney(seed, budget.currency, currency);
      const cursor = new Date(`${anchor}-01T00:00:00Z`);
      while (cursor.toISOString().slice(0, 7) < currentRange.from.slice(0, 7)) {
        const range = bounds(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1), key = range.from.slice(0, 7);
        const override = periodFor(input, budget.id, range);
        // A later recurring-default edit is not evidence of an earlier limit.
        // Missing monthly evidence is explicitly unavailable, never a guess.
        if (!override && (budget.amount === null || new Date(budget.updatedAt).toISOString().slice(0, 7) > key)) throw new BudgetDenominationUnavailable();
        const limit = readBudgetMoney((override?.amount ?? budget.amount)!, override ? override.currency : budget.currency, currency);
        if (!pastSpend.has(key)) pastSpend.set(key, spentFor(range, configured.filter(row => row.enabled && row.anchor <= key)));
        rolloverIn = rolloverIn.add(limit).subtract(amountSpent(budget, pastSpend.get(key)!));
        if (rolloverIn.amount.greaterThan(0)) rolloverIn = rolloverIn.multiply(percentage);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    const total = currentLimit.add(rolloverIn);
    return { ...budget, createdAt: new Date(budget.createdAt), updatedAt: new Date(budget.updatedAt), currency,
      amount: currentLimit.toString(), spent, remaining: total.subtract(spent), rolloverIn,
      percentUsed: total.amount.greaterThan(0) ? spent.amount.dividedBy(total.amount).times(100).toDecimalPlaces(2).toNumber() : 0 };
  });
  const unbudgeted = unbudgetedSpend(input, currentRange, candidates.map(row => row.budget), currency);
  return { progress, unavailable, preferences: input.preferences, unbudgeted };
}

export class BudgetQueryRepository {
  async getProgressProjection(householdId: string, year: number, month: number, options: Options): Promise<BudgetProgressProjection> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const input = await readBudgetProgressInputs(householdId, year, month, options?.context);
      let result: BudgetProgressProjection | undefined, failure: BudgetDenominationUnavailable | undefined;
      try { result = assembleBudgetProgress(input, year, month, options); }
      catch (error) { if (error instanceof BudgetDenominationUnavailable) failure = error; else throw error; }
      const current = await readBudgetProgressInputs(householdId, year, month, options.context);
      if (JSON.stringify(input) !== JSON.stringify(current)) continue;
      if (failure) throw failure;
      // Set-aside budgets are surfaced to HTTP callers in meta; system readers
      // (rollover, cron alerts) skip them, so record that here (C3-10).
      if (result!.unavailable.length) logger.warn("Budget progress set aside budgets not in the household currency", {
        householdId, year, month, budgets: result!.unavailable.map(row => ({ id: row.id, currency: row.currency })) });
      return result!;
    }
    throw new ConflictError("Budget progress inputs changed. Please try again.");
  }

  async getBudgetsWithProgress(householdId: string, year: number, month: number, options: Options): Promise<BudgetProgressRow[]> {
    return (await this.getProgressProjection(householdId, year, month, options)).progress;
  }
}
export const budgetQueryRepository = new BudgetQueryRepository();
