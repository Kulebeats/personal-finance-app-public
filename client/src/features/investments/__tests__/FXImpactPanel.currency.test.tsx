/**
 * A-31: FX attribution figures are in ZMW (the server's FX base), so they are
 * formatted as ZMW whatever display currency the member chose. A USD display
 * setting must not put a dollar sign on a kwacha amount.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FXImpactPanel } from "../components/FXImpactPanel";
import type { AttributionResult } from "@/hooks/useInvestments";

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
// Defect 10: amounts arrive as ZMW MoneyDto decimal strings.
const attribution: AttributionResult[] = [{
  holdingId: "h-1", securityName: "Acme Corp", symbol: "ACME", currency: "USD",
  currentValue: zmw("1150.00"), costBasis: zmw("1000.00"), totalGain: zmw("150.00"), assetReturn: zmw("100.00"),
  fxReturn: zmw("50.00"), totalReturnPercent: 15, assetReturnPercent: 10, fxReturnPercent: 5,
}];

vi.mock("@/hooks/use-settings", () => ({
  useDisplaySettings: () => ({ data: { currency: "USD", numberFormat: "US" } }),
}));
vi.mock("@/hooks/useInvestments", () => ({
  useFXAttribution: () => ({ data: attribution, isLoading: false }),
  useFXHistorical: () => ({ data: [], isLoading: false }),
}));
vi.mock("../components/FXHistoryChart", () => ({ FXHistoryChart: () => null }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: () => null, Pie: () => null, Cell: () => null, Tooltip: () => null, Legend: () => null,
}));

describe("FXImpactPanel currency (A-31)", () => {
  it("formats every attribution figure as ZMW when the display currency is USD", () => {
    render(<FXImpactPanel />);

    // Summary cards and the holding row: total gain, asset return, FX return.
    expect(screen.getAllByText("K150.00")).toHaveLength(2);
    expect(screen.getAllByText("K100.00")).toHaveLength(2);
    expect(screen.getAllByText("K50.00")).toHaveLength(2);
    expect(screen.queryAllByText(/\$\d/)).toHaveLength(0);
  });

  it("totals MoneyDto amounts across holdings in decimal (defect 10)", () => {
    attribution.push({
      holdingId: "h-2", securityName: "Beta Ltd", symbol: "BETA", currency: "GBP",
      currentValue: zmw("200.20"), costBasis: zmw("200.00"), totalGain: zmw("0.20"), assetReturn: zmw("0.10"),
      fxReturn: zmw("0.10"), totalReturnPercent: 0.1, assetReturnPercent: 0.05, fxReturnPercent: 0.05,
    });
    try {
      render(<FXImpactPanel />);
      // 150.00 + 0.20, 100.00 + 0.10 and 50.00 + 0.10: totals, never concatenated strings.
      expect(screen.getByText("K150.20")).toBeInTheDocument();
      expect(screen.getByText("K100.10")).toBeInTheDocument();
      expect(screen.getByText("K50.10")).toBeInTheDocument();
      // 150.20 / 1200.00 = 12.52 %.
      expect(screen.getByText(/12\.52%/)).toBeInTheDocument();
    } finally {
      attribution.pop();
    }
  });
});
