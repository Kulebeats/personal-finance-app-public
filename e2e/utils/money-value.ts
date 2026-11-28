/**
 * Field values as the read-back compares them (read-back.ts). A money value is
 * "<amount> <CUR>": the amount and its ISO currency code, compared on both, so
 * a ZMW expense shown as US$42.50 is a different value from K 42.50. A source
 * that shows no currency at all (a bare amount input) says so explicitly with
 * `amountOnly`, the only place a currency is not compared. Anything that is
 * not a number or a money value compares as exact text.
 */

/** A source that renders the amount alone; it matches any currency. */
export const ANY_CURRENCY = "*";

export const moneyValue = (amount: string, currency: string): string => `${amount.trim()} ${currency}`;
export const amountOnly = (amount: string): string => moneyValue(amount, ANY_CURRENCY);

/** A request or response field as a value: a number, a boolean, a string, or a MoneyDto with its currency. */
export function valueText(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("amount" in value) || typeof value.amount !== "string") return undefined;
  const currency = "currency" in value ? value.currency : undefined;
  return typeof currency === "string" ? moneyValue(value.amount, currency) : `${value.amount} (no currency)`;
}

/**
 * Display symbols the app renders, by currency code. Two formatters paint
 * money: lib/money (Intl en-ZM: "K 42.50", "US$42.50") and lib/format's symbol
 * map (budget rows, recurring list, holdings: "K42.50", "$42.50", "R42.50",
 * "P42.50"). K is kwacha in both. A symbol missing here stays a mismatch.
 */
const SYMBOLS: Readonly<Record<string, string>> = {
  K: "ZMW", ZMW: "ZMW", "US$": "USD", USD: "USD", $: "USD", "€": "EUR", "£": "GBP", R: "ZAR", P: "BWP",
};
const RENDERED_MONEY = /^(-)?\s?(K|ZMW|US\$|USD|\$|€|£|R|P)\s?(\d[\d,]*\.\d{2})$/;

/**
 * Rendered money text ("K 42.50", "-K 25.00", "US$42.50"), matched in full,
 * as a money value. Text that is not exactly one known symbol and a 2-decimal
 * amount stays a mismatch (it is returned quoted, equal to no value).
 */
export function renderedMoney(text: string): string {
  const match = RENDERED_MONEY.exec(text.trim());
  if (!match) return `rendered ${JSON.stringify(text)}`;
  return moneyValue(`${match[1] ?? ""}${match[3]}`, SYMBOLS[match[2]]);
}

const DECIMAL = /^-?[\d,]*\d(\.\d+)?$/;
const MONEY = /^(-?[\d,]*\d(?:\.\d+)?) ([A-Z]{3}|\*)$/;

/** "650", "650.00" and "650.0" are one amount. */
function canonicalAmount(amount: string): string {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "").replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return `${sign}${digits}${decimals ? `.${decimals}` : ""}`;
}

interface Parsed { amount: string | null; currency: string | null; text: string }

function parse(value: string): Parsed {
  const text = value.trim();
  const money = MONEY.exec(text);
  if (money) return { amount: canonicalAmount(money[1]), currency: money[2], text };
  if (DECIMAL.test(text)) return { amount: canonicalAmount(text), currency: null, text };
  return { amount: null, currency: null, text };
}

export function sameValue(a: string, b: string): boolean {
  const left = parse(a), right = parse(b);
  if (left.amount === null || right.amount === null) return left.text === right.text;
  if (left.amount !== right.amount) return false;
  return left.currency === right.currency || left.currency === ANY_CURRENCY || right.currency === ANY_CURRENCY;
}

/** `value` with `reference`'s currency when it has none: a bare request amount sent alongside its currency. */
export function withCurrencyOf(value: string, reference: string): string {
  const own = parse(value), ref = parse(reference);
  if (own.amount === null || own.currency !== null || ref.currency === null) return value;
  return moneyValue(value, ref.currency);
}
