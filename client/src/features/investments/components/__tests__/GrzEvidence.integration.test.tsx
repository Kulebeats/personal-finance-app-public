import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionStatus } from "@shared/session-status";
import Decimal from "decimal.js";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";
import { GRZBondsTable } from "../GRZBondsTable";

const ids = { subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333", bond: "44444444-4444-4444-8444-444444444444", record: "55555555-5555-4555-8555-555555555555" };
const mocks = vi.hoisted(() => ({ status: null as SessionStatus | null,
  lifetime: null as { key: string; operation: OperationLifetime; client: QueryClient } | null, accountCurrency: "ZMW", accountHousehold: "", privateOwner: null as string | null }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: mocks.status, lifetime: mocks.lifetime, loading: !mocks.status, refresh: vi.fn() }) }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: ids.account, householdId: mocks.accountHousehold, name: "Synthetic custody", currency: mocks.accountCurrency,
  isAsset: true, isPrivate: mocks.privateOwner !== null, ownerUserId: mocks.privateOwner, isArchived: false, isHidden: false }], isLoading: false, isError: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const bond: GrzBond = { id: ids.bond, accountId: ids.account, bondName: "Synthetic 950/1000 issue", isin: "ZM0000000001", tenorYears: 5,
  purchasePrice: { amount: "950.00", currency: "ZMW" }, faceValue: { amount: "1000.00", currency: "ZMW" }, couponRate: "0.20", couponFrequency: 2, purchaseDate: "2025-03-12", purchaseYield: null,
  maturityDate: "2030-01-01", status: "active", createdAt: "2025-03-12" };
type Observed = { path: string; method: string; body: string; headers: Headers; credentials?: RequestCredentials };
let requests: Observed[], clients: QueryClient[], reply: (request: Observed) => Promise<Response>;
const day = new Date().toISOString().slice(0, 10);
function scope(subject = ids.subject, household = ids.household, role: "owner" | "member" | "view_only" | "professional" = "member") {
  if (mocks.lifetime) { retireOperationLifetime(mocks.lifetime.operation); retireDataClient(mocks.lifetime.client); }
  const operation = createOperationLifetime({ subject, household }); activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation); clients.push(client);
  mocks.lifetime = { key: `${subject}:${household}:${role}`, operation, client }; mocks.accountHousehold = household;
  mocks.status = { state: "ready", subject: { id: subject, email: "synthetic@example.invalid", displayName: "Synthetic" }, household: { id: household, role } };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status, headers: { "content-type": "application/json" } });
function accepted(request: Observed) {
  const body = JSON.parse(request.body), money = (amount: string) => ({ amount: new Decimal(amount).toFixed(2), currency: "ZMW" });
  const common = { id: ids.record, bondId: ids.bond, authority: "member_recorded", sourceDate: body.sourceDate, sourceKind: body.sourceKind,
    sourceReference: body.sourceReference, isin: body.isin, currency: "ZMW", operationId: body.operationId,
    policyVersion: request.path.endsWith("principal-basis") ? "grz_member_recorded_principal_basis_v1" : "grz_member_recorded_market_v1" };
  return request.path.endsWith("principal-basis") ? json({ ...common, acquisitionDate: body.acquisitionDate,
    purchaseCashAmount: money(body.purchaseCashAmount), principalCost: money(body.principalCost), purchasedInterest: money(body.purchasedInterest), acquisitionFees: money(body.acquisitionFees) })
    : json({ ...common, nominalAmount: money(body.nominalAmount), valuationDate: body.valuationDate, quoteBasis: body.quoteBasis, quoteUnits: body.quoteUnits,
      quotedAmount: body.quotedAmount, accruedQuote: body.accruedInterest, dirtyValue: money("995.10"), cleanValue: body.accruedInterest === null ? null : money("970"),
      accruedInterest: body.accruedInterest === null ? null : money("25.10"), roundingPolicy: "round_total_and_clean_residual_to_accrued" });
}
function tree(holding = bond) { return <QueryClientProvider client={mocks.lifetime!.client}><GRZBondsTable bonds={[holding]} formatCurrency={(value, currency) => `${currency} ${value}`} onViewSchedule={vi.fn()} /></QueryClientProvider>; }
const posts = () => requests.filter(request => request.method === "POST");
const dialog = (kind: "acquisition" | "market") => screen.getByRole("dialog", { name: `Record ${kind} evidence` });
async function open(kind: "acquisition" | "market") {
  const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: `Record ${kind} evidence for ${bond.bondName}` }));
  await screen.findByRole("dialog", { name: `Record ${kind} evidence` }); return user;
}
async function select(container: HTMLElement, name: string, option: string) {
  const user = userEvent.setup(); await user.click(within(container).getByRole("combobox", { name })); await user.click(screen.getByRole("option", { name: option }));
}
function fill(container: HTMLElement, name: string, value: string) { fireEvent.change(within(container).getByLabelText(name), { target: { value } }); }
async function acquisition() {
  await open("acquisition"); const form = dialog("acquisition"); await select(form, "Source type", "Custodian statement");
  fill(form, "Source date", day); fill(form, "Source reference", "Synthetic acquisition source");
  fill(form, "Principal cost (ZMW)", "900.00"); fill(form, "Purchased interest (ZMW)", "25.10"); fill(form, "Acquisition fees (ZMW)", "24.90"); return form;
}
async function market(unknown = false) {
  await open("market"); const form = dialog("market"); await select(form, "Source type", "Same-issue quote");
  fill(form, "Market evidence date", day); fill(form, "Source reference", "Synthetic market source");
  await select(form, "Price basis", unknown ? "Dirty price" : "Clean price");
  await select(form, "Quote units", unknown ? "Whole holding" : "Per ZMW 100 nominal");
  fill(form, "Quoted amount (ZMW)", unknown ? "995.10" : "97");
  if (unknown) await userEvent.click(within(form).getByRole("checkbox", { name: "Accrued breakdown unavailable" })); else fill(form, "Accrued interest in the same units (ZMW)", "2.51");
  return form;
}
beforeEach(() => {
  vi.clearAllMocks(); requests = []; clients = []; clearCsrfToken(); mocks.accountCurrency = "ZMW"; mocks.privateOwner = null; scope();
  reply = async request => accepted(request);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const request: Observed = { path: new URL(String(input), "http://localhost").pathname, method: options?.method ?? "GET", body: String(options?.body ?? ""), headers: new Headers(options?.headers), credentials: options?.credentials };
    requests.push(request);
    if (request.path === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "synthetic-evidence-token" }), { status: 200 });
    if (request.method === "POST" && /\/(principal-basis|valuations)$/.test(request.path)) return reply(request);
    return json(null, 404);
  }));
});
afterEach(() => { cleanup(); for (const client of clients) retireDataClient(client); retireOperationLifetime(mocks.lifetime?.operation); vi.unstubAllGlobals(); });

it("leaves unknown acquisition components blank and submits explicit breakdown without inferring principal from950 cash", async () => {
  render(tree()); await open("acquisition"); const initial = dialog("acquisition");
  for (const label of ["Principal cost (ZMW)", "Purchased interest (ZMW)", "Acquisition fees (ZMW)"]) expect(within(initial).getByLabelText(label)).toHaveValue("");
  expect(within(initial).getByLabelText("Purchase cash (ZMW)")).toHaveValue("950.00");
  await userEvent.click(within(initial).getByRole("button", { name: "Close evidence" }));
  const client = mocks.lifetime!.client, invalidate = vi.spyOn(client, "invalidateQueries"); const form = await acquisition();
  await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await screen.findByText("Acquisition evidence recorded."); expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0].body)).toMatchObject({ purchaseCashAmount: "950.00", principalCost: "900.00", purchasedInterest: "25.10", acquisitionFees: "24.90", acquisitionDate: bond.purchaseDate, isin: bond.isin, currency: "ZMW" });
  expect(JSON.parse(posts()[0].body)).not.toHaveProperty("nominalAmount");
  expect(posts()[0].headers.get("X-Capital-Subject")).toBe(ids.subject); expect(posts()[0].headers.get("X-Capital-Household")).toBe(ids.household); expect(posts()[0].credentials).toBe("include");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["accounts"] });
});
it("requires the purchase components to reconcile before sending", async () => {
  render(tree()); const form = await acquisition(); fill(form, "Acquisition fees (ZMW)", "20.00");
  await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/reconcile/i); expect(posts()).toEqual([]);
});
it("records clean per100 evidence with its explicit same-unit accrued amount and captured nominal", async () => {
  render(tree()); const form = await market(); await userEvent.click(within(form).getByRole("button", { name: "Record market evidence" }));
  await screen.findByText(/Market evidence recorded/); expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0].body)).toMatchObject({ nominalAmount: "1000.00", quotedAmount: "97", accruedInterest: "2.51", quoteBasis: "clean", quoteUnits: "per_100_nominal", valuationDate: day, sourceDate: day });
});
it("records a dirty whole-holding quote without inventing unavailable accrued or clean principal", async () => {
  render(tree()); const form = await market(true); await userEvent.click(within(form).getByRole("button", { name: "Record market evidence" }));
  await screen.findByText(/Market evidence recorded/); expect(JSON.parse(posts()[0].body)).toMatchObject({ quotedAmount: "995.10", accruedInterest: null, quoteBasis: "dirty", quoteUnits: "holding_amount" });
});
it("retains one frozen request and UUID across a lost response, attempted edit, close and reopen", async () => {
  let calls = 0; reply = async request => { if (++calls === 1) throw new TypeError("Synthetic lost response"); return accepted(request); };
  render(tree()); const form = await acquisition(); await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await screen.findByRole("button", { name: "Retry same evidence" }); expect(within(form).getByLabelText("Principal cost (ZMW)")).toBeDisabled();
  fill(form, "Principal cost (ZMW)", "1.00"); await userEvent.click(within(form).getByRole("button", { name: "Close evidence" }));
  await open("acquisition"); await userEvent.click(within(dialog("acquisition")).getByRole("button", { name: "Retry same evidence" }));
  await screen.findByText("Acquisition evidence recorded."); expect(posts()).toHaveLength(2); expect(posts()[1].body).toBe(posts()[0].body);
});
it.each(["view_only", "professional"] as const)("withholds recording actions from %s", role => {
  scope(ids.subject, ids.household, role); render(tree()); expect(screen.queryByRole("button", { name: /Record.*evidence/ })).not.toBeInTheDocument(); expect(posts()).toEqual([]);
});
it.each(["denomination", "household", "private owner"] as const)("refuses unverified custody %s", async mismatch => {
  if (mismatch === "denomination") mocks.accountCurrency = "USD";
  if (mismatch === "household") mocks.accountHousehold = "99999999-9999-4999-8999-999999999999";
  if (mismatch === "private owner") mocks.privateOwner = "99999999-9999-4999-8999-999999999999";
  render(tree()); await open("acquisition"); expect(await screen.findByRole("alert")).toHaveTextContent(/visible ZMW custody account/i); expect(posts()).toEqual([]);
});
it("withdraws the draft, retry and late response when the actor and household change", async () => {
  let release!: (response: Response) => void, submitted!: Observed;
  reply = request => { submitted = request; return new Promise(resolve => { release = resolve; }); };
  const view = render(tree()), form = await acquisition(); await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); const oldClient = mocks.lifetime!.client, invalidated = vi.spyOn(oldClient, "invalidateQueries");
  scope("66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"); view.rerender(tree());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByDisplayValue("Synthetic acquisition source")).not.toBeInTheDocument();
  await act(async () => release(accepted(submitted))); expect(invalidated).not.toHaveBeenCalled(); expect(screen.queryByText("Acquisition evidence recorded.")).not.toBeInTheDocument();
  await open("acquisition"); expect(within(dialog("acquisition")).getByLabelText("Source reference")).toHaveValue(""); expect(posts()).toHaveLength(1);
});
it("treats an unverified success reply as uncertain and retries the same body", async () => {
  let calls = 0; reply = async request => ++calls === 1 ? json({ id: ids.record, bondId: ids.bond, authority: "provider_attested" }) : accepted(request);
  render(tree()); const form = await acquisition(); await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same evidence" })); await screen.findByText("Acquisition evidence recorded.");
  expect(posts()).toHaveLength(2); expect(posts()[1].body).toBe(posts()[0].body);
});

it.each([
  ["operationId", "11111111-1111-4111-8111-111111111111"],
  ["policyVersion", "unknown_policy"],
  ["roundingPolicy", "unknown_rounding"],
])("withholds market success when the acknowledgement carries a different %s", async (field, value) => {
  reply = async request => {
    const response = await accepted(request).json();
    return json({ ...response.data, [field]: value });
  };
  render(tree());
  const form = await market();
  await userEvent.click(within(form).getByRole("button", { name: "Record market evidence" }));
  expect(await screen.findByRole("button", { name: "Retry same evidence" })).toBeVisible();
  expect(screen.queryByText("Market evidence recorded.")).not.toBeInTheDocument();
});

it("replays the original acquisition after leaving Investments and returning in the same session", async () => {
  let calls = 0;
  reply = async request => { if (++calls === 1) throw new TypeError("Lost response"); return accepted(request); };
  const firstVisit = render(tree());
  const form = await acquisition();
  await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await screen.findByRole("button", { name: "Retry same evidence" });
  firstVisit.unmount();
  render(tree());
  await open("acquisition");
  await userEvent.click(await screen.findByRole("button", { name: "Retry same evidence" }));
  await screen.findByText("Acquisition evidence recorded.");
  expect(posts().map(call => call.body)).toEqual([posts()[0].body, posts()[0].body]);
});

it("refreshes the originating active account cache when acceptance arrives after leaving the table", async () => {
  let release!: () => void;
  reply = request => new Promise(resolve => { release = () => resolve(accepted(request)); });
  const invalidate = vi.spyOn(mocks.lifetime!.client, "invalidateQueries");
  const visit = render(tree());
  const form = await acquisition();
  await userEvent.click(within(form).getByRole("button", { name: "Record acquisition evidence" }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  visit.unmount();
  await act(async () => release());
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["accounts"] }));
});

it.each([
  ["0.00", "995.10", "995.10"],
  ["950.00", "9999999999999.994", "9999999999999.99"],
])("admits independent market evidence for purchase cash %s and quote %s", async (purchasePrice, quote, rounded) => {
  reply = async request => {
    const response = await accepted(request).json();
    return json({ ...response.data, dirtyValue: { amount: rounded, currency: "ZMW" } });
  };
  render(tree({ ...bond, purchasePrice: { amount: purchasePrice, currency: "ZMW" } }));
  const form = await market(true);
  fill(form, "Quoted amount (ZMW)", quote);
  await userEvent.click(within(form).getByRole("button", { name: "Record market evidence" }));
  await screen.findByText("Market evidence recorded.");
  expect(posts()).toHaveLength(1);
});

it.each(["acquisition", "market"] as const)("returns keyboard focus to the %s opener", async kind => {
  render(tree());
  const trigger = screen.getByRole("button", { name: `Record ${kind} evidence for ${bond.bondName}` });
  const user = await open(kind);
  if (kind === "market") await user.keyboard("{Escape}");
  else await user.click(within(dialog(kind)).getByRole("button", { name: "Close evidence" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
