import { describe, it, expect, beforeEach, vi } from "vitest";
import { differenceInCalendarDays } from "date-fns";

const mockDb = {
  select: vi.fn(),
};

vi.mock("../../db", () => ({
  db: mockDb,
}));

const createSelectQuery = (
  result: any,
  options: { orderBy?: boolean } = {}
) => {
  const query: any = {
    from: vi.fn().mockReturnThis(),
    where: options.orderBy ? vi.fn().mockReturnThis() : vi.fn().mockResolvedValue(result),
    orderBy: options.orderBy ? vi.fn().mockResolvedValue(result) : vi.fn().mockReturnThis(),
  };
  return query;
};

describe("InvestmentPerformanceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates time-weighted return index using cash flows", async () => {
    const accountsQuery = createSelectQuery([{ id: "acc-1" }]);
    const snapshotsQuery = createSelectQuery(
      [
        { date: "2024-01-01", balance: "1000" },
        { date: "2024-02-01", balance: "1300" },
        { date: "2024-03-01", balance: "1400" },
      ],
      { orderBy: true }
    );
    const flowsQuery = createSelectQuery([
      { date: "2024-01-15", type: "transfer_in", amount: "100", amountZmw: null },
      { date: "2024-02-15", type: "transfer_out", amount: "50", amountZmw: null },
    ]);

    mockDb.select
      .mockReturnValueOnce(accountsQuery)
      .mockReturnValueOnce(snapshotsQuery)
      .mockReturnValueOnce(flowsQuery);

    const { investmentPerformanceService } = await import(
      "../InvestmentPerformanceService"
    );

    const series = await investmentPerformanceService.gethistory(
      "house-1",
      "ALL"
    );

    expect(series).toHaveLength(3);

    const firstPeriodDays = differenceInCalendarDays(
      new Date("2024-02-01"),
      new Date("2024-01-01")
    );
    const firstWeight =
      differenceInCalendarDays(new Date("2024-02-01"), new Date("2024-01-15")) /
      firstPeriodDays;
    const firstWeightedFlow = 100 * firstWeight;
    const firstDenominator = 1000 + firstWeightedFlow;
    const firstReturn = (1300 - 1000 - 100) / firstDenominator;
    const expectedIndexAfterFirst = 100 * (1 + firstReturn);

    const secondPeriodDays = differenceInCalendarDays(
      new Date("2024-03-01"),
      new Date("2024-02-01")
    );
    const secondWeight =
      differenceInCalendarDays(new Date("2024-03-01"), new Date("2024-02-15")) /
      secondPeriodDays;
    const secondWeightedFlow = -50 * secondWeight;
    const secondDenominator = 1300 + secondWeightedFlow;
    const secondReturn = (1400 - 1300 - -50) / secondDenominator;
    const expectedIndexAfterSecond = expectedIndexAfterFirst * (1 + secondReturn);

    expect(series[1].twrIndex).toBeCloseTo(expectedIndexAfterFirst, 2);
    expect(series[2].twrIndex).toBeCloseTo(expectedIndexAfterSecond, 2);
    expect(series[2].twrReturnPercent).toBeCloseTo(
      expectedIndexAfterSecond - 100,
      2
    );
  });
});
