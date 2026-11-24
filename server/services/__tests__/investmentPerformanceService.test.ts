import { describe, it, expect } from "vitest";
import { differenceInCalendarDays } from "date-fns";
import { buildPerformanceSeries } from "../InvestmentPerformanceSeries";

describe("buildPerformanceSeries", () => {
  it("keeps exact cents and the reporting currency when the aggregate exceeds safe numeric cents", () => {
    const snapshots = Array.from({ length: 10 }, () => ({ date: "2024-01-01", balance: "9007199254740.99" }));
    const series = buildPerformanceSeries([
      ...snapshots,
      { date: "2024-01-01", balance: "0.03" },
      { date: "2024-01-02", balance: "7.12" },
    ], [], "USD");

    expect(series.map(point => point.value)).toEqual([
      { amount: "90071992547409.93", currency: "USD" },
      { amount: "7.12", currency: "USD" },
    ]);
  });

  it("calculates time-weighted return index using cash flows", () => {
    const series = buildPerformanceSeries(
      [
        { date: "2024-01-01", balance: "1000" },
        { date: "2024-02-01", balance: "1300" },
        { date: "2024-03-01", balance: "1400" },
      ],
      [
        { date: "2024-01-15", type: "transfer_in", amount: "100" },
        { date: "2024-02-15", type: "transfer_out", amount: "50" },
      ],
      "ZMW",
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

  it("sums balances on the same date exactly and orders dates", () => {
    const series = buildPerformanceSeries(
      [
        { date: "2024-01-02", balance: "0.20" },
        { date: "2024-01-01", balance: "0.10" },
        { date: "2024-01-01", balance: "0.20" },
      ],
      [],
      "ZMW",
    );

    expect(series.map(point => [point.date, point.value])).toEqual([
      ["2024-01-01", { amount: "0.30", currency: "ZMW" }],
      ["2024-01-02", { amount: "0.20", currency: "ZMW" }],
    ]);
    expect(series[0]).toMatchObject({ twrIndex: 100, twrReturnPercent: 0 });
  });

  it("returns an empty series for no snapshots", () => {
    expect(buildPerformanceSeries([], [], "ZMW")).toEqual([]);
  });
});
