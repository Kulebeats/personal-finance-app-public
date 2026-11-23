import { describe, it, expect, beforeEach, vi } from "vitest";

const { readInputs } = vi.hoisted(() => ({ readInputs: vi.fn() }));
vi.mock("../../repositories/InvestmentTaxRead", () => ({ readInvestmentTaxInputs: readInputs }));
const actor = { householdId: "house-1", userId: "user-1", role: "member" as const };

describe("InvestmentTaxService", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("includes realized gains from visible tax lot disposals in summary", async () => {
    readInputs.mockResolvedValueOnce({ activity: [
      { type: "interest", amount: "100.00", withholdingTax: "15.00", currency: "ZMW" },
      { type: "dividend", amount: "200.00", withholdingTax: "30.00", currency: "ZMW" },
    ], disposals: [
      { realizedGain: "50.00", realizedGainZmw: null, currency: "ZMW", basisCurrency: "ZMW" },
      { realizedGain: "25.00", realizedGainZmw: "25.00", currency: "ZMW", basisCurrency: "ZMW" },
    ], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    const summary = await investmentTaxService.getTaxSummary(actor, 2025);
    expect(summary.interestIncome).toBe("115.00");
    expect(summary.dividendIncome).toBe("230.00");
    expect(summary.totalWht).toBe("45.00");
    expect(summary.realizedGains).toBe("75.00");
    expect(summary.grossIncome).toBe("420.00");
    expect(summary.netIncome).toBe("375.00");
    expect(summary.currency).toBe("ZMW");
  });

  // NEW-23: a T-bill bought at face earns nothing, so the cron posts no
  // interest cash for it; a K0.00 interest row is the old, wrong posting.
  it("counts a zero-interest T-bill maturity that posted no interest cash as zero interest", async () => {
    readInputs.mockResolvedValueOnce({ activity: [{"id":"m1","type":"maturity","date":"2025-06-30","currency":"ZMW","amount":"5000.00","withholdingTax":"0.00","tbillCount":1,"tbillName":"ZERO_BILL","tbillFaceValue":"5000.00","tbillPurchasePrice":"5000.00","tbillIncomeCurrency":null,"tbillIncomeAmount":null}], disposals: [], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    const summary = await investmentTaxService.getTaxSummary(actor, 2025);
    expect(summary).toMatchObject({ interestIncome: "0.00", totalWht: "0.00", grossIncome: "0.00", netIncome: "0.00" });
  });

  it("refuses a zero-interest T-bill maturity that posted K0.00 interest cash", async () => {
    readInputs.mockResolvedValueOnce({ activity: [{"id":"m1","type":"maturity","date":"2025-06-30","currency":"ZMW","amount":"5000.00","withholdingTax":"0.00","tbillCount":1,"tbillName":"ZERO_BILL","tbillFaceValue":"5000.00","tbillPurchasePrice":"5000.00","tbillIncomeCurrency":"ZMW","tbillIncomeAmount":"0.00"}], disposals: [], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    await expect(investmentTaxService.getTaxSummary(actor, 2025)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("refuses a foreign income row whose proven rate is zero (NEW-23)", async () => {
    readInputs.mockResolvedValueOnce({ activity: [{ type: "interest", amount: "10.00", withholdingTax: "1.50", currency: "USD",
      fxProven: true, fxRate: "0", amountZmw: "0.00" }], disposals: [], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    await expect(investmentTaxService.getTaxSummary(actor, 2025)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("computes exact decimal totals when raw float addition would drift", async () => {
    readInputs.mockResolvedValueOnce({ activity: [
      { type: "interest", amount: "0.10", withholdingTax: "0.20", currency: "ZMW" },
      { type: "interest", amount: "0.20", withholdingTax: "0.10", currency: "ZMW" },
    ], disposals: [], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    const summary = await investmentTaxService.getTaxSummary(actor, 2025);
    expect(summary.interestIncome).toBe("0.60");
    expect(summary.totalWht).toBe("0.30");
    expect(summary.grossIncome).toBe("0.60");
    expect(summary.netIncome).toBe("0.30");
  });

  it("returns zero decimal strings when the actor has no visible investment sources", async () => {
    readInputs.mockResolvedValueOnce({ activity: [], disposals: [], bondSales: [] });
    const { investmentTaxService } = await import("../InvestmentTaxService");
    const summary = await investmentTaxService.getTaxSummary(actor, 2025);
    expect(summary.interestIncome).toBe("0.00");
    expect(summary.dividendIncome).toBe("0.00");
    expect(summary.realizedGains).toBe("0.00");
    expect(summary.grossIncome).toBe("0.00");
    expect(summary.totalWht).toBe("0.00");
    expect(summary.netIncome).toBe("0.00");
    expect(summary.currency).toBe("ZMW");
  });
});
