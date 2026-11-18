import { describe, it, expect, beforeEach, vi } from "vitest";

const mockDb = {
  select: vi.fn(),
  query: {
    holdings: {
      findMany: vi.fn(),
    },
  },
};

vi.mock("../../db", () => ({
  db: mockDb,
}));

// Mock getLatestFxRates from core/calculations (where it's actually imported from)
vi.mock("../../core/calculations", () => ({
  getLatestFxRates: vi.fn(),
}));

const createSelectQuery = (result: any) => {
  const query: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
  };
  return query;
};

describe("FXAttributionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses tax lots for cost basis and splits asset vs FX return", async () => {
    // Import the mocked function
    const { getLatestFxRates } = await import("../../core/calculations");
    (getLatestFxRates as any).mockResolvedValue(new Map([["USD", 25]]));

    mockDb.query.holdings.findMany.mockResolvedValue([
      {
        id: "holding-1",
        quantity: "10",
        costBasis: "900.00",
        costBasisZmw: "15000.00",
        acquisitionFxRate: "15.0",
        security: {
          id: "sec-1",
          name: "Example Corp",
          symbol: "EXM",
          currency: "USD",
          currentPrice: "120.00",
        },
      },
    ]);

    mockDb.select.mockReturnValueOnce(
      createSelectQuery([
        {
          holdingId: "holding-1",
          costBasis: "1000.00",
          costBasisZmw: "20000.00",
          quantity: "10",
          acquisitionFxRate: "20.0",
          acquiredDate: "2024-01-01",
        },
      ])
    );

    const { fxAttributionService } = await import("../FXAttributionService");

    const results = await fxAttributionService.calculateAttribution(
      "house-1",
      "ZMW"
    );

    expect(results).toHaveLength(1);
    const result = results[0];

    expect(result.costBasis).toBeCloseTo(20000, 2);
    expect(result.currentValue).toBeCloseTo(30000, 2);
    expect(result.totalGain).toBeCloseTo(10000, 2);
    expect(result.assetReturn).toBeCloseTo(4000, 2);
    expect(result.fxReturn).toBeCloseTo(6000, 2);
    expect(result.totalReturnPercent).toBeCloseTo(50, 2);
  });
});
