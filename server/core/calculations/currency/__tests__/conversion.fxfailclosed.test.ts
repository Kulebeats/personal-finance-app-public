/**
 * SCP-321: FX conversion must FAIL CLOSED on a missing rate (never silently use
 * rate=1, which corrupts multi-currency totals).
 */
import { describe, it, expect } from "vitest";
import {
  aggregateMultiCurrency,
  convertBatchToDisplayCurrency,
} from "../conversion";
import { CalculationError } from "../../errors";

function stubFx(rates: Record<string, number>) {
  return {
    getLatestRatesMap: async (currencies: string[]) => {
      const m = new Map<string, number>();
      for (const c of currencies) {
        const u = c.toUpperCase();
        if (rates[u] !== undefined) m.set(u, rates[u]);
      }
      return m;
    },
  } as never;
}

describe("FX conversion fail-closed (SCP-321)", () => {
  it("aggregateMultiCurrency throws on a missing rate (no silent rate=1)", async () => {
    await expect(
      aggregateMultiCurrency(
        stubFx({}), // EUR rate missing
        [
          { amount: 1000, currency: "USD" },
          { amount: 1000, currency: "EUR" },
        ],
        "USD",
      ),
    ).rejects.toThrow(CalculationError);
  });

  it("aggregateMultiCurrency totals correctly when rates are present", async () => {
    const result = await aggregateMultiCurrency(
      stubFx({ EUR: 1.1 }),
      [
        { amount: 1000, currency: "USD" },
        { amount: 1000, currency: "EUR" },
      ],
      "USD",
    );
    expect(result.total).toBe(2100); // 1000*1 + 1000*1.1, not a silent 2000
  });

  it("convertBatchToDisplayCurrency throws on a missing rate", async () => {
    await expect(
      convertBatchToDisplayCurrency(
        stubFx({}),
        [{ amount: 500, currency: "EUR" }],
        "USD",
      ),
    ).rejects.toThrow(CalculationError);
  });

  it("same-currency conversion does not throw and is exact", async () => {
    const result = await convertBatchToDisplayCurrency(
      stubFx({}),
      [{ amount: 500, currency: "USD" }],
      "USD",
    );
    expect(result[0]).toBe(500);
  });
});
