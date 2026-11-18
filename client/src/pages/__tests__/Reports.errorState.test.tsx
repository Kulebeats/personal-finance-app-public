/**
 * Reports Page - top-level query error state (audit v2 P7b finding #1)
 *
 * Reports.tsx used to swallow every report query's `error`: on failure the
 * page rendered a blank chart with no visible error and no retry, so a user
 * couldn't tell "broken" from "no data yet". This proves the page now shows
 * a real error state (reusing the shared WidgetErrorState component already
 * used by every dashboard widget) with a working retry that refetches the
 * failed query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Reports from "@/pages/Reports";

const refetchIncome = vi.fn();

vi.mock("@/hooks/use-drilldown", () => ({
  useDrillDown: () => ({ drillDown: vi.fn() }),
}));

vi.mock("@/hooks/use-reports", () => ({
  useReportsSankey: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useReportsSpendingBreakdown: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
  // The "Income" tab reads cashflow data. Fail it to exercise the
  // top-level error state.
  useReportsCashflow: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: new Error("Failed to load cash flow data"),
    refetch: refetchIncome,
  })),
  useReportsNetWorth: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useReportsSavingsRate: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useReportsExports: vi.fn(() => ({ data: { exports: [] }, isLoading: false, error: null, refetch: vi.fn() })),
  useReportsSpendingTrend: vi.fn(() => ({ data: null, isLoading: false })),
  useCurrentYearRange: vi.fn(() => ({
    from: "2026-01-01",
    to: "2026-12-31",
    year: 2026,
  })),
  useCurrentMonthRange: vi.fn(() => ({ from: "2026-01-01", to: "2026-01-31" })),
  useLastNMonthsRange: vi.fn(() => ({ from: "2025-10-01", to: "2026-01-31" })),
  getReportsExportDownloadUrl: vi.fn((id) => `/api/reports/exports/${id}?download=true`),
}));

vi.mock("@/hooks/use-settings", () => ({
  useMerchants: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/hooks/use-report-widget-preferences", () => ({
  useWidgetOnboarding: vi.fn(() => ({
    hasCompletedSetup: true,
    completeOnboarding: vi.fn(),
    isLoading: false,
  })),
  useReportWidgetPreferences: vi.fn(() => ({
    data: { coreWidgets: {}, optionalWidgets: {} },
    isLoading: false,
  })),
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/reports/AnnualDashboard", () => ({
  default: () => <div>Annual Dashboard</div>,
}));

vi.mock("@/components/reports/WidgetGalleryModal", () => ({
  WidgetGalleryModal: () => null,
}));

vi.mock("@/components/reports/WidgetOnboardingModal", () => ({
  WidgetOnboardingModal: () => null,
}));

const renderReports = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Reports />
      </Router>
    </QueryClientProvider>,
  );
};

describe("Reports top-level query error state", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    refetchIncome.mockClear();
  });

  it("shows an announced error state with a retry button instead of a blank chart when a report query fails", async () => {
    renderReports();

    await user.click(screen.getByText("Income"));

    // WCAG 2.1 AA: the failure is announced (role=alert), not silently blank.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load cash flow data");

    // No blank/empty chart masquerading as "no data".
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });

  it("retries the failed query when Try again is clicked", async () => {
    renderReports();

    await user.click(screen.getByText("Income"));
    await screen.findByRole("alert");

    const retryButton = screen.getByRole("button", { name: /try again/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(refetchIncome).toHaveBeenCalledTimes(1);
    });
  });
});
