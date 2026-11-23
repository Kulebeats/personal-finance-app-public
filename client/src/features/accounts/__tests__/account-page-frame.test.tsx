/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountsPage from "@/pages/Accounts";
import { accountKeys } from "@/hooks/useAccounts";
import { useAdjustBalance, useArchiveAccount, useCreateAccount, useDeleteAccount, useImportBalanceHistory,
  useImportTransactions, useUpdateAccount, useUpdateAccountSettings } from "@/hooks/useAccounts";

const mocks = vi.hoisted(() => ({ history: vi.fn(), write: vi.fn(), list: vi.fn(), cached: [] as unknown[] }));
vi.mock("@/lib/api", async original => {
  const actual = await original<typeof import("@/lib/api")>();
  return { ...actual, accountsApi: { ...actual.accountsApi, getNetWorthHistory: mocks.history,
    create: (...args: unknown[]) => mocks.write("create", ...args), update: (...args: unknown[]) => mocks.write("update", ...args),
    delete: (...args: unknown[]) => mocks.write("delete", ...args), archive: (...args: unknown[]) => mocks.write("archive", ...args),
    unarchive: (...args: unknown[]) => mocks.write("unarchive", ...args), adjustBalance: (...args: unknown[]) => mocks.write("adjust", ...args),
    updateSettings: (...args: unknown[]) => mocks.write("settings", ...args), importBalanceHistory: (...args: unknown[]) => mocks.write("import-history", ...args),
    importTransactions: (...args: unknown[]) => mocks.write("import-transactions", ...args),
  } };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks", async original => ({ ...await original<typeof import("@/hooks")>(),
  useAccounts: mocks.list, useExportAccountsSummary: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useAccountOwnerPreference", async () => {
  const { useState } = await import("react");
  return { useAccountOwnerPreference: () => {
    const [ownerUserId, setOwnerUserId] = useState<string | null>("all");
    return { ownerUserId, setOwnerUserId, ownerPreferencesReady: true, ownerPreferencesLoading: false,
      currentUserId: "member", resetOwnerFilter: () => setOwnerUserId("all") };
  } };
});
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
// Keep the actual registered page, filter callback, data hook, list, cards and
// summary. Only the shared selector widget and unrelated account editor are stubbed.
vi.mock("@/components/OwnerFilter", () => ({ OwnerFilter: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) =>
  <select aria-label="Filter accounts by owner" value={value ?? "shared"} onChange={event => onChange(event.target.value === "shared" ? null : event.target.value)}>
    <option value="all">All accounts</option><option value="member">My accounts</option><option value="shared">Shared only</option>
  </select> }));
vi.mock("../components/AddAccountModal", () => ({ AddAccountModal: () => null }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, AreaChart: () => null,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null }));
const publicAccount = { id: "public", name: "Public cash", type: "checking", balance: "100", currency: "ZMW", ownerUserId: null };
const personalAccount = { ...publicAccount, id: "personal", name: "Previously visible personal", balance: "900", ownerUserId: "member" };
const frame = (accounts = [publicAccount, personalAccount]) => ({ accounts, series: [], currentStatus: "available",
  latest: { assets: accounts.length === 2 ? 1000 : 100, liabilities: 0, netWorth: accounts.length === 2 ? 1000 : 100, currency: "ZMW" } });
const mutations = ["update", "delete", "archive", "unarchive", "adjust", "settings", "import-history", "import-transactions", "create"] as const;
type Mutation = typeof mutations[number];
function MutationDriver({ kind }: { kind: Mutation }) {
  const create = useCreateAccount(), update = useUpdateAccount(), remove = useDeleteAccount(), archive = useArchiveAccount();
  const adjust = useAdjustBalance(), settings = useUpdateAccountSettings(), importHistory = useImportBalanceHistory(), importTransactions = useImportTransactions();
  const run = () => {
    if (kind === "create") create.mutate({ name: "Public cash", type: "checking" });
    if (kind === "update") update.mutate({ id: "public", data: { name: "Public cash" } });
    if (kind === "delete") remove.mutate("public");
    if (kind === "archive" || kind === "unarchive") archive.mutate({ id: "public", archive: kind === "archive" });
    if (kind === "adjust") adjust.mutate({ id: "public", data: { amount: 1, isIncrease: true } });
    if (kind === "settings") settings.mutate({ id: "public", settings: { isHidden: true } });
    if (kind === "import-history") importHistory.mutate({ id: "public", data: [{ date: "2026-10-31", amount: "100" }] });
    if (kind === "import-transactions") importTransactions.mutate({ id: "public", transactions: [], adjustBalance: true });
  };
  return <button onClick={run}>Apply mutation</button>;
}
let client: QueryClient;
function mount(kind?: Mutation) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><AccountsPage />{kind && <MutationDriver kind={kind} />}</QueryClientProvider>);
}
beforeEach(() => {
  onlineManager.setOnline(true); mocks.history.mockReset(); mocks.history.mockResolvedValue(frame());
  mocks.write.mockReset();
  mocks.cached = [publicAccount, personalAccount];
  mocks.list.mockImplementation((params: { ownerUserId: string | null }, enabled: boolean) => ({
    data: enabled ? mocks.cached.filter(value => params.ownerUserId === "all" || (value as typeof publicAccount).ownerUserId === params.ownerUserId) : undefined,
    isLoading: false, error: null, refetch: vi.fn(),
  }));
});
afterEach(() => { cleanup(); client?.clear(); onlineManager.setOnline(true); });

it("withdraws a newly private account's list details and type breakdown despite the unchanged list cache", async () => {
  mount(); await screen.findByText("Previously visible personal");
  expect(screen.getByRole("button", { name: /Banks account group.*1,000\.00/ })).toBeInTheDocument();
  mocks.history.mockResolvedValue(frame([publicAccount]));
  await act(async () => { await client.invalidateQueries({ queryKey: accountKeys.all }); });
  await waitFor(() => expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument());
  expect(mocks.cached).toHaveLength(2);
  expect(screen.getByText("Public cash")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Banks account group.*100\.00/ })).toBeInTheDocument();
  expect(screen.queryByText(/1,000\.00|900\.00/)).not.toBeInTheDocument();
});
it("preserves Mine, Shared and All on the registered account list using the coherent visible frame", async () => {
  mount(); await screen.findByText("Public cash");
  fireEvent.change(screen.getByRole("combobox", { name: "Filter accounts by owner" }), { target: { value: "member" } });
  await waitFor(() => expect(screen.queryByText("Public cash")).not.toBeInTheDocument());
  await screen.findByText("Previously visible personal");
  fireEvent.change(screen.getByRole("combobox", { name: "Filter accounts by owner" }), { target: { value: "shared" } });
  await waitFor(() => expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument());
  await screen.findByText("Public cash");
  fireEvent.click(screen.getByRole("button", { name: "Reset Filter to All" }));
  await screen.findByText("Previously visible personal");
  expect(mocks.history).toHaveBeenCalledWith("1m", "user", true);
});
it("withdraws the actual list as well as its type totals while access renewal is paused", async () => {
  mount(); await screen.findByText("Previously visible personal");
  act(() => { onlineManager.setOnline(false); void client.invalidateQueries({ queryKey: accountKeys.all }); });
  await waitFor(() => expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument());
  expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Banks account group/ })).not.toBeInTheDocument();
  expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
});

it("keeps a single USD group's amount in USD rather than assigning ZMW", async () => {
  mocks.history.mockResolvedValue({ ...frame([{ ...publicAccount, currency: "USD" }]), latest: { assets: 100, liabilities: 0, netWorth: 100, currency: "USD" } });
  mount(); await screen.findByText("Public cash");
  const group = screen.getByRole("button", { name: /Banks account group/ });
  expect(within(group).getByText(/USD.*100\.00/)).toBeInTheDocument();
  expect(group).not.toHaveTextContent(/K100\.00|ZMW/);
});
it("shows each native currency in a mixed group without an invented combined amount", async () => {
  mocks.history.mockResolvedValue(frame([{ ...publicAccount, currency: "USD", balance: "10" }, personalAccount]));
  mount(); await screen.findByText("Public cash");
  const group = screen.getByRole("button", { name: /Banks account group/ });
  expect(within(group).getByText(/USD.*10\.00/)).toBeInTheDocument();
  expect(within(group).getByText(/ZMW.*900\.00/)).toBeInTheDocument();
  expect(group).not.toHaveTextContent(/910\.00/);
});
it.each(mutations)("renews the mounted wealth/list frame after the existing %s mutation succeeds", async kind => {
  mount(kind); await screen.findByText("Previously visible personal");
  let finish!: (value: ReturnType<typeof frame>) => void;
  mocks.history.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.write.mockResolvedValue(kind === "adjust" ? { account: publicAccount } : kind.startsWith("import") ? { imported: 1 } : publicAccount);
  fireEvent.click(screen.getByRole("button", { name: "Apply mutation" }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
  expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0);
  await act(async () => { finish(frame([publicAccount])); });
  await screen.findByText("Public cash");
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
});
it("renews access before expanding Shared back to All on the same page", async () => {
  mount(); await screen.findByText("Previously visible personal");
  fireEvent.change(screen.getByRole("combobox", { name: "Filter accounts by owner" }), { target: { value: "shared" } });
  await waitFor(() => expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument());
  // The service now excludes a privatized account, while All's previous cache
  // still contains its name/id/balance. Expansion must not flash that cache.
  mocks.history.mockResolvedValue(frame([publicAccount]));
  fireEvent.click(screen.getByRole("button", { name: "Reset Filter to All" }));
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
  await screen.findByText("Public cash");
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
});
it("does not publish a delayed older filter response after rapid expansion", async () => {
  mount(); await screen.findByText("Previously visible personal");
  let finishNarrow!: (value: ReturnType<typeof frame>) => void, finishAll!: (value: ReturnType<typeof frame>) => void;
  mocks.history.mockImplementationOnce(() => new Promise(resolve => { finishNarrow = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishAll = resolve; }));
  fireEvent.change(screen.getByRole("combobox", { name: "Filter accounts by owner" }), { target: { value: "shared" } });
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Reset Filter to All" }));
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(3));
  await act(async () => { finishNarrow(frame()); });
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
  await act(async () => { finishAll(frame([publicAccount])); });
  await screen.findByText("Public cash");
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
});
it("requires a distinct mount lifetime and fresh reply when an older request survives page remount", async () => {
  const view = mount(); await screen.findByText("Previously visible personal");
  let finishOld!: (value: ReturnType<typeof frame>) => void, finishNew!: (value: ReturnType<typeof frame>) => void;
  mocks.history.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  act(() => { void client.invalidateQueries({ queryKey: accountKeys.netWorthHistories() }); });
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
  view.rerender(<QueryClientProvider client={client}><p>Another page</p></QueryClientProvider>);
  // Same provider and identity, but the peer's account has become inaccessible
  // before returning. An old in-flight frame may not authorize the new mount.
  view.rerender(<QueryClientProvider client={client}><AccountsPage /></QueryClientProvider>);
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(3));
  await act(async () => { finishOld(frame()); });
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
  await act(async () => { finishNew(frame([publicAccount])); });
  await screen.findByText("Public cash");
  expect(screen.queryByText("Previously visible personal")).not.toBeInTheDocument();
});
it("preserves a negative asset group's native sign", async () => {
  mocks.history.mockResolvedValue({ ...frame([{ ...publicAccount, balance: "-25", currency: "USD" }]),
    latest: { assets: -25, liabilities: 0, netWorth: -25, currency: "USD" } });
  mount(); await screen.findByText("Public cash");
  const group = screen.getByRole("button", { name: /Banks account group/ });
  expect(within(group).getByText(/-USD.*25\.00/)).toBeInTheDocument();
});
