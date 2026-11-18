import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportHistory } from "../components/ExportHistory";

// Mock the use-reports hook
vi.mock("@/hooks/use-reports", () => ({
  getReportsExportDownloadUrl: vi.fn(
    (id) => `/api/reports/exports/${id}?download=true`
  ),
}));

describe("ExportHistory", () => {
  const mockExports = [
    {
      id: "exp-1",
      userId: "user-1",
      householdId: "household-1",
      exportType: "annual",
      fileFormat: "csv",
      status: "completed" as const,
      dateRangeStart: "2026-01-01",
      dateRangeEnd: "2026-12-31",
      recordCount: 1234,
      createdAt: "2026-01-11T10:00:00Z",
    },
    {
      id: "exp-2",
      userId: "user-1",
      householdId: "household-1",
      exportType: "spending_breakdown",
      fileFormat: "csv",
      status: "pending" as const,
      dateRangeStart: "2026-01-01",
      dateRangeEnd: "2026-01-31",
      recordCount: null,
      createdAt: "2026-01-10T15:30:00Z",
    },
    {
      id: "exp-3",
      userId: "user-1",
      householdId: "household-1",
      exportType: "cashflow",
      fileFormat: "csv",
      status: "failed" as const,
      dateRangeStart: null,
      dateRangeEnd: null,
      recordCount: null,
      createdAt: "2026-01-09T08:00:00Z",
    },
  ];

  it("should render loading state", () => {
    render(<ExportHistory exports={[]} isLoading={true} onClose={vi.fn()} />);
    expect(screen.getByText("Loading export history...")).toBeDefined();
  });

  it("should render empty state when no exports", () => {
    render(<ExportHistory exports={[]} isLoading={false} onClose={vi.fn()} />);
    expect(screen.getByText(/No exports yet/)).toBeDefined();
  });

  it("should render export table with items", () => {
    render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("annual")).toBeDefined();
    expect(screen.getByText("spending_breakdown")).toBeDefined();
    expect(screen.getByText("cashflow")).toBeDefined();
  });

  it("should display record counts", () => {
    render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("1234")).toBeDefined();
  });

  it("should show download button for completed exports", () => {
    render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={vi.fn()}
      />
    );

    const downloadButtons = screen.getAllByText("Download");
    expect(downloadButtons.length).toBe(1); // Only one completed export
  });

  it("should call onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("should display status badges with correct styling", () => {
    const { container } = render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={vi.fn()}
      />
    );

    // Completed should be green
    expect(container.querySelector(".text-emerald-700")).not.toBeNull();
    // Failed should be red
    expect(container.querySelector(".text-rose-700")).not.toBeNull();
  });

  it("should format date ranges correctly", () => {
    render(
      <ExportHistory
        exports={mockExports}
        isLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("2026-01-01 to 2026-12-31")).toBeDefined();
    expect(screen.getByText("All time")).toBeDefined(); // For null dates
  });
});
