import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { type MoneyDto } from "@shared/money";
import { parseMoneyString } from "./money";

/**
 * Parse monetary values with Decimal precision.
 * Uses parseMoneyString internally to avoid parseFloat precision issues.
 */
export function parseMoney(
  value: MoneyDto | string | number | undefined | null
): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") {
    const decimal = parseMoneyString(value);
    return decimal.toNumber();
  }
  if (typeof value === "string") {
    const decimal = parseMoneyString(value);
    return decimal.toNumber();
  }
  if (typeof value === "object" && "amount" in value) {
    const decimal = parseMoneyString(value.amount);
    return decimal.toNumber();
  }
  return 0;
}
