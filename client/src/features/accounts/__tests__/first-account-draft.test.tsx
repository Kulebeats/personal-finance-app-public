/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import AccountsPage from "@/pages/Accounts";
import { AddAccountModal } from "../components/AddAccountModal";

const api = vi.hoisted(() => ({ history: vi.fn(), create: vi.fn(), household: vi.fn(async () => ({ household: { currency: "ZMW" } })) }));
vi.mock("@/lib/api", async original => {
  const actual = await original<typeof import("@/lib/api")>();
  return { ...actual, accountsApi: { ...actual.accountsApi, getNetWorthHistory: api.history, create: api.create } };
});
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../hooks/useAccountOwnerPreference", () => ({ useAccountOwnerPreference: () => ({
  ownerUserId: "all", ownerPreferencesReady: true, ownerPreferencesLoading: false,
  currentUserId: "member", setOwnerUserId: vi.fn(), resetOwnerFilter: vi.fn(),
}) }));
vi.mock("@/hooks/use-settings", () => ({
  useHousehold: () => useQuery({ queryKey: ["household"], queryFn: api.household }),
  useProfile: () => ({ data: { id: "member" } }), useHouseholdMembers: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, AreaChart: () => null,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null }));
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); focusManager.setFocused(undefined); });

function renderAccounts() {
  const empty = { accounts: [], accessibleAccountCount: 0, series: [], currentStatus: "available",
    latest: { assets: 0, liabilities: 0, netWorth: 0, currency: "ZMW" } };
  api.history.mockReset().mockResolvedValue(empty); api.create.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}><AccountsPage /></QueryClientProvider>);
  return empty;
}

it("preserves the real first-account dialog and entered draft during focus refresh", async () => {
  const empty = renderAccounts();
  fireEvent.click(await screen.findByRole("button", { name: "Add Account" }));
  fireEvent.click(screen.getByRole("button", { name: /^Cash\s*Physical Cash$/ }));
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Unsubmitted first account" } });
  fireEvent.change(screen.getByLabelText("Initial Balance"), { target: { value: "123.45" } });
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Draft kept across checking" } });
  let finish!: (value: typeof empty) => void;
  api.history.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Account Name")).toHaveValue("Unsubmitted first account");
  await act(async () => { finish(empty); });
  expect(screen.getByLabelText("Initial Balance")).toHaveValue(123.45);
  expect(screen.getByLabelText("Notes")).toHaveValue("Draft kept across checking");
  expect(api.create).not.toHaveBeenCalled();
});

it.each(["Add Account", "Add a new account"])("returns keyboard focus to the opener %s", async openerName => {
  renderAccounts();
  const opener = await screen.findByRole("button", { name: openerName });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(opener).toHaveFocus());
});

it.each(["immediate", "after type selection appears"])("isolates a reopened editor from a pending submission (%s)", async timing => {
  renderAccounts();
  let finish!: (value: { name: string }) => void;
  api.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(await screen.findByRole("button", { name: "Add Account" }));
  fireEvent.click(screen.getByRole("button", { name: /^Cash\s*Physical Cash$/ }));
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "First draft" } });
  fireEvent.change(screen.getByLabelText("Initial Balance"), { target: { value: "4" } });
  const submit = screen.getByRole("button", { name: "Save Account" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a new account" }));
  const cashButton = { name: /^Cash\s*Physical Cash$/ };
  fireEvent.click(timing === "immediate" ? screen.getByRole("button", cashButton)
    : await screen.findByRole("button", cashButton));
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Still editing" } });
  await act(async () => { finish({ name: "First draft" }); });
  expect(screen.getByLabelText("Account Name")).toHaveValue("Still editing");
  expect(screen.queryByText("Account Added Successfully!")).not.toBeInTheDocument();
  expect(api.create).toHaveBeenCalledTimes(1);
});


it("uses the household currency when an uncontrolled editor opens before settings arrive", async () => {
  let finish!: (readback: { household: { currency: string } }) => void;
  api.household.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  api.create.mockReset().mockResolvedValue({ name: "Cash reserve" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AddAccountModal><button>Add cash account</button></AddAccountModal></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add cash account" }));
  fireEvent.click(screen.getByRole("button", { name: /^Cash\s*Physical Cash$/ }));
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Cash reserve" } });
  fireEvent.change(screen.getByLabelText("Initial Balance"), { target: { value: "10" } });
  const save = screen.getByRole("button", { name: "Save Account" });
  const disabledWhileLoading = save.hasAttribute("disabled");
  await act(async () => { finish({ household: { currency: "USD" } }); });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ currency: "USD" })));
  expect(disabledWhileLoading).toBe(true);
});

it("starts a second account with the household currency after saving a foreign-currency bank account", async () => {
  renderAccounts();
  api.create.mockResolvedValue({ name: "Saved" });
  fireEvent.click(await screen.findByRole("button", { name: "Add Account" }));
  fireEvent.click(screen.getByRole("button", { name: /^Bank Account/ }));
  const currency = await screen.findByText(/Zambian Kwacha/);
  fireEvent.keyDown(currency.closest("button")!, { key: "Enter" });
  fireEvent.keyDown(await screen.findByRole("option", { name: /US Dollar/ }), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Dollar account" } });
  fireEvent.change(screen.getByLabelText("Initial Balance"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Account" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add Another Account" }));
  fireEvent.click(screen.getByRole("button", { name: /^Cash\s*Physical Cash$/ }));
  fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Local cash" } });
  fireEvent.change(screen.getByLabelText("Initial Balance"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Account" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls.map(([data]) => [data.name, data.currency])).toEqual([
    ["Dollar account", "USD"], ["Local cash", "ZMW"],
  ]);
});
