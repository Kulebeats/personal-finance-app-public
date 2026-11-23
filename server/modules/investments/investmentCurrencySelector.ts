import { ValidationError } from "../../core/errors";

/** Both public spellings describe one display unit. An explicit invalid token
 * cannot fall back to the household default or win by appearing first. */
export function investmentCurrencySelector(query: Record<string, unknown>): string | undefined {
  if (Object.keys(query).some(key => /^(?:currency|baseCurrency)\[/.test(key))) {
    throw new ValidationError("Invalid currency selection");
  }
  const token = (name: "currency" | "baseCurrency") => {
    if (!Object.prototype.hasOwnProperty.call(query, name)) return undefined;
    const value = query[name];
    if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
      throw new ValidationError("Invalid currency selection");
    }
    return value.trim().toUpperCase();
  };
  const currency = token("currency"), baseCurrency = token("baseCurrency");
  if (currency !== undefined && baseCurrency !== undefined && currency !== baseCurrency) {
    throw new ValidationError("Conflicting currency selections");
  }
  return currency ?? baseCurrency;
}
