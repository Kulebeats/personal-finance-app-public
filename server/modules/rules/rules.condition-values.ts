/**
 * Rules Module - condition values typed by field (NEW-36)
 *
 * A condition's value must fit the field it tests, or the rule silently never matches:
 * - amount: a non-negative money string with at most two decimals, compared with a number
 *   operator; a range needs an upper bound that is not below the lower one;
 * - text fields (statement, merchant name, merchant category, notes): a non-empty string
 *   of at most 255 characters, compared with a text operator; value2 is only the free-text
 *   detail of the "Other" merchant category;
 * - account and category: an id, compared with equals / not equals;
 * - transaction type: income, expense or transfer, compared with equals / not equals.
 * Amounts are compared with Money, never floats (Rule 1).
 *
 * @module modules/rules/condition-values
 */

import { z } from "zod";
import {
  NUMBER_OPERATORS, TEXT_OPERATORS, type ConditionType, type Operator,
} from "@shared/ruleConditions";
import { Money } from "../../core/money";

const MONEY_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 255;
const TEXT_FIELDS: readonly ConditionType[] = ["original_statement", "merchant_name", "merchant_category", "description"];
const EQUALITY_OPERATORS: readonly Operator[] = ["equals", "not_equals"];
const TRANSACTION_TYPES = ["income", "expense", "transfer"];

interface ConditionValues {
  type: ConditionType;
  operator: Operator;
  value: string | number | string[];
  value2?: string | number;
}

const isMoney = (value: unknown): value is string => typeof value === "string" && MONEY_PATTERN.test(value);
const isBoundedText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;

/** Problems with this condition's operator and values, as [path, message] pairs. */
function conditionValueIssues(condition: ConditionValues): Array<[string, string]> {
  const { type, operator, value, value2 } = condition;
  if (type === "amount") {
    if (!(NUMBER_OPERATORS as readonly Operator[]).includes(operator)) return [["operator", "An amount condition needs a number operator"]];
    if (!isMoney(value)) return [["value", "An amount must be a non-negative amount with at most two decimals, written as text"]];
    if (operator !== "range") return [];
    if (!isMoney(value2)) return [["value2", "An amount range needs an upper amount with at most two decimals"]];
    return new Money(value2).lt(new Money(value)) ? [["value2", "The upper amount must not be below the lower amount"]] : [];
  }
  if (TEXT_FIELDS.includes(type)) {
    if (!(TEXT_OPERATORS as readonly Operator[]).includes(operator)) return [["operator", "A text condition needs a text operator"]];
    if (!isBoundedText(value)) return [["value", `Text must be 1 to ${MAX_TEXT_LENGTH} characters`]];
    const detailOk = value2 === undefined || (typeof value2 === "string" && value2.length <= MAX_TEXT_LENGTH);
    return detailOk ? [] : [["value2", `Text must be at most ${MAX_TEXT_LENGTH} characters`]];
  }
  if (!EQUALITY_OPERATORS.includes(operator)) return [["operator", "This condition can only test equals or not equals"]];
  if (type === "transaction_type") {
    return typeof value === "string" && TRANSACTION_TYPES.includes(value) ? [] : [["value", "Transaction type must be income, expense or transfer"]];
  }
  return typeof value === "string" && UUID_PATTERN.test(value) ? [] : [["value", "The condition must name an account or category by its id"]];
}

/** Add an issue to `ctx` for each way this condition's value does not fit its field. */
export function refineConditionValue(condition: ConditionValues, ctx: z.RefinementCtx): void {
  for (const [path, message] of conditionValueIssues(condition)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  }
}
