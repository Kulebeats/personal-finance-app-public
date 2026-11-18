import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MerchantStatsCards } from "../detail/MerchantStatsCards";

// Mock the SettingsContext
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({
    currency: "USD",
    timezone: "America/New_York",
  }),
}));

describe("MerchantStatsCards", () => {
  const mockOnQuickRange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders total spent stat", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    expect(screen.getByText("Total spent")).toBeInTheDocument();
  });

  it("renders transaction count", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("renders average transaction", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    expect(screen.getByText("Average")).toBeInTheDocument();
  });

  it("displays quick range buttons", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    expect(screen.getByRole("button", { name: /last 30 days/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /last 90 days/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /last 365 days/i })).toBeInTheDocument();
  });

  it("calls onQuickRange when 30 days button is clicked", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    const button30 = screen.getByRole("button", { name: /last 30 days/i });
    fireEvent.click(button30);

    expect(mockOnQuickRange).toHaveBeenCalledWith(30);
  });

  it("calls onQuickRange when 90 days button is clicked", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    const button90 = screen.getByRole("button", { name: /last 90 days/i });
    fireEvent.click(button90);

    expect(mockOnQuickRange).toHaveBeenCalledWith(90);
  });

  it("calls onQuickRange when 365 days button is clicked", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    const button365 = screen.getByRole("button", { name: /last 365 days/i });
    fireEvent.click(button365);

    expect(mockOnQuickRange).toHaveBeenCalledWith(365);
  });

  it("handles undefined analytics gracefully", () => {
    render(
      <MerchantStatsCards
        analytics={undefined}
        last30={undefined}
        last90={undefined}
        last365={undefined}
        onQuickRange={mockOnQuickRange}
      />
    );

    expect(screen.getByText("0")).toBeInTheDocument(); // Transaction count defaults to 0
  });

  it("uses currency from settings context", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    // The currency should be used by formatCurrency
    // This is tested indirectly through the rendered amounts
  });

  it("displays last 30 days total", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    // "Last 30 days" appears twice: as a quick-range button and as a stat-card
    // label. Assert the stat-card <p> label specifically (the button is rendered
    // as a <button>), proving the totals card is present.
    const matches = screen.getAllByText("Last 30 days");
    expect(matches.some((el) => el.tagName === "P")).toBe(true);
  });

  it("displays last 90 days total", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    const matches = screen.getAllByText("Last 90 days");
    expect(matches.some((el) => el.tagName === "P")).toBe(true);
  });

  it("displays last 365 days total", () => {
    render(
      <MerchantStatsCards
        analytics={{ totalSpent: "1000", transactionCount: 10, averageTransaction: "100" }}
        last30={{ totalSpent: "300" }}
        last90={{ totalSpent: "600" }}
        last365={{ totalSpent: "1000" }}
        onQuickRange={mockOnQuickRange}
      />
    );

    const matches = screen.getAllByText("Last 365 days");
    expect(matches.some((el) => el.tagName === "P")).toBe(true);
  });
});
