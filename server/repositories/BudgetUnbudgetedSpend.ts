import { Money } from "../core/money";
import { BudgetDenominationUnavailable } from "../core/money/budget-denomination";
import { assembleBudgetSpentBatch, type BudgetSpendInputs } from "./BudgetSpendBatchQueries";

/** A month's spending (and earning) in categories no budget covers, per section;
 * null when some of it cannot be reported in the household currency. */
export type UnbudgetedSpend = { expense: Money | null; income: Money | null };

type Coverage = { categoryId: string | null; categoryGroupId: string | null };

/**
 * The budget page lists every category with a group, but only a budget's row
 * shows what was spent. Spending in a category with no limit of its own and no
 * group limit appeared nowhere, so a section could read 0.00 spent with an
 * expense posted (N3). This sums that spending from the same flows the budget
 * rows read: the reader's visible, posted, budget-included transactions in
 * budget categories, converted at the same verified rates.
 *
 * A budget held in another currency still covers its category: it is listed as
 * unavailable, not as unbudgeted.
 */
export function unbudgetedSpend(
  input: BudgetSpendInputs & { groupSettings: Array<{ id: string; type: string }> },
  range: { from: string; to: string },
  budgets: readonly Coverage[],
  currency: string,
): UnbudgetedSpend {
  const coveredCategories = new Set(budgets.flatMap((row) => row.categoryId ? [row.categoryId] : []));
  const coveredGroups = new Set(budgets.flatMap((row) => row.categoryGroupId ? [row.categoryGroupId] : []));
  const groupTypes = new Map(input.groupSettings.map((group) => [group.id, group.type === "income" ? "income" : "expense"] as const));
  const flows = input.flows.filter((flow) => flow.date >= range.from && flow.date <= range.to && flow.groupId !== null
    && !coveredCategories.has(flow.categoryId) && !coveredGroups.has(flow.groupId));
  const section = (type: "income" | "expense"): Money | null => {
    const sectionFlows = flows.filter((flow) => groupTypes.get(flow.groupId!) === type && flow.type === type);
    const categoryIds = Array.from(new Set(sectionFlows.map((flow) => flow.categoryId)));
    const types = new Map(categoryIds.map((id) => [id, type] as const));
    try {
      const batch = assembleBudgetSpentBatch({ ...input, flows: sectionFlows }, categoryIds, [], currency, types, new Map(), false);
      return Array.from(batch.byCategoryId.values()).reduce((sum, value) => sum.add(value), Money.zero(currency));
    } catch (error) {
      if (error instanceof BudgetDenominationUnavailable) return null;
      throw error;
    }
  };
  return { expense: section("expense"), income: section("income") };
}
