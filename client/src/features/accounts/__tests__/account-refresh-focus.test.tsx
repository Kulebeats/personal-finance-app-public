/** @vitest-environment jsdom */
// C3-30: a same-member background refresh must not drop keyboard focus from the
// accounts list, while unconfirmed account rows stay withheld. Real page, real
// QueryClient and real window-focus refetch; only transport and chrome are stubbed.
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountsPage from "@/pages/Accounts";

const api = vi.hoisted(() => ({ history: vi.fn(), household: vi.fn(async () => ({ household: { currency: "ZMW" } })) }));
vi.mock("@/lib/api", async original => {
  const actual = await original<typeof import("@/lib/api")>();
  return { ...actual, accountsApi: { ...actual.accountsApi, getNetWorthHistory: api.history, create: vi.fn() } };
});
vi.mock("@/hooks", async original => ({ ...await original<typeof import("@/hooks")>(),
  useExportAccountsSummary: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/use-settings", () => ({
  useHousehold: () => useQuery({ queryKey: ["household"], queryFn: api.household }),
  useProfile: () => ({ data: { id: "member" } }), useHouseholdMembers: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../hooks/useAccountOwnerPreference", async () => {
  const { useState } = await import("react");
  return { useAccountOwnerPreference: () => {
    const [ownerUserId, setOwnerUserId] = useState<string | null>("all");
    return { ownerUserId, setOwnerUserId, ownerPreferencesReady: true, ownerPreferencesLoading: false,
      currentUserId: "member", resetOwnerFilter: () => setOwnerUserId("all") };
  } };
});
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/OwnerFilter", () => ({ OwnerFilter: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) =>
  <select aria-label="Filter accounts by owner" value={value ?? "shared"} onChange={event => onChange(event.target.value === "shared" ? null : event.target.value)}>
    <option value="all">All accounts</option><option value="member">My accounts</option><option value="shared">Shared only</option>
  </select> }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, AreaChart: () => null,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null }));

const memberCash = { id: "member-cash", name: "Member cash", type: "checking", balance: "100", currency: "ZMW", ownerUserId: "member" };
const frame = (accounts: typeof memberCash[] = [memberCash]) => ({ accounts, accessibleAccountCount: accounts.length, series: [],
  currentStatus: "available", latest: { assets: 100, liabilities: 0, netWorth: 100, currency: "ZMW" } });
type Frame = ReturnType<typeof frame>;

let client: QueryClient;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const page = (queryClient: QueryClient, lifetime = "first") =>
  <QueryClientProvider key={lifetime} client={queryClient}><AccountsPage /></QueryClientProvider>;
function mount(initial: Frame = frame()) {
  api.history.mockReset().mockResolvedValue(initial);
  client = newClient();
  return render(page(client));
}
/** Move real keyboard focus with Tab until it reaches the target control. */
async function tabTo(user: UserEvent, target: HTMLElement) {
  for (let step = 0; step < 30 && document.activeElement !== target; step += 1) await user.tab();
  expect(document.activeElement).toBe(target);
}
/** Start a same-member window-focus refresh whose reply is held until `finish`. */
async function holdRefresh() {
  let finish!: (value: Frame) => void;
  const calls = api.history.mock.calls.length;
  api.history.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await waitFor(() => expect(api.history.mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() => expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0));
  return (value: Frame) => act(async () => { finish(value); });
}
const accountsRegion = () => screen.getByRole("region", { name: "Accounts" });

beforeEach(() => { focusManager.setFocused(undefined); });
afterEach(() => { cleanup(); client?.clear(); focusManager.setFocused(undefined); });

it("keeps keyboard focus on the filtered-empty Show All Accounts action through a same-member refresh", async () => {
  const user = userEvent.setup();
  mount(); await screen.findByText("Member cash");
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter accounts by owner" }), "shared");
  const showAll = await screen.findByRole("button", { name: "Show All Accounts" });
  await tabTo(user, showAll);
  const finish = await holdRefresh();
  expect(document.activeElement).toBe(showAll);
  expect(screen.queryByText("No accounts match this filter")).not.toBeInTheDocument();
  await finish(frame());
  await screen.findByText("No accounts match this filter");
  expect(document.activeElement).toBe(showAll);
});

it("keeps keyboard focus on the first-account Add Account action through a same-member refresh", async () => {
  const user = userEvent.setup();
  mount(frame([])); await screen.findByText("No accounts yet");
  const addFirst = screen.getByRole("button", { name: "Add Account" });
  await tabTo(user, addFirst);
  const finish = await holdRefresh();
  expect(document.activeElement).toBe(addFirst);
  expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  await finish(frame([]));
  await screen.findByText("No accounts yet");
  expect(document.activeElement).toBe(addFirst);
});

it("moves focus to the Accounts region, not the page body, when a focused account row is withheld", async () => {
  const user = userEvent.setup();
  mount(); const row = await screen.findByRole("link", { name: /Member cash/ });
  await tabTo(user, row);
  const finish = await holdRefresh();
  expect(screen.queryByText("Member cash")).not.toBeInTheDocument();
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(accountsRegion());
  await finish(frame());
  await screen.findByText("Member cash");
  expect(document.activeElement).toBe(accountsRegion());
});

it("keeps Show All Accounts focused while expansion is checked, then falls back to the region when rows replace it", async () => {
  const user = userEvent.setup();
  mount(); await screen.findByText("Member cash");
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter accounts by owner" }), "shared");
  const showAll = await screen.findByRole("button", { name: "Show All Accounts" });
  await tabTo(user, showAll);
  let finish!: (value: Frame) => void;
  api.history.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0));
  expect(document.activeElement).toBe(showAll);
  expect(screen.queryByText("Member cash")).not.toBeInTheDocument();
  await act(async () => { finish(frame()); });
  await screen.findByText("Member cash");
  expect(document.activeElement).toBe(accountsRegion());
});

it("withdraws the focused member's rows on an actual revocation", async () => {
  const user = userEvent.setup();
  mount(); const row = await screen.findByRole("link", { name: /Member cash/ });
  await tabTo(user, row);
  api.history.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await screen.findByText("Failed to load accounts");
  expect(screen.queryByText("Member cash")).not.toBeInTheDocument();
  expect(screen.queryByText(/100\.00/)).not.toBeInTheDocument();
});

it("clears the previous member's rows and unsaved editor draft when the session lifetime changes", async () => {
  const user = userEvent.setup();
  const view = mount(); await screen.findByText("Member cash");
  await user.click(screen.getByRole("button", { name: "Add a new account" }));
  await user.click(screen.getByRole("button", { name: /^Cash\s*Physical Cash$/ }));
  await user.type(screen.getByLabelText("Account Name"), "Unsaved first member draft");
  const nextMember = { ...memberCash, id: "next-cash", name: "Next member cash", ownerUserId: "next" };
  api.history.mockReset().mockResolvedValue(frame([nextMember]));
  const previous = client; client = newClient(); previous.clear();
  view.rerender(page(client, "second"));
  await screen.findByText("Next member cash");
  expect(screen.queryByText("Member cash")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("Unsaved first member draft")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
