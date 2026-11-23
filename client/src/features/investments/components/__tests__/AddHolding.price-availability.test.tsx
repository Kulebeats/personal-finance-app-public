import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { AddHoldingModal } from "../AddHoldingModal";

// Real opening modal, catalogue hook and picker. Only transport, account/session
// and display/toast adapters are replaced. Unrun source callers, not DB evidence.
const mocks = vi.hoisted(() => ({ api: vi.fn(), operation: null as OperationLifetime | null }));
vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { currency: "ZMW", numberFormat: "US" } }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: "subject" }, household: { id: "household", role: "owner" } },
  lifetime: { operation: mocks.operation },
}) }));
let client: QueryClient;
let rejection: number | null;
let freshPrice: string;
const quote = () => new Response(JSON.stringify({ success: true, data: [{
  id: "security", symbol: "USDLOCAL", name: "Synthetic instrument", type: "stock", currency: "USD",
  currentPrice: freshPrice, valuationPrice: { source: "manual", effectiveDate: "2026-11-01", validThrough: "2026-11-15" },
}] }), { status: 200 });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  focusManager.setFocused(true);
  rejection = null;
  freshPrice = "3.1415";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
  mocks.operation = createOperationLifetime({ subject: "subject", household: "household" });
  activateOperationLifetime(mocks.operation);
  mocks.api.mockReset().mockImplementation(async (method: string, path: string) => {
    if (method !== "GET" || path.split("?")[0] !== "/api/investments/securities") throw new Error("Unexpected transport");
    if (rejection) throw Object.assign(new Error("Price lookup unavailable"), { status: rejection });
    return quote();
  });
});
afterEach(() => {
  cleanup();
  retireOperationLifetime(mocks.operation);
  client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});
function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby/);
  render(<AddHoldingModal><button>Open holding</button></AddHoldingModal>, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Open holding" }));
}
it.each([409, 503])("withholds a cached quote after a failed catalogue refresh (%i), retaining selectable metadata", async status => {
  mount();
  await screen.findByText("USD 3.1415");
  rejection = status;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await waitFor(() => expect(screen.queryByText("USD 3.1415")).not.toBeInTheDocument());
  expect(screen.getByText("Price unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /USDLOCAL Synthetic instrument/ }));
  expect(screen.getByLabelText("Purchase Price (USD) *")).toHaveValue(null);
});
it("reaches the real catalogue Retry before restoring a current quote", async () => {
  mount();
  await screen.findByText("USD 3.1415");
  rejection = 409;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await screen.findByText("Price unavailable");
  rejection = null;
  freshPrice = "7.2718";
  fireEvent.click(screen.getByRole("button", { name: "Retry prices" }));
  await screen.findByText("USD 7.2718");
  expect(screen.queryByText("Price unavailable")).not.toBeInTheDocument();
});
