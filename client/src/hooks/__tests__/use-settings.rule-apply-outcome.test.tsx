/**
 * @vitest-environment jsdom
 *
 * A-32: saving a rule with "apply to past" says what the apply did. When the
 * server reports rows that failed, Settings warns and names them instead of
 * "Rule created successfully".
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { clearCsrfToken } from "@/lib/api";
import { useCreateRule, useUpdateRule } from "../use-settings";

const json = (body: unknown): Response => ({
  ok: true,
  headers: { get: () => "application/json" },
  json: vi.fn().mockResolvedValue(body),
}) as unknown as Response;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const rule = { id: "rule-1", name: "Coffee to goal" };
const failedOutcome = {
  updated: 1,
  failed: 1,
  failures: [{
    transactionId: "t-1", name: "SHAREDTXN coffee", date: "2026-10-05",
    code: "VALIDATION_ERROR", message: "Transaction is already linked to this goal",
  }],
};

/** The server's save reply carries `data`; the CSRF token fetch is served too. */
function serve(data: unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(
    String(input).includes("/csrf-token") ? json({ csrfToken: "test-csrf" }) : json({ success: true, data }),
  )));
}

describe("rule save reports the apply-to-past outcome (A-32)", () => {
  beforeEach(() => clearCsrfToken());
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("warns and names the row that could not be changed when creating", async () => {
    const warning = vi.spyOn(toast, "warning");
    const success = vi.spyOn(toast, "success");
    serve({ rule, applied: failedOutcome });
    const { result } = renderHook(() => useCreateRule(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "Coffee to goal", conditions: [], conditionLogic: "all", actions: [], applyToPast: true });
    });

    expect(success).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith("Rule created, but 1 past transaction could not be changed", {
      description: "Applied to 1 past transaction. SHAREDTXN coffee (2026-10-05): Transaction is already linked to this goal",
      duration: 12_000,
    });
  });

  it("says how many rows changed when every row went through, and stays plain without apply-to-past", async () => {
    const success = vi.spyOn(toast, "success");
    serve({ rule, applied: { updated: 3, failed: 0, failures: [] } });
    const update = renderHook(() => useUpdateRule(), { wrapper });
    await act(async () => { await update.result.current.mutateAsync({ id: "rule-1", data: { applyToPast: true } }); });
    expect(success).toHaveBeenCalledWith("Rule updated successfully", { description: "Applied to 3 past transactions." });

    serve({ rule });
    const create = renderHook(() => useCreateRule(), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({ name: "Plain", conditions: [], conditionLogic: "all", actions: [], applyToPast: false });
    });
    expect(success).toHaveBeenLastCalledWith("Rule created successfully");
  });
});
