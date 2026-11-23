/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyRecapHistory from "../WeeklyRecapHistory";

const fetchHistory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: fetchHistory }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ formatCurrency: (value: number) => `USD ${value}` }) }));
function response(value: number) {
  return { ok: true, json: async () => ({ data: { history: [{ weekStart: "2026-10-25", weekEnd: "2026-10-31",
    summary: { netWorth: { status: "available", currency: "ZMW", current: value, previous: value - 1, change: 1, changePercent: 0.1, trend: "up", series: [] }, spending: 12 } }] } }) };
}
function client() { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }
function view(queryClient: QueryClient, lifetime = "initial") {
  // SessionBoundary keys its provider by operation lifetime, which also remounts
  // TanStack's client-bound observer when identity/role changes.
  return <QueryClientProvider key={lifetime} client={queryClient}><WeeklyRecapHistory /></QueryClientProvider>;
}

describe("recap history selected values follow current query authority", () => {
  beforeEach(() => { fetchHistory.mockReset(); });
  afterEach(() => { onlineManager.setOnline(true); });
  it("refreshes a selected week from fresh recipient data after account privacy changes", async () => {
    const queryClient = client();
    fetchHistory.mockResolvedValueOnce(response(5211.12));
    render(view(queryClient));
    fireEvent.click(await screen.findByText(/Oct 25 - Oct 31/));
    expect(screen.getByText("Week Details")).toBeInTheDocument();
    fetchHistory.mockResolvedValueOnce(response(988.89));
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["weekly-recap-history"] }); });
    await waitFor(() => expect(screen.queryByText(/5,?211\.12/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/ZMW.*988\.89/).length).toBeGreaterThan(0);
  });
  it("does not retain a prior recipient's selected recap when the scoped query client changes", async () => {
    const first = client(), second = client();
    fetchHistory.mockResolvedValueOnce(response(5211.12));
    const mounted = render(view(first));
    fireEvent.click(await screen.findByText(/Oct 25 - Oct 31/));
    expect(screen.getByText("Week Details")).toBeInTheDocument();
    fetchHistory.mockResolvedValueOnce(response(988.89));
    mounted.rerender(view(second, "replacement"));
    await screen.findByText(/988\.89/);
    expect(screen.queryByText("Week Details")).not.toBeInTheDocument();
    expect(screen.queryByText(/5,?211\.12/)).not.toBeInTheDocument();
  });
  it("withdraws a selected cached recap while offline revalidation is paused", async () => {
    const queryClient = client();
    fetchHistory.mockResolvedValueOnce(response(5211.12));
    render(view(queryClient));
    fireEvent.click(await screen.findByText(/Oct 25 - Oct 31/));
    fetchHistory.mockResolvedValueOnce(response(988.89));
    act(() => { onlineManager.setOnline(false); void queryClient.invalidateQueries({ queryKey: ["weekly-recap-history"] }); });
    await waitFor(() => expect(queryClient.getQueryState(["weekly-recap-history"])?.fetchStatus).toBe("paused"));
    await waitFor(() => expect(screen.queryByText("Week Details")).not.toBeInTheDocument());
    expect(screen.queryByText(/5,?211\.12/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Checking current access/i);
    act(() => { onlineManager.setOnline(true); });
    await screen.findAllByText(/988\.89/);
    expect(screen.queryByText(/5,?211\.12/)).not.toBeInTheDocument();
  });
});
