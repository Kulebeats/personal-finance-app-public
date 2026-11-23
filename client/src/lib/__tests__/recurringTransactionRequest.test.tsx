/**
 * @vitest-environment jsdom
 *
 * NEW-10 (Rule 18 client-server contract): Add Transaction with "make
 * recurring" must post a body the server accepts, to the route that parses it.
 * The schema is imported from the server, not restated here.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { useCreateRecurringTransaction } from "@/hooks/useRecurring";
import type { TransactionFormValues } from "@/components/transactions/form/schema";
import { buildRecurringTransactionRequest, mapServerFieldErrors } from "../recurringTransactionRequest";
import { createRecurringFromTransactionSchema } from "../../../../server/modules/recurring/recurring.validation";
import { ValidationError } from "../../../../server/core/errors/ValidationError";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const accountId = "6f1f6c58-4b7e-4f0e-9a43-3c1f2b7d9e10";
const formValues: TransactionFormValues = {
  type: "expense", amount: "12.35", merchantName: "Synthetic gym", date: new Date(2026, 10, 10), accountId,
  isRecurring: true, recurringFrequency: "monthly", recurringAmountType: "fixed", recurringAmountTolerance: 0,
  recurringReminderDays: 3, recurringReminderEmail: false, recurringReminderPush: false, recurringReminderInApp: true,
  recurringAutoLinkEnabled: true, recurringAutoMarkReviewed: false, recurringIsSubscription: false, tags: [],
};

const mockFetch = vi.fn();
const jsonResponse = (status: number, body: unknown): Response => ({
  ok: status < 400, status, headers: { get: () => "application/json" }, json: vi.fn().mockResolvedValue(body),
}) as unknown as Response;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("Add Transaction recurring request matches the server contract", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/csrf-token")
        ? Promise.resolve(jsonResponse(200, { csrfToken: "test-csrf" }))
        : mockFetch(input, init)));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("posts the form's body to /api/recurring/transaction, where the server schema accepts it", async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { success: true, data: {
      transaction: { id: "t1", name: "Synthetic gym" }, recurringRule: { id: "r1" }, isDuplicate: false,
    } }));
    const body = buildRecurringTransactionRequest(formValues, {
      name: "Synthetic gym", currency: "ZMW", idempotencyKey: "0b8f9a52-3c1d-4e6f-8a7b-9c0d1e2f3a4b",
    });
    const { result } = renderHook(() => useCreateRecurringTransaction(), { wrapper });

    await act(async () => { await result.current.mutateAsync(body); });

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(["/api/recurring/transaction"]);
    const sent = JSON.parse(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    const parsed = createRecurringFromTransactionSchema.safeParse(sent);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(parsed.success && parsed.data).toMatchObject({
      accountId, name: "Synthetic gym", type: "expense", date: "2026-11-10", amount: "12.35", currency: "ZMW",
      recurring: { frequency: "monthly", startDate: "2026-11-10" },
    });
  });

  it("puts the server's 400 field messages on the form fields that own them", async () => {
    // Serialized exactly as the controller does: ValidationError(zod issues) -> error.fields.
    const parsed = createRecurringFromTransactionSchema.safeParse({
      accountId, name: "Synthetic gym", type: "expense", date: "2026-11-10", amount: { amount: "12.35" }, recurring: {},
    });
    if (parsed.success) throw new Error("expected the server schema to reject the body");
    const serverError = new ValidationError("Invalid request data", parsed.error.errors).toJSON().error;
    mockFetch.mockResolvedValue(jsonResponse(400, { success: false, error: serverError }));
    const { result } = renderHook(() => useCreateRecurringTransaction(), { wrapper });

    const thrown = await act(async () => result.current.mutateAsync(buildRecurringTransactionRequest(formValues, {
      name: "Synthetic gym", currency: "ZMW",
    })).then(() => null, (error: unknown) => error));

    const mapped = mapServerFieldErrors(thrown);
    expect(mapped.fieldErrors).toEqual(expect.arrayContaining([
      { field: "amount", message: expect.any(String) },
      { field: "recurringFrequency", message: expect.any(String) },
    ]));
    expect(mapped.summary).toBe("Check the highlighted fields.");
    expect(mapServerFieldErrors(new Error("Network down"))).toEqual({ fieldErrors: [], summary: null });
  });
});
