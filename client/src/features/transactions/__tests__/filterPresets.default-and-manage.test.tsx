/**
 * @vitest-environment jsdom
 *
 * R11 / ORG-010: the saved default Transactions preset is applied when the
 * page opens with no filters and by reset; presets can be saved and deleted
 * from the filter UI with labelled, keyboard-reachable controls; a deleted
 * default stops applying. Requests go through the real hooks to a stubbed
 * fetch that answers like the server's /api/filter-presets routes.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { FilterPresetSelector } from "../components/FilterPresetSelector";
import { useDefaultFilterPreset, type FilterPreset } from "../hooks/useFilterPresets";
import { useTransactionFiltersWithPresets } from "../hooks/useTransactionFiltersWithPresets";

vi.mock("@/hooks/use-settings", () => ({ useProfile: () => ({ data: { id: "user-1" } }) }));

const preset = (overrides: Partial<FilterPreset>): FilterPreset => ({
  id: "p1", householdId: "h1", userId: "user-1", name: "Groceries", context: "transactions",
  filters: { categoryId: "cat-1", type: "expense", startDate: "2026-11-01", tagIds: ["tag-1"] },
  isDefault: true, isShared: false, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z",
  ...overrides,
});

interface ServerState { presets: FilterPreset[]; calls: Array<{ method: string; url: string; body: unknown }> }
let server: ServerState;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubServer() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/csrf-token")) return json({ csrfToken: "test-csrf" });
    server.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && url === "/api/filter-presets/default/transactions") {
      return json({ success: true, data: server.presets.find(p => p.isDefault && p.userId === "user-1") ?? null });
    }
    if (method === "GET" && url === "/api/filter-presets?context=transactions") {
      return json({ success: true, data: server.presets });
    }
    if (method === "POST" && url === "/api/filter-presets") {
      return json({ success: true, data: preset({ id: "p-new", ...JSON.parse(String(init?.body)) }) }, 201);
    }
    if (method === "DELETE" && url.startsWith("/api/filter-presets/")) {
      server.presets = server.presets.filter(p => url !== `/api/filter-presets/${p.id}`);
      return new Response(null, { status: 204 });
    }
    return json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }));
}

function Harness() {
  const { filters, resetFilters, applyFilters } = useTransactionFiltersWithPresets();
  const { data: defaultPreset, isSuccess } = useDefaultFilterPreset("transactions");
  return <>
    <FilterPresetSelector context="transactions" currentFilters={filters} onSelectPreset={applyFilters} />
    <button type="button" onClick={resetFilters}>Reset filters</button>
    <output aria-label="Default preset">{isSuccess ? defaultPreset?.name ?? "none" : "loading"}</output>
  </>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const location = memoryLocation({ path, record: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><Router hook={location.hook} searchHook={location.searchHook}>{children}</Router></QueryClientProvider>
  );
  render(<Harness />, { wrapper });
  const query = () => Object.fromEntries(new URLSearchParams(location.history!.at(-1)!.split("?")[1] ?? ""));
  return { location, query };
}

const DEFAULT_QUERY = { categoryId: "cat-1", tags: "tag-1", from: "2026-11-01", type: "expense" };
const openMenuItem = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
  await user.click(screen.getByRole("button", { name: "Filter presets" }));
  await user.click(await screen.findByRole("menuitem", { name }));
};

describe("Transactions filter presets (R11)", () => {
  beforeEach(() => {
    clearCsrfToken();
    server = { presets: [preset({})], calls: [] };
    stubServer();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("applies the default preset when the page opens with no filters, and reset returns to it", async () => {
    const { location, query } = renderAt("/transactions");
    await waitFor(() => expect(query()).toEqual(DEFAULT_QUERY));

    act(() => location.navigate("/transactions?q=coffee", { replace: true }));
    await waitFor(() => expect(query()).toEqual({ q: "coffee" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(query()).toEqual(DEFAULT_QUERY);
  });

  it("keeps a deep link's filters, and applying a preset replaces them all", async () => {
    const user = userEvent.setup();
    const { query } = renderAt("/transactions?accountId=acc-9&q=coffee");
    await screen.findByText("Groceries", { selector: "output" });
    expect(query()).toEqual({ accountId: "acc-9", q: "coffee" });

    await openMenuItem(user, /^Groceries/);
    expect(query()).toEqual(DEFAULT_QUERY);
  });

  it("saves the current filters as a named default preset, with dates as YYYY-MM-DD", async () => {
    server.presets = [];
    const user = userEvent.setup();
    renderAt("/transactions?categoryId=cat-2&from=2026-10-05&reviewed=unreviewed");
    await screen.findByText("none", { selector: "output" });

    await openMenuItem(user, "Save current filters");
    const dialog = await screen.findByRole("dialog", { name: "Save Filter Preset" });
    await user.type(within(dialog).getByLabelText("Preset Name"), "  Unreviewed food  ");
    await user.click(within(dialog).getByRole("checkbox", { name: "Set as default preset" }));
    await user.click(within(dialog).getByRole("button", { name: "Save Preset" }));

    await waitFor(() => expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1));
    expect(server.calls.find(c => c.method === "POST")!.body).toEqual({
      name: "Unreviewed food", context: "transactions", isDefault: true, isShared: false,
      filters: {
        search: "", accountId: null, categoryId: "cat-2", tagIds: [], startDate: "2026-10-05", endDate: null,
        amountMin: null, amountMax: null, type: "all", reviewed: "unreviewed", owner: "all",
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("deletes your own preset from Manage presets with the keyboard; the deleted default stops applying", async () => {
    server.presets = [preset({}), preset({ id: "p2", userId: "user-2", name: "Shared view", isDefault: false, isShared: true })];
    const user = userEvent.setup();
    const { query } = renderAt("/transactions");
    await waitFor(() => expect(query()).toEqual(DEFAULT_QUERY));

    await openMenuItem(user, "Manage presets");
    const dialog = await screen.findByRole("dialog", { name: "Manage Filter Presets" });
    expect(within(dialog).queryByRole("button", { name: "Delete preset Shared view" })).toBeNull();
    const deleteButton = within(dialog).getByRole("button", { name: "Delete preset Groceries" });
    for (let presses = 0; presses < 10 && document.activeElement !== deleteButton; presses++) await user.tab();
    expect(deleteButton).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(server.calls).toContainEqual({ method: "DELETE", url: "/api/filter-presets/p1", body: undefined }));
    await screen.findByText("none", { selector: "output" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(query()).toEqual({});
  });
});
