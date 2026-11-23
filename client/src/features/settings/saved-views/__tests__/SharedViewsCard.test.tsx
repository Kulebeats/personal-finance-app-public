import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedViewResponse } from "@shared/saved-views";
import { SharedViewsCard } from "../SharedViewsCard";

const SHARED = "11111111-1111-4111-8111-111111111111";
const PRIVATE = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({ api: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<typeof import("@/lib/queryClient")>()), apiRequest: mocks.api,
}));
vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()), useLocation: () => ["/settings/members", mocks.navigate],
}));
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ data: [
    { id: SHARED, name: "Family current", isPrivate: false },
    { id: PRIVATE, name: "Alice private savings", isPrivate: true },
  ] }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { categories: [{ id: CATEGORY, name: "Groceries" }], groups: [] } }),
}));

function view(overrides: Partial<SavedViewResponse>): SavedViewResponse {
  return {
    id: "44444444-4444-4444-8444-444444444444", name: "Groceries this month", restricted: false,
    filter: { categoryId: CATEGORY, type: "expense", startDate: "2026-11-01", endDate: "2026-11-30" },
    createdBy: SHARED, createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z", version: 3,
    ...overrides,
  };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
let views: SavedViewResponse[] = [];

function mount(canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SharedViewsCard canManage={canManage} /></QueryClientProvider>);
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.api.mockReset();
  views = [view({}), view({ id: "55555555-5555-4555-8555-555555555555", name: "Hidden account view", restricted: true, filter: {} })];
  mocks.api.mockImplementation(async (method: string) => (method === "GET" ? json(views) : method === "DELETE"
    ? new Response(null, { status: 204 }) : json(view({ name: "Saved" }), method === "POST" ? 201 : 200)));
});
afterEach(cleanup);

describe("SharedViewsCard", () => {
  it("lets a member apply a view to the Transactions list but not manage it", async () => {
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Apply Groceries this month" }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      `/transactions?categoryId=${CATEGORY}&from=2026-11-01&to=2026-11-30&type=expense`,
    );
    expect(screen.getByRole("button", { name: "Apply Hidden account view" })).toBeDisabled();
    expect(screen.getByText(/can't be applied/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("creates a view from shared accounts only and sends only the chosen conditions", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: /new view/i }));
    const dialog = await screen.findByRole("dialog");
    const accountSelect = within(dialog).getByLabelText("Shared account");
    expect(within(accountSelect).queryByText("Alice private savings")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Family spend " } });
    fireEvent.change(accountSelect, { target: { value: SHARED } });
    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: "expense" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("POST", "/api/settings/saved-views", {
      name: "Family spend", filter: { accountId: SHARED, type: "expense" },
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits with the current version and shows a conflict without closing", async () => {
    mocks.api.mockImplementation(async (method: string) => {
      if (method === "GET") return json(views);
      throw new Error("This saved view was changed by someone else. Reload it and try again.");
    });
    mount(true);
    // A manager who cannot see the view's account cannot edit it (saving would drop the account and widen it).
    expect(await screen.findByRole("button", { name: "Edit Hidden account view" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Groceries this month" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Weekly groceries" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/changed by someone else/);
    expect(mocks.api).toHaveBeenCalledWith("PUT", "/api/settings/saved-views/44444444-4444-4444-8444-444444444444", {
      name: "Weekly groceries", version: 3,
      filter: { categoryId: CATEGORY, type: "expense", startDate: "2026-11-01", endDate: "2026-11-30" },
    });
  });

  it("deletes after confirmation with the current version", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Groceries this month" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete view" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
      "DELETE", "/api/settings/saved-views/44444444-4444-4444-8444-444444444444?version=3",
    ));
  });
});
