/**
 * @vitest-environment jsdom
 *
 * Rule 18 (client-server contract) for the rule endpoints used by the Rules
 * screen. Response bodies below are copied from the server code
 * (server/modules/rules/rules.controller.ts), not from the client types.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useTestRule,
  usePreviewRule,
  useReorderRules,
  RULE_TEST_MATCH_LIMIT,
  type RuleCondition,
} from "../use-settings";

const mockFetch = vi.fn();

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

// rulesController.preview -> success(res, { matchingTransactions, count, totalChecked })
const serverPreviewBody = {
  success: true,
  data: {
    matchingTransactions: [
      {
        id: "t1",
        date: "2026-11-10",
        name: "Shoprite Manda Hill",
        amount: "250.00",
        type: "expense",
        categoryId: null,
      },
      {
        id: "t2",
        date: "2026-11-12",
        name: "Shoprite Levy",
        amount: "90.50",
        type: "expense",
        categoryId: null,
      },
    ],
    count: 2,
    totalChecked: 200,
  },
};

const conditions: RuleCondition[] = [
  { type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true },
];

const sentRequest = (path: string): { init: RequestInit; body: unknown } => {
  const call = mockFetch.mock.calls.find(([url]) => url === path);
  if (!call) throw new Error(`no request to ${path}`);
  const init = call[1] as RequestInit;
  return { init, body: JSON.parse(String(init.body)) };
};

describe("rules endpoints match the server contract", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/csrf-token")
          ? Promise.resolve(jsonResponse({ csrfToken: "test-csrf" }))
          : mockFetch(input, init),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("Test button posts the saved rule's conditions to /rules/preview, not /rules/:id/test", async () => {
    mockFetch.mockResolvedValue(jsonResponse(serverPreviewBody));
    const { result } = renderHook(() => useTestRule(), { wrapper });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        conditions,
        conditionLogic: "any",
      });
    });

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(["/api/rules/preview"]);
    const { init, body } = sentRequest("/api/rules/preview");
    expect(init.method).toBe("POST");
    expect(body).toEqual({
      conditions,
      conditionLogic: "any",
      limit: RULE_TEST_MATCH_LIMIT,
    });
    expect(outcome).toEqual({ matchCount: 2, totalChecked: 200, isCapped: false });
  });

  it("preview exposes matchingTransactions, count and totalChecked as the server sends them", async () => {
    mockFetch.mockResolvedValue(jsonResponse(serverPreviewBody));
    const { result } = renderHook(() => usePreviewRule(), { wrapper });

    let data: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({ conditions, conditionLogic: "all" });
    });

    expect(data?.matchingTransactions.map((t) => t.name)).toEqual([
      "Shoprite Manda Hill",
      "Shoprite Levy",
    ]);
    expect(data?.count).toBe(2);
    expect(data?.totalChecked).toBe(200);
  });

  it("reorder sends { rules: [{ id, priority }] } as rulesController.reorder reads it", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: true, data: { message: "Rules reordered" } }),
    );
    const { result } = renderHook(() => useReorderRules(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(["rule-b", "rule-a"]);
    });

    const { init, body } = sentRequest("/api/rules/reorder");
    expect(init.method).toBe("PUT");
    expect(body).toEqual({
      rules: [
        { id: "rule-b", priority: 0 },
        { id: "rule-a", priority: 1 },
      ],
    });
  });
});
