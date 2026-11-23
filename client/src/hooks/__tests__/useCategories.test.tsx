import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCategories } from "../useCategories";

afterEach(() => vi.unstubAllGlobals());

describe("category picker response mapping", () => {
  it("maps the supplied groups onto real categories without fabricating missing references", async () => {
    const categories = [
      { id: "salary", name: "Salary", householdId: "home", groupId: "income" },
      { id: "food", name: "Food", householdId: "home", groupId: "expenses" },
      { id: "orphan", name: "Missing group", householdId: "home", groupId: "absent", groupType: "income" },
      { id: "foreign", name: "Foreign group", householdId: "home", groupId: "foreign" },
    ];
    const groups = [
      { id: "income", householdId: "home", name: "Income", type: "income" },
      { id: "expenses", householdId: "home", name: "Living", type: "expenses" },
      { id: "foreign", householdId: "another-home", name: "Private", type: "income" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { categories, groups } }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result, unmount } = renderHook(() => useCategories(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.categories.map(({ id, groupName, groupType }) => ({ id, groupName, groupType }))).toEqual([
      { id: "salary", groupName: "Income", groupType: "income" },
      { id: "food", groupName: "Living", groupType: "expenses" },
      { id: "orphan", groupName: null, groupType: null },
      { id: "foreign", groupName: null, groupType: null },
    ]);
    expect(categories[0]).not.toHaveProperty("groupType");
    expect(fetchMock).toHaveBeenCalledOnce();
    unmount();
    client.clear();
  });
});
