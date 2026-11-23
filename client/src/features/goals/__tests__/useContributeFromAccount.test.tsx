import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const apiCall = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiCall }));

import { isOverfundRefusal, useContributeFromAccount } from "../hooks/useContributeFromAccount";

/** #245, Astra round 2: an account-to-goal contribution is one server write. */
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const input = {
  accountId: "acc-1", amount: { amount: "10.00", currency: "USD" }, date: "2026-10-15",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

describe("useContributeFromAccount", () => {
  it("sends the expense and its link as one request, with the contribution's key", async () => {
    apiCall.mockResolvedValueOnce({ success: true, data: { transactionId: "txn-1", replayed: false, goal: {} } });
    const { result } = renderHook(() => useContributeFromAccount("goal-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...input, confirmOverfund: true });
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("/goals/goal-1/contributions/from-account", {
      method: "POST", body: JSON.stringify({ ...input, confirmOverfund: true }),
    });
  });

  it("tells the over-fund 409 apart from the constant hidden-goal refusal", () => {
    const overfund = Object.assign(new Error("This contribution of K200.00 would take the goal past its target. Confirm overfunding to record it anyway."), { status: 409 });
    const hidden = Object.assign(new Error("This goal's progress includes sources you cannot see, so you cannot add to it or edit it."), { status: 409 });
    expect([isOverfundRefusal(overfund), isOverfundRefusal(hidden)]).toEqual([true, false]);
  });
});
