import { Money } from "../../core/money";
import { ValidationError } from "../../core/errors";
import { moneyAmountStringSchema } from "../../core/validation/money";
import type { RuleAction } from "./types";

type RuleSplit = NonNullable<RuleAction["splitConfig"]>[number];

/**
 * A fixed amount is a positive decimal string at currency scale. Stored rules are
 * checked at runtime too, so a legacy numeric amount is refused, not coerced.
 */
function isPositiveMoneyString(amount: unknown): boolean {
  return moneyAmountStringSchema.safeParse(amount).success && new Money(String(amount)).gt(0);
}

/** A final allocation with no unit is the existing explicit remainder form. */
export function ruleSplitConfigError(splits: readonly RuleSplit[] | undefined): string | undefined {
  if (!Array.isArray(splits) || splits.length === 0) return "A split action requires an allocation";
  let percentages = Money.zero();
  let hasAmounts = false;
  let hasRemainder = false;
  for (const [index, split] of splits.entries()) {
    if (!split || typeof split !== "object") return "Invalid split allocation";
    const amount = split.amount;
    const percentage = split.percentage;
    if (amount !== undefined && percentage !== undefined) return "Choose amount or percentage for each split";
    if (amount !== undefined) {
      if (!isPositiveMoneyString(amount)) {
        return "Split amounts must be positive currency-scale values";
      }
      hasAmounts = true;
    } else if (percentage !== undefined) {
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return "Invalid split percentage";
      percentages = percentages.add(percentage);
    } else {
      if (index !== splits.length - 1) return "Only the final split can receive the remainder";
      hasRemainder = true;
    }
  }
  if (percentages.gt(100) || (hasAmounts && percentages.gte(100))) return "Split percentages exceed the parent amount";
  if (!hasAmounts && !hasRemainder && !percentages.equals(100)) return "Split percentages must total 100";
}

/** Validate stored declarations too, including rules re-enabled after quarantine. */
export function validateRuleSplitActions(actions: unknown): void {
  if (!Array.isArray(actions)) throw new ValidationError("Invalid rule actions");
  for (const action of actions) {
    if (action?.type !== "split_transaction" || action.enabled === false) continue;
    const error = ruleSplitConfigError(action.splitConfig);
    if (error) throw new ValidationError(error);
  }
}

export function allocateRuleSplits(amount: string, currency: string, splits: readonly RuleSplit[]): Money[] {
  const error = ruleSplitConfigError(splits);
  if (error) throw new ValidationError(error);
  const total = new Money(amount, currency).abs();
  const allocations = splits.map(split => {
    if (split.percentage !== undefined) return total.multiply(split.percentage).divide(100);
    return new Money(split.amount ?? 0, currency);
  });
  const sum = allocations.reduce((value, part) => value.add(part), Money.zero(currency));
  const last = splits[splits.length - 1];
  if (last.amount === undefined && last.percentage === undefined && sum.lte(total)) {
    allocations[allocations.length - 1] = total.subtract(sum);
  } else if (!sum.equals(total)) {
    throw new ValidationError("Split allocations must equal the parent transaction amount");
  }
  // Round cumulative targets so many sub-cent percentages cannot overdraw the
  // final allocation. Fixed cents remain exact and the total stays conserved.
  let cumulative = Money.zero(currency), allocated = Money.zero(currency);
  return allocations.map(part => {
    cumulative = cumulative.add(part);
    const target = new Money(cumulative.toString(), currency);
    const value = target.subtract(allocated);
    allocated = target;
    return value;
  });
}
