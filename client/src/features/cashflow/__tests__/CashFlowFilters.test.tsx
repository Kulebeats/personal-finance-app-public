import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashFlowFilters } from "../components/CashFlowFilters";
import type { CashFlowFiltersState } from "../types";

describe("CashFlowFilters", () => {
  const defaultFilters: CashFlowFiltersState = {
    from: "2026-01-01",
    to: "2026-12-31",
    interval: "month",
    scope: "household",
    includePending: false,
    includeTransfers: false,
    includeForecast: false,
    forecastMonths: 3,
  };

  let mockOnFiltersChange: Mock;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockOnFiltersChange = vi.fn();
    user = userEvent.setup();
  });

  it("should open filter dialog when button is clicked", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    const filterButton = screen.getByRole("button", { name: /filter/i });
    await user.click(filterButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Filter Cash Flow")).toBeInTheDocument();
  });

  it("should show active filter count badge", () => {
    const modifiedFilters: CashFlowFiltersState = {
      ...defaultFilters,
      includePending: true,
      includeTransfers: true,
    };

    render(
      <CashFlowFilters
        filters={modifiedFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    const filterButton = screen.getByRole("button", { name: /filter/i });
    // Should show "2" badge for 2 modified filters
    expect(within(filterButton).getByText("2")).toBeInTheDocument();
  });

  it("should apply date range filter", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    const filterButton = screen.getByRole("button", { name: /filter/i });
    await user.click(filterButton);

    // Apply button should exist
    const applyButton = screen.getByRole("button", { name: /apply filters/i });
    await user.click(applyButton);

    // Dialog should close and filters should be applied
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockOnFiltersChange).toHaveBeenCalledWith(defaultFilters);
  });

  it("should toggle pending transactions", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Find and toggle pending transactions switch
    const pendingSwitch = screen.getByRole("switch", {
      name: /include pending transactions/i,
    });
    expect(pendingSwitch).not.toBeChecked();

    await user.click(pendingSwitch);
    expect(pendingSwitch).toBeChecked();

    // Apply changes
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      ...defaultFilters,
      includePending: true,
    });
  });

  it("should toggle transfer inclusion", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Find and toggle transfers switch
    const transfersSwitch = screen.getByRole("switch", {
      name: /include transfers/i,
    });
    expect(transfersSwitch).not.toBeChecked();

    await user.click(transfersSwitch);
    expect(transfersSwitch).toBeChecked();

    // Apply changes
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      ...defaultFilters,
      includeTransfers: true,
    });
  });

  it("should reset to defaults", async () => {
    const modifiedFilters: CashFlowFiltersState = {
      ...defaultFilters,
      includePending: true,
      includeTransfers: true,
      interval: "week",
    };

    render(
      <CashFlowFilters
        filters={modifiedFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Click reset button
    const resetButton = screen.getByRole("button", {
      name: /reset to defaults/i,
    });
    await user.click(resetButton);

    // Apply the reset filters
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    expect(mockOnFiltersChange).toHaveBeenCalledWith(defaultFilters);
  });

  it("should disable forecast for non-monthly intervals", async () => {
    const monthlyFilters: CashFlowFiltersState = {
      ...defaultFilters,
      interval: "month",
      includeForecast: true,
    };

    render(
      <CashFlowFilters
        filters={monthlyFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Forecast switch should be visible for monthly interval
    expect(
      screen.getByRole("switch", { name: /include forecast/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /include forecast/i })
    ).toBeChecked();

    // Change interval to week. The Radix Select trigger has no accessible name
    // in jsdom, so locate the combobox via its section label.
    const groupByLabel = screen.getByText("Group By");
    const groupBySection = groupByLabel.closest("div");
    if (!groupBySection) throw new Error("Group By section not found");
    const intervalSelect = within(groupBySection).getByRole("combobox");
    await user.click(intervalSelect);

    const weekOption = screen.getByRole("option", { name: /week/i });
    await user.click(weekOption);

    // Forecast switch should disappear for weekly interval
    expect(
      screen.queryByRole("switch", { name: /include forecast/i })
    ).not.toBeInTheDocument();

    // Apply changes
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    // Forecast should be disabled when switching away from monthly
    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      ...monthlyFilters,
      interval: "week",
      includeForecast: false, // Auto-disabled
    });
  });

  it("should show forecast horizon selector when forecast is enabled", async () => {
    render(
      <CashFlowFilters
        filters={{ ...defaultFilters, interval: "month" }}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Forecast horizon should not be visible initially. The Radix Select
    // trigger has no accessible name in jsdom, so assert on its section label.
    expect(screen.queryByText("Forecast Horizon")).not.toBeInTheDocument();

    // Enable forecast
    const forecastSwitch = screen.getByRole("switch", {
      name: /include forecast/i,
    });
    await user.click(forecastSwitch);

    // Forecast horizon selector should now appear. Locate the combobox via its
    // section label since the trigger has no accessible name.
    const horizonLabel = await screen.findByText("Forecast Horizon");
    const horizonSection = horizonLabel.closest("div");
    if (!horizonSection) throw new Error("Forecast Horizon section not found");
    expect(within(horizonSection).getByRole("combobox")).toBeInTheDocument();
  });

  it("should cancel changes without applying", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Toggle a switch
    const pendingSwitch = screen.getByRole("switch", {
      name: /include pending transactions/i,
    });
    await user.click(pendingSwitch);
    expect(pendingSwitch).toBeChecked();

    // Cancel without applying
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // Dialog should close
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Filters should NOT be applied
    expect(mockOnFiltersChange).not.toHaveBeenCalled();
  });

  it("should change scope filter", async () => {
    render(
      <CashFlowFilters
        filters={defaultFilters}
        onFiltersChange={mockOnFiltersChange}
        defaultFilters={defaultFilters}
      />
    );

    // Open dialog
    await user.click(screen.getByRole("button", { name: /filter/i }));

    // Change scope. The Radix Select trigger has no accessible name in jsdom,
    // so locate the combobox via its section label.
    const scopeLabel = screen.getByText("Show Data For");
    const scopeSection = scopeLabel.closest("div");
    if (!scopeSection) throw new Error("Show Data For section not found");
    const scopeSelect = within(scopeSection).getByRole("combobox");
    await user.click(scopeSelect);

    const mineOption = screen.getByRole("option", {
      name: /only my transactions/i,
    });
    await user.click(mineOption);

    // Apply changes
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      ...defaultFilters,
      scope: "mine",
    });
  });
});
