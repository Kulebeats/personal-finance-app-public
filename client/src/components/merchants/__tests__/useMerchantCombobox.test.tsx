import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMerchantCombobox } from "../useMerchantCombobox";

const KEYSTROKE_GAP_MS = 50;
const SETTLE_MS = 300;

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useMerchantCombobox autocomplete", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Serves both GET /api/merchants and the autocomplete endpoint.
    fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({ success: true, data: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("makes one autocomplete request for a burst of keystrokes", async () => {
    const { result } = renderHook(
      () => useMerchantCombobox({ value: "", selectedMerchantId: "" }),
      { wrapper: createWrapper() },
    );

    const name = "Starbucks Cafe"; // 14 characters
    for (let length = 1; length <= name.length; length++) {
      act(() => result.current.setSearchValue(name.slice(0, length)));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(KEYSTROKE_GAP_MS);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    });

    const autocompleteUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/api/merchants/autocomplete"));
    expect(autocompleteUrls).toHaveLength(1);
    expect(autocompleteUrls[0]).toContain("q=starbucks+cafe");
  });
});
