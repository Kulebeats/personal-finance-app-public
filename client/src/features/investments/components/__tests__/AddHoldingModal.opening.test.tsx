import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient } from "@/lib/queryClient";
import { useCreateHolding } from "@/hooks/investments/useHoldings";
import { AddHoldingModal } from "../AddHoldingModal";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), createSecurity: vi.fn(), search: vi.fn(), api: vi.fn(), lifetime: null as OperationLifetime | null,
  securities: [
    { id: "usd-security", symbol: "USDSTOCK", name: "Synthetic USD stock", currency: "USD", currentPrice: "0.10", exchange: "nyse" },
    { id: "zmw-security", symbol: "ZMWSTOCK", name: "Synthetic ZMW stock", currency: "ZMW", currentPrice: "0.10", exchange: "luse" },
  ],
}));
vi.mock("@/hooks/useInvestments", () => ({
  useSecurities: (options: { search: string }) => {
    mocks.search(options);
    return { data: mocks.securities.filter(security => security.symbol.includes(options.search.toUpperCase())), isLoading: false };
  },
  useCreateHolding: () => ({ mutateAsync: mocks.submit, isPending: false }),
  useCreateSecurity: () => ({ mutateAsync: mocks.createSecurity, isPending: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [
  { id: "first-account", name: "First investment", type: "investment", currency: "ZMW" },
  { id: "second-account", name: "Second investment", type: "investment", currency: "ZMW" },
  { id: "checking-account", name: "Checking account", type: "checking", currency: "ZMW" },
] }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { currency: "ZMW", numberFormat: "US" } }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.lifetime?.expectations?.subject }, household: { id: mocks.lifetime?.expectations?.household } },
  lifetime: { operation: mocks.lifetime },
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.submit.mockReset().mockResolvedValue({}); vi.stubGlobal("crypto", webcrypto);
  mocks.securities[0].currency = "USD";
  mocks.lifetime = createOperationLifetime({ subject: "subject", household: "household" }); activateOperationLifetime(mocks.lifetime);
});
afterEach(() => { cleanup(); retireOperationLifetime(mocks.lifetime); vi.unstubAllGlobals(); });

async function openDetails(onSuccess?: () => void) {
  const user = userEvent.setup();
  const rendered = render(<AddHoldingModal onSuccess={onSuccess}><button>Open holding</button></AddHoldingModal>);
  // Existing modal has no description; keep that unrelated warning explicit.
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby/);
  await user.click(screen.getByRole("button", { name: "Open holding" }));
  await user.type(screen.getByPlaceholderText(/Search securities/), "USD");
  await user.click(screen.getByRole("button", { name: /USDSTOCK/ }));
  return { user, form: within(screen.getByRole("dialog")), rendered };
}
function enter(quantity: string, price: string) {
  fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: quantity } });
  fireEvent.change(screen.getByPlaceholderText("15.50"), { target: { value: price } });
}

it("submits an exact native decimal for three shares at ten cents through the normal opening flow", async () => {
  const { user, form } = await openDetails();
  enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit).toHaveBeenCalledWith({ securityId: "usd-security", accountId: "first-account",
    quantity: "3", costBasis: "0.30", acquiredDate: new Date().toISOString().slice(0, 10),
    operationId: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i), expectedCurrency: "USD" });
});

it("labels the source unit price and total in USD when user settings and custody are ZMW", async () => {
  const { form } = await openDetails();
  enter("2", "5.00");
  expect(form.getByText("$10.00")).toBeVisible();
  expect(form.getByLabelText("Purchase Price (USD) *")).toBeVisible();
  expect(form.getByText("Total Cost (USD)")).toBeVisible();
  expect(form.queryByText("K10.00")).toBeNull();
});

it.each([
  ["3", "0.0017", "0.01"],
  ["1", "0.0050", "0.01"],
  ["0.00000001", "99999999999.9999", "1000.00"],
])("previews and sends the same once-rounded native amount for %s shares at %s", async (quantity, price, total) => {
  const { user, form } = await openDetails();
  enter(quantity, price);
  expect(form.getByText(`$${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`)).toBeVisible();
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity, costBasis: total }));
});

it.each([["0", "1"], ["0", "0"], ["3", "0"]])(
  "preserves a supported zero-cost opening for quantity %s and price %s", async (quantity, price) => {
    const { user, form } = await openDetails();
    enter(quantity, price);
    expect(form.getByText("$0.00")).toBeVisible();
    const save = form.getByRole("button", { name: "Add Holding" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ securityId: "usd-security", quantity, costBasis: "0.00" }));
  });

it.each([
  [".5", "1", "0.5", "$0.50", "0.50"],
  ["1e-1", "5", "0.1", "$0.50", "0.50"],
  ["2", "1e-1", "2", "$0.20", "0.20"],
])("preserves supported number inputs %s shares at %s with exact native normalization", async (quantity, price, normalizedQuantity, preview, total) => {
  const { user, form } = await openDetails(); enter(quantity, price);
  expect(form.getByText(preview)).toBeVisible();
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: normalizedQuantity, costBasis: total }));
});

it.each([
  ["-1", "1"], ["10000000000", "1"], ["0.123456789", "1"],
  ["1", "-1"], ["1", "100000000000"], ["1", "0.12345"],
  ["9999999999", "99999999999"], ["1e309", "1"],
])("blocks unsupported quantity %s and unit price %s before mutation", async (quantity, price) => {
  const { user, form } = await openDetails();
  enter(quantity, price);
  const save = form.getByRole("button", { name: "Add Holding" });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("preserves search, Back navigation and investment-account selection when changing the selected denomination", async () => {
  const { user, form } = await openDetails();
  enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Back" }));
  const search = screen.getByPlaceholderText(/Search securities/);
  await user.clear(search); await user.type(search, "ZMW");
  await user.click(screen.getByRole("button", { name: /ZMWSTOCK/ }));
  expect(form.getByText("K0.30")).toBeVisible();
  expect(form.getByLabelText("Purchase Price (ZMW) *")).toBeVisible();
  await user.click(form.getByRole("combobox"));
  expect(screen.queryByRole("option", { name: "Checking account" })).toBeNull();
  await user.click(screen.getByRole("option", { name: "Second investment" }));
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  expect(mocks.search).toHaveBeenCalledWith({ search: "ZMW" });
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ securityId: "zmw-security", accountId: "second-account", costBasis: "0.30" }));
});

it("retains the immutable opening and UUID after an unconfirmed result and normal close/reopen", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("Response lost"));
  const { user, form } = await openDetails(); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  const original = mocks.submit.mock.calls[0][0];
  expect(await form.findByText(/result was not confirmed/i)).toBeVisible();
  expect(form.getByLabelText("Quantity *")).toBeDisabled();
  expect(form.getByLabelText("Purchase Price (USD) *")).toBeDisabled();
  expect(form.getByLabelText("Purchase Date")).toBeDisabled();
  expect(form.getByRole("combobox")).toBeDisabled();
  expect(form.getByRole("button", { name: "Back" })).toBeDisabled();
  await user.click(form.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Open holding" }));
  const resumed = within(screen.getByRole("dialog"));
  expect(resumed.getByLabelText("Quantity *")).toHaveValue(3);
  expect(resumed.getByText("$0.30")).toBeVisible();
  await user.click(resumed.getByRole("button", { name: "Retry same opening" }));
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
});

it("allows one in-flight request and preserves locked details when reopened before completion", async () => {
  let resolve!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const onSuccess = vi.fn(), { user, form } = await openDetails(onSuccess); enter("3", "0.10");
  await user.dblClick(form.getByRole("button", { name: "Add Holding" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(form.getByLabelText("Quantity *")).toBeDisabled();
  expect(form.getByRole("button", { name: "Back" })).toBeDisabled();
  await user.click(form.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Open holding" }));
  expect(screen.getByLabelText("Quantity *")).toHaveValue(3);
  expect(screen.getByLabelText("Quantity *")).toBeDisabled();
  await act(async () => resolve({}));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

it("issues a distinct UUID only when an unconfirmed opening is explicitly replaced", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("Response lost"));
  const { user, form } = await openDetails(); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  const original = mocks.submit.mock.calls[0][0];
  await user.click(await form.findByRole("button", { name: "Start a new opening" }));
  await user.type(screen.getByPlaceholderText(/Search securities/), "USD");
  await user.click(screen.getByRole("button", { name: /USDSTOCK/ })); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  const next = mocks.submit.mock.calls[1][0];
  expect(next.operationId).not.toBe(original.operationId);
  expect(next).toEqual({ ...original, operationId: next.operationId });
});

it("uses a new UUID for an intentional identical opening after acknowledged success", async () => {
  const { user, form } = await openDetails(); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  const original = mocks.submit.mock.calls[0][0];
  await user.click(screen.getByRole("button", { name: "Open holding" }));
  await user.type(screen.getByPlaceholderText(/Search securities/), "USD");
  await user.click(screen.getByRole("button", { name: /USDSTOCK/ })); enter("3", "0.10");
  await user.click(screen.getByRole("button", { name: "Add Holding" }));
  expect(mocks.submit.mock.calls[1][0].operationId).not.toBe(original.operationId);
});

it("retries the original displayed denomination when refreshed security options change after an unconfirmed result", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("Response lost"));
  const { user, form, rendered } = await openDetails(); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  const original = mocks.submit.mock.calls[0][0];
  expect(original.expectedCurrency).toBe("USD");
  mocks.securities[0].currency = "ZMW";
  rendered.rerender(<AddHoldingModal><button>Open holding</button></AddHoldingModal>);
  expect(form.getByText("$0.30")).toBeVisible();
  await user.click(await form.findByRole("button", { name: "Retry same opening" }));
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
});

it("does not let a retired identity's delayed success close a different opening form", async () => {
  let resolve!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const onSuccess = vi.fn(), { user, form, rendered } = await openDetails(onSuccess); enter("3", "0.10");
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  retireOperationLifetime(mocks.lifetime);
  mocks.lifetime = createOperationLifetime({ subject: "other-subject", household: "other-household" }); activateOperationLifetime(mocks.lifetime);
  rendered.rerender(<AddHoldingModal onSuccess={onSuccess}><button>Open holding</button></AddHoldingModal>);
  await user.click(screen.getByRole("button", { name: "Open holding" }));
  await user.type(screen.getByPlaceholderText(/Search securities/), "USD");
  await user.click(screen.getByRole("button", { name: /USDSTOCK/ })); enter("4", "0.20");
  await act(async () => resolve({}));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText("Quantity *")).toHaveValue(4);
  expect(onSuccess).not.toHaveBeenCalled();
});

it("forwards operationId through the actual scoped create hook and mutation key", async () => {
  const client = createDataQueryClient(undefined, mocks.lifetime);
  mocks.api.mockResolvedValue({ json: async () => ({ data: { id: "created-holding" } }) });
  const { result } = renderHook(() => useCreateHolding(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  const request = { operationId: crypto.randomUUID(), expectedCurrency: "USD", securityId: "usd-security", accountId: "first-account", quantity: "3", costBasis: "0.30", acquiredDate: "2026-11-02" };
  await act(async () => { await result.current.mutateAsync(request); });
  expect(mocks.api).toHaveBeenCalledWith("POST", "/api/investments/holdings", request, mocks.lifetime);
  expect(client.getMutationCache().getAll()[0].options.mutationKey).toEqual(["investments", "holdings", "create"]);
  client.clear();
});
