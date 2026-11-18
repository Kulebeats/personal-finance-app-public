import { describe, it, expect, beforeEach, vi } from "vitest";

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
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: options.orderBy ? vi.fn().mockReturnThis() : vi.fn().mockResolvedValue(result),
    orderBy: options.orderBy ? vi.fn().mockResolvedValue(result) : vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return query;
};

describe("InvestmentTaxService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes realized gains from tax lot disposals in summary", async () => {
    const accountsQuery = createSelectQuery([{ id: "acc-1" }]);
    const txQuery = createSelectQuery([
      { type: "interest", amount: "100.00", withholdingTax: "15.00" },
      { type: "dividend", amount: "200.00", withholdingTax: "30.00" },
    ]);
    const disposalsQuery = createSelectQuery([
      { realizedGain: "50.00", realizedGainZmw: null },
      { realizedGain: "20.00", realizedGainZmw: "25.00" },
    ]);

    mockDb.select
      .mockReturnValueOnce(accountsQuery)
      .mockReturnValueOnce(txQuery)
      .mockReturnValueOnce(disposalsQuery);

    const { investmentTaxService } = await import("../InvestmentTaxService");

    const summary = await investmentTaxService.getTaxSummary("house-1", 2025);

    // Decimal-string DTO (MoneyDto convention) - not JS numbers - so exact
    // regulatory amounts never pick up IEEE-754 float error on serialization.
    expect(summary.interestIncome).toBe("115.00");
    expect(summary.dividendIncome).toBe("230.00");
    expect(summary.totalWht).toBe("45.00");
    expect(summary.realizedGains).toBe("75.00");
    expect(summary.grossIncome).toBe("420.00");
    expect(summary.netIncome).toBe("375.00");
    expect(summary.currency).toBe("ZMW");
  });

  it("computes exact decimal totals when raw float addition would drift", async () => {
    // 0.10 + 0.20 === 0.30000000000000004 in JS; 0.20 + 0.10 also drifts.
    // A Decimal/Money-backed computation must land on the exact values.
    const accountsQuery = createSelectQuery([{ id: "acc-1" }]);
    const txQuery = createSelectQuery([
      { type: "interest", amount: "0.10", withholdingTax: "0.20" },
      { type: "interest", amount: "0.20", withholdingTax: "0.10" },
    ]);
    const disposalsQuery = createSelectQuery([]);

    mockDb.select
      .mockReturnValueOnce(accountsQuery)
      .mockReturnValueOnce(txQuery)
      .mockReturnValueOnce(disposalsQuery);

    const { investmentTaxService } = await import("../InvestmentTaxService");

    const summary = await investmentTaxService.getTaxSummary("house-1", 2025);

    expect(summary.interestIncome).toBe("0.60");
    expect(summary.totalWht).toBe("0.30");
    expect(summary.grossIncome).toBe("0.60");
    expect(summary.netIncome).toBe("0.30");
  });

  it("returns zero decimal strings when the household has no investment accounts", async () => {
    const accountsQuery = createSelectQuery([]);
    mockDb.select.mockReturnValueOnce(accountsQuery);

    const { investmentTaxService } = await import("../InvestmentTaxService");

    const summary = await investmentTaxService.getTaxSummary("house-1", 2025);

    expect(summary.interestIncome).toBe("0.00");
    expect(summary.dividendIncome).toBe("0.00");
    expect(summary.realizedGains).toBe("0.00");
    expect(summary.grossIncome).toBe("0.00");
    expect(summary.totalWht).toBe("0.00");
    expect(summary.netIncome).toBe("0.00");
    expect(summary.currency).toBe("ZMW");
  });
});
