/**
 * GoalProjectionCalculator hits POST /api/goals/calculate-projection — a
 * route that did not exist server-side (client-server contract gap, see
 * docs/reviews/production-readiness-audit-v2-2026-07-11.md). This test
 * proves the component calls the real, now-wired route and renders the
 * server's projection result.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { GoalProjectionCalculator } from "../GoalProjectionCalculator";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

describe("GoalProjectionCalculator", () => {
  const calls: RecordedCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        if (url.includes("/api/settings/display")) {
          // Not under test here — GoalProjectionCalculator's formatCurrency
          // call falls back to ZMW/US defaults while this is unresolved.
          return jsonResponse({ error: { message: "not needed" } }, 404);
        }
        calls.push({ url, init });
        return jsonResponse({
          success: true,
          data: {
            projectedAmount: 2718.28,
            totalContributed: 2200,
            requiredMonthlyContribution: null,
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("POSTs the real /api/goals/calculate-projection route with x-csrf-token and renders the result", async () => {
    const user = userEvent.setup();
    render(<GoalProjectionCalculator />, { wrapper: createWrapper() });

    await user.click(
      screen.getByRole("button", { name: /calculate projection/i }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/goals/calculate-projection");
    expect(calls[0].init?.method).toBe("POST");
    expect(
      (calls[0].init?.headers as Record<string, string>)["x-csrf-token"],
    ).toBe("test-csrf");

    const body = JSON.parse(String(calls[0].init?.body));
    // Defaults from the component's initial state.
    expect(body).toMatchObject({
      currentAmount: 0,
      monthlyContribution: 1000,
      returnRate: 12,
      inflationRate: 5,
      years: 5,
    });

    // Renders the server's response, not a client-computed guess.
    await waitFor(() =>
      expect(screen.getByText("K2,718.28")).toBeInTheDocument(),
    );
  });
});
