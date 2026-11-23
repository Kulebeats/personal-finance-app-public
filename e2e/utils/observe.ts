import { expect, type Locator } from "@playwright/test";
import { withFixtureClient } from "../../server/testing/fixtures/fixture-context";
import { moneyValue, valueText } from "./money-value";

/**
 * Readers for `readBack` observers (read-back.ts). Each waits only for the
 * thing it reads to exist, never for a particular value: a corrupted value
 * must be observed and reported, not time out as if nothing rendered.
 */

/** The `value` column of the one stored row the query selects, as text. */
export async function storedValue(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await withFixtureClient((client) => client.query<{ value: unknown }>(sql, params));
  if (rows.length !== 1) throw new Error(`expected one stored row, found ${rows.length}`);
  const text = valueText(rows[0].value);
  if (text === undefined) throw new Error(`the stored value is not text: ${JSON.stringify(rows[0].value)}`);
  return text;
}

/** The one stored row's `amount` and `currency` columns, as a money value. */
export async function storedMoney(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await withFixtureClient((client) => client.query<{ amount: unknown; currency: unknown }>(sql, params));
  if (rows.length !== 1) throw new Error(`expected one stored row, found ${rows.length}`);
  const [{ amount, currency }] = rows;
  if (typeof amount !== "string") throw new Error(`the stored amount is not text: ${JSON.stringify(amount)}`);
  return typeof currency === "string" ? moneyValue(amount, currency) : `${amount} (no currency)`;
}

/** A response field (a string, number, or MoneyDto with its currency) as a value. */
export function responseValue(value: unknown, field: string): string {
  const text = valueText(value);
  if (text === undefined) throw new Error(`the response has no ${field}: ${JSON.stringify(value)}`);
  return text;
}

/** Group 1 of `pattern` in the aria-label of the single element `locator` finds. */
export async function labelPart(locator: Locator, pattern: RegExp): Promise<string> {
  await expect(locator).toHaveCount(1);
  const label = (await locator.getAttribute("aria-label")) ?? "";
  const match = pattern.exec(label);
  if (!match?.[1]) throw new Error(`"${label}" does not match ${pattern}`);
  return match[1];
}

/** The money text at the end of a label such as "View Corner shop, K 25.00" (its last ", " segment). */
export const LAST_SEGMENT = /, ((?:(?!, ).)+)$/;
/** The budgeted money text in a budget row's label ("…, K 650.00 budgeted, …"). */
export const BUDGETED_SEGMENT = /, ((?:(?!, ).)+) budgeted, /;

/** An input's current value, once it has one. */
export async function inputValue(locator: Locator): Promise<string> {
  await expect(locator).toHaveValue(/\S/);
  return locator.inputValue();
}

/** The text of the single element `locator` finds. */
export async function shownText(locator: Locator): Promise<string> {
  await expect(locator).toHaveCount(1);
  return (await locator.textContent()) ?? "";
}

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Kwacha text matched in full: "K", an optional space (lib/money puts a
 * no-break space, lib/format none), then exactly `amount`, so another
 * currency or extra leading digits (K1,120.00 for 120.00) do not match.
 * Unanchored, to sit inside a longer pattern; `exactKwacha` anchors it.
 */
export const kwacha = (amount: string): string => `K\\s?${escapeRegExp(amount)}`;
export const exactKwacha = (amount: string): RegExp => new RegExp(`^${kwacha(amount)}$`);
