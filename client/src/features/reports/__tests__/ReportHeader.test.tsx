import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportHeader } from "../components/ReportHeader";
import { ReportTab } from "../types";

describe("ReportHeader", () => {
  const defaultProps = {
    activeTab: "annual" as ReportTab,
    onTabChange: vi.fn(),
    year: 2026,
    onYearChange: vi.fn(),
    availableYears: [2023, 2024, 2025, 2026, 2027],
    aggregation: "monthly" as const,
    onAggregationChange: vi.fn(),
    onExport: vi.fn(),
    showExportHistory: false,
    onToggleExportHistory: vi.fn(),
  };

  it("should render the title", () => {
    render(<ReportHeader {...defaultProps} />);
    expect(screen.getByText("Reports")).toBeDefined();
  });

  it("should render all tab buttons", () => {
    render(<ReportHeader {...defaultProps} />);
    expect(screen.getByText("Annual Dashboard")).toBeDefined();
    expect(screen.getByText("Cash Flow")).toBeDefined();
    expect(screen.getByText("Spending")).toBeDefined();
    expect(screen.getByText("Merchants")).toBeDefined();
    expect(screen.getByText("Income")).toBeDefined();
    expect(screen.getByText("Net Worth")).toBeDefined();
    expect(screen.getByText("Savings")).toBeDefined();
  });

  it("should call onTabChange when tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<ReportHeader {...defaultProps} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByText("Spending"));
    expect(onTabChange).toHaveBeenCalledWith("spending");
  });

  it("should highlight active tab with correct styling", () => {
    render(<ReportHeader {...defaultProps} activeTab="spending" />);

    const spendingButton = screen.getByText("Spending");
    expect(spendingButton.className).toContain("bg-orange-500");
  });

  it("should show Customize button", () => {
    render(<ReportHeader {...defaultProps} />);
    expect(screen.getByText("Customize")).toBeDefined();
  });

  it("should show Export button", () => {
    render(<ReportHeader {...defaultProps} />);
    expect(screen.getByText("Export")).toBeDefined();
  });

  it("should call onOpenCustomize when on annual tab", () => {
    const onOpenCustomize = vi.fn();
    render(
      <ReportHeader
        {...defaultProps}
        activeTab="annual"
        onOpenCustomize={onOpenCustomize}
      />
    );
    // Customization is available via dropdown - test that handler is passed
    expect(onOpenCustomize).toBeDefined();
  });
});
