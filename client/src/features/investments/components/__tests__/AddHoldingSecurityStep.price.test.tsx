import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddHoldingSecurityStep } from "../AddHoldingSecurityStep";

// Existing holding-picker caller. Source-only: these assertions have not run.
// Native per-unit quote strings must not be rounded or relabelled as the
// household's display currency. This display never establishes actual fills.
describe("AddHoldingSecurityStep price evidence", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const rows = [
    { id: "usd", symbol: "USDLOCAL", name: "USD security", currency: "USD", currentPrice: "3.1415",
      valuationPrice: { source: "manual" as const, effectiveDate: "2026-11-01", validThrough: "2026-11-15" } },
    { id: "zmw", symbol: "ZMWLOCAL", name: "ZMW security", currency: "ZMW", currentPrice: "7.2718" },
    { id: "zero", symbol: "ZERO", name: "Zero reference price", currency: "USD", currentPrice: "0" },
    { id: "missing", symbol: "MISSING", name: "Missing price metadata", currency: "USD", currentPrice: null },
  ];
  function mount() {
    const select = vi.fn();
    render(<AddHoldingSecurityStep
      searchQuery=""
      onSearchQueryChange={vi.fn()}
      securities={rows}
      loadingSecurities={false}
      onSelectSecurity={select}
      onCreateNew={vi.fn()}
    />);
    return select;
  }

  it("shows each native currency and exact four-decimal price with its household validity", () => {
    mount();
    expect(screen.getByText("USD 3.1415")).toBeInTheDocument();
    expect(screen.getByText("ZMW 7.2718")).toBeInTheDocument();
    expect(screen.queryByText("ZMW 3.1415")).not.toBeInTheDocument();
    expect(screen.getByText("Household valuation price, valid through 2026-11-15")).toBeInTheDocument();
  });

  it("keeps zero distinct from a missing price and keeps metadata selectable", () => {
    const select = mount();
    expect(screen.getByText("USD 0")).toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /MISSING Missing price metadata/ }));
    expect(select).toHaveBeenCalledWith("missing");
    fireEvent.click(screen.getByRole("button", { name: /USDLOCAL USD security/ }));
    expect(select).toHaveBeenLastCalledWith("usd");
  });

  it("withdraws an expired mark at UTC midnight even without a query response", async () => {
    vi.setSystemTime(new Date("2026-11-15T23:59:59Z"));
    const select = mount();
    expect(screen.getByText("USD 3.1415")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText("USD 3.1415")).not.toBeInTheDocument();
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /USDLOCAL USD security/ }));
    expect(select).toHaveBeenCalledWith("usd");
  });
});
