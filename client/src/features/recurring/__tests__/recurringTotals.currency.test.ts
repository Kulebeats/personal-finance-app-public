/**
 * FIN-05: recurring amounts whose unit is unknown (`currency: null`) or differs
 * from the display currency are never added to, or labelled as, its total.
 */
import { describe, expect, it } from "vitest";
import type { MoneyDto } from "@shared/money";
import { formatCurrency } from "@/lib/money";
import { sumInCurrency } from "../recurringTotals";

const dto = (amount: string, currency: string | null) => ({ amount, currency }) as unknown as MoneyDto;

describe("FIN-05 recurring totals by unit", () => {
  it("sums only amounts in the display currency and counts the rest", () => {
    const result = sumInCurrency([dto("7.25", "ZMW"), dto("50.00", null), dto("10.00", "USD"), dto("2.75", "ZMW")], "ZMW");
    expect(result).toEqual({ total: { amount: "10.00", currency: "ZMW" }, excludedCount: 2 });
  });

  it("labels an all-excluded total in the display currency, never the first rule's unit", () => {
    expect(sumInCurrency([dto("50.00", null)], "ZMW")).toEqual({ total: { amount: "0.00", currency: "ZMW" }, excludedCount: 1 });
    expect(sumInCurrency([], "USD")).toEqual({ total: { amount: "0.00", currency: "USD" }, excludedCount: 0 });
  });

  it("formats an amount with an unknown unit as a plain number instead of throwing", () => {
    expect(() => formatCurrency(dto("50.00", null))).not.toThrow();
    expect(formatCurrency(dto("50.00", null))).toBe("50.00");
  });
});
