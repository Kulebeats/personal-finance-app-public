import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { HoldingReadSession } from "../../modules/investments/investmentHoldingRead";

// NEW-21: attribution reads through the visible-holdings read (custody, the
// household price, the locked session), so the unit seam is that read, not the
// database. The real-DB HTTP coverage is completion-r13.fx-attribution.
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("../../modules/investments/investmentHoldingRead", () => ({
  valueVisibleHoldings: vi.fn(async (_caller: unknown, _session: unknown, _filters: unknown,
    calculate: (visible: unknown[]) => Promise<unknown>) => calculate(rows.current)),
}));
vi.mock("../../core/calculations", () => ({ getLatestFxRates: vi.fn() }));

const caller = { householdId: "house-1", userId: "user-1", role: "owner" } as HouseholdContext;
const session = { sessionId: "sid-1" } as HoldingReadSession;
const row = (holding: Record<string, unknown>, security: Record<string, unknown>) => ({
  holding: { id: "holding-1", acquisitionFxRate: null, ...holding },
  security: { id: "sec-1", name: "Example Corp", symbol: "EXM", ...security },
});

describe("FXAttributionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Defect 10: every amount is a ZMW MoneyDto (decimal string), never a number.
  const zmw = (amount: string) => ({ amount, currency: "ZMW" });

  // Updated for NEW-21: the cost is the holding's stored remaining basis (the
  // writers keep costBasis/costBasisZmw at the remaining FIFO cost), not a sum
  // of every tax lot, which also counted sold lots. The figures are lane 5's.
  it("uses the stored ZMW basis and splits asset vs FX return", async () => {
    const { getLatestFxRates } = await import("../../core/calculations");
    vi.mocked(getLatestFxRates).mockResolvedValue(new Map([["USD", 25]]));
    rows.current = [row({ quantity: "10", costBasis: "1000.00", costBasisZmw: "20000.00", acquisitionFxRate: "20.0" },
      { currency: "USD", currentPrice: "120.00" })];

    const { fxAttributionService } = await import("../FXAttributionService");
    const results = await fxAttributionService.calculateAttribution(caller, session);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ costBasis: zmw("20000.00"), currentValue: zmw("30000.00"),
      totalGain: zmw("10000.00"), assetReturn: zmw("4000.00"), fxReturn: zmw("6000.00"), totalReturnPercent: 50 });
  });

  // P2 (lane 5, #302): Decimal arithmetic, rounded half-up once at the end. A
  // float 1.005 is 1.00499..., so float toFixed(2) gave 1.00, and a 0.005 gain gave 0.00.
  it("keeps half-cent values exact and rounds them half-up", async () => {
    const { getLatestFxRates } = await import("../../core/calculations");
    vi.mocked(getLatestFxRates).mockResolvedValue(new Map());
    rows.current = [row({ id: "holding-2", quantity: "1", costBasis: "1.00", costBasisZmw: "1.00" },
      { id: "sec-2", name: "Half Cent", symbol: "HLF", currency: "ZMW", currentPrice: "1.0050" })];

    const { fxAttributionService } = await import("../FXAttributionService");
    const [result] = await fxAttributionService.calculateAttribution(caller, session);

    expect(result).toMatchObject({
      currentValue: zmw("1.01"), costBasis: zmw("1.00"), totalGain: zmw("0.01"), assetReturn: zmw("0.01"), fxReturn: zmw("0.00"),
      totalReturnPercent: 0.5, assetReturnPercent: 0.5, fxReturnPercent: 0,
    });
  });

  // A 0.00 basis is valid (a gift). decimal.js isPositive() is true for zero, so
  // the percentages must not divide by it: Infinity would reach the client as null.
  it.each([
    ["ZMW", new Map<string, number>(), "1", "10.00", "10.00"],
    ["USD", new Map([["USD", 25]]), "2", "5.00", "250.00"],
  ])("reports finite zero percentages on a %s holding with a 0.00 basis", async (currency, rates, quantity, price, value) => {
    const { getLatestFxRates } = await import("../../core/calculations");
    vi.mocked(getLatestFxRates).mockResolvedValue(rates);
    rows.current = [row({ quantity, costBasis: "0.00", costBasisZmw: "0.00" }, { currency, currentPrice: price })];

    const { fxAttributionService } = await import("../FXAttributionService");
    const [result] = await fxAttributionService.calculateAttribution(caller, session);

    expect(result).toMatchObject({ currentValue: zmw(value), costBasis: zmw("0.00"), totalGain: zmw(value),
      assetReturn: zmw(value), fxReturn: zmw("0.00"),
      totalReturnPercent: 0, assetReturnPercent: 0, fxReturnPercent: 0 });
    // What the client receives: a number, never the null that Infinity serialises to.
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ totalReturnPercent: 0, assetReturnPercent: 0, fxReturnPercent: 0 });
  });

  it("refuses a foreign cost with no ZMW base instead of reporting it as ZMW", async () => {
    const { getLatestFxRates } = await import("../../core/calculations");
    vi.mocked(getLatestFxRates).mockResolvedValue(new Map([["USD", 25]]));
    rows.current = [row({ quantity: "9", costBasis: "180.00", costBasisZmw: null }, { currency: "USD", currentPrice: "25.00" })];

    const { fxAttributionService } = await import("../FXAttributionService");
    await expect(fxAttributionService.calculateAttribution(caller, session)).rejects.toMatchObject({ statusCode: 422 });
  });
});
