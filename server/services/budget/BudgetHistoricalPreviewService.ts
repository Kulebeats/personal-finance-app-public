import type { BudgetRecalculationPreview, BudgetRecalculationSuggestion } from "@shared/budget-recalculation-preview";
import { isCurrencyCode } from "@shared/denomination";
import { db } from "../../db";
import { ConflictError, HttpError, ValidationError } from "../../core/errors";
import { Money, toMoneyDto } from "../../core/money";
import { budgetPreviewCut, readBudgetPreviewInputs, type BudgetPreviewInputs } from "../../repositories/BudgetPreviewReadRepository";

class BudgetPreviewUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
  constructor() { super("Verified financial inputs are unavailable for this visible historical estimate"); }
}
function amount(value: string, currency: string) {
  let result: Money;
  try { result = new Money(value, currency); } catch { throw new BudgetPreviewUnavailable(); }
  if (!result.amount.isFinite() || result.isNegative()) throw new BudgetPreviewUnavailable();
  return result;
}
function rateFor(input: BudgetPreviewInputs, currency: string, date: string) {
  // FIN-06: the shared resolver already chose this day's rate (household
  // manual rate, else the shared rate on or before the date); none fails closed.
  const quote = input.quotes.find(row => row.from === currency && row.date === date);
  if (!quote) throw new BudgetPreviewUnavailable();
  const rate = amount(quote.rate, currency);
  if (rate.isZero()) throw new BudgetPreviewUnavailable();
  return rate.amount;
}
function targetKey(category: BudgetPreviewInputs["categories"][number]) {
  if (category.mode === "by_group" && category.groupId !== null) return `group:${category.groupId}`;
  if (category.mode === "by_category") return `category:${category.id}`;
  throw new BudgetPreviewUnavailable();
}
function currentLimit(input: BudgetPreviewInputs, key: string): BudgetRecalculationSuggestion["currentBudget"] {
  const matching = input.budgets.filter(row => key === (row.categoryId ? `category:${row.categoryId}` : `group:${row.categoryGroupId}`));
  if (matching.length > 1) throw new BudgetPreviewUnavailable();
  const budget = matching[0];
  if (!budget) return null;
  const overrides = input.overrides.filter(row => row.budgetId === budget.id);
  if (overrides.length > 1) throw new BudgetPreviewUnavailable();
  const override = overrides[0], first = `${input.targetPeriod}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0);
  if (override && (override.from !== first || override.to !== next.toISOString().slice(0, 10))) throw new BudgetPreviewUnavailable();
  const source = override ?? budget;
  if (source.amount === null) return null; // A period-only shell has no recurring limit.
  if (!isCurrencyCode(source.currency)) throw new BudgetPreviewUnavailable();
  return { id: budget.id, amount: toMoneyDto(amount(source.amount, source.currency)),
    periodId: override?.id ?? null, periodVersion: override?.version ?? null };
}
export function assembleBudgetRecalculationPreview(input: BudgetPreviewInputs): BudgetRecalculationPreview {
  if (!isCurrencyCode(input.currency) || input.invalidSplits) throw new BudgetPreviewUnavailable();
  const categories = new Map(input.categories.map(row => [row.id, row])), totals = new Map<string, Money>();
  const ungroupedDirections = new Map<string, "expense" | "income">();
  for (const flow of input.flows) {
    if (flow.invalid) throw new BudgetPreviewUnavailable();
    let value = amount(flow.amount, input.currency);
    if (value.isZero()) continue;
    if (!isCurrencyCode(flow.currency)) throw new BudgetPreviewUnavailable();
    if (flow.currency !== input.currency) value = value.multiply(rateFor(input, flow.currency, flow.date));
    const category = categories.get(flow.categoryId);
    if (!category) throw new Error("Historical budget query omitted its category projection");
    // A valid ungrouped category has no domain direction. Preserve a single
    // actual visible direction; never invent expense or net income as a refund.
    if (category.groupId === null) {
      const direction = ungroupedDirections.get(category.id);
      if (direction && direction !== flow.type) throw new BudgetPreviewUnavailable();
      ungroupedDirections.set(category.id, flow.type);
    }
    const key = targetKey(category);
    totals.set(key, (totals.get(key) ?? Money.zero(input.currency)).add(value));
  }
  const suggestions: BudgetRecalculationSuggestion[] = Array.from(totals.entries()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, total]): BudgetRecalculationSuggestion => ({ ...(key.startsWith("category:") ? { categoryId: key.slice(9), categoryGroupId: null }
      : { categoryId: null, categoryGroupId: key.slice(6) }), historicalTotal: toMoneyDto(total),
      amount: toMoneyDto(total.divide(input.periods.length)), currentBudget: currentLimit(input, key) }));
  return { mode: "preview", scope: "visible_posted_activity", targetPeriod: input.targetPeriod, periods: input.periods, suggestions };
}

/** No budget, period, ledger or mutation audit writes. Both public transports
 * use this actor-bound reader; the historical direct writer remains separate. */
export async function previewBudgetRecalculation(householdId: string, userId: string, months = 3): Promise<BudgetRecalculationPreview> {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new ValidationError("Months must be between 1 and 12");
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = await db.transaction(tx => readBudgetPreviewInputs(tx, householdId, userId, months),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    let result: BudgetRecalculationPreview | undefined, failure: BudgetPreviewUnavailable | undefined;
    try { result = assembleBudgetRecalculationPreview(input); }
    catch (error) { if (error instanceof BudgetPreviewUnavailable) failure = error; else throw error; }
    // Re-read the grouped financial cut in a NEW transaction. Reusing an RR
    // snapshot cannot validate a grant or source changed after assembly.
    const current = await db.transaction(tx => readBudgetPreviewInputs(tx, householdId, userId, months),
      { isolationLevel: "read committed", accessMode: "read only" });
    if (budgetPreviewCut(input) !== budgetPreviewCut(current)) continue;
    if (failure) throw failure;
    return result!;
  }
  throw new ConflictError("Budget preview inputs changed. Please try again.");
}
