/**
 * GRZ securities hooks must unwrap the V7 envelope { success, data }.
 *
 * P8a converts server/routes/grz-securities.ts from raw arrays/objects to the
 * V7 envelope. This is the regression net proving the client consumers were
 * updated in the same change — before the fix, these hooks returned the raw
 * envelope object instead of the bond/T-bill data, which would silently break
 * every GRZ list and mutation in the UI (empty tables, `.map is not a
 * function`, etc.) without a single test catching it.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useGrzBonds,
  useGrzTBills,
  useCreateGrzBond,
  useMarkGrzPaymentPaid,
  type GrzBond,
  type GrzTBill,
} from "../useGrzSecurities";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const bondFixture: GrzBond = {
  id: "bond-1",
  bondName: "GRZ 5Y 2031",
  isin: null,
  tenorYears: 5,
  faceValue: { amount: "100000.00", currency: "ZMW" },
  purchasePrice: { amount: "98000.00", currency: "ZMW" },
  purchaseDate: "2026-01-01",
  purchaseYield: null,
  couponRate: "11.0000",
  couponFrequency: 2,
  maturityDate: "2031-01-01",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const tbillFixture: GrzTBill = {
  id: "tbill-1",
  tbillName: "GRZ 91-Day",
  isin: null,
  tenorDays: 91,
  faceValue: { amount: "10000.00", currency: "ZMW" },
  purchasePrice: { amount: "9636.30", currency: "ZMW" },
  purchaseDate: "2026-01-01",
  purchaseYield: "0.1514",
  discountAmount: { amount: "363.70", currency: "ZMW" },
  maturityDate: "2026-04-02",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("GRZ securities hooks unwrap the V7 envelope", () => {
  beforeEach(() => {
    clearCsrfToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("useGrzBonds returns the bond array from envelope.data, not the envelope itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/grz/bonds")) {
          return jsonResponse({ success: true, data: [bondFixture] });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const { result } = renderHook(() => useGrzBonds(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // If the hook forgot to unwrap `.data`, this would be the envelope object
    // `{ success: true, data: [...] }`, not an array — Array.isArray would be
    // false and bondName would be undefined.
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("bond-1");
    expect(result.current.data?.[0].bondName).toBe("GRZ 5Y 2031");
  });

  it("useGrzTBills returns the T-bill array from envelope.data, not the envelope itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/grz/tbills")) {
          return jsonResponse({ success: true, data: [tbillFixture] });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );

    const { result } = renderHook(() => useGrzTBills(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("tbill-1");
    expect(result.current.data?.[0].tbillName).toBe("GRZ 91-Day");
  });

  it("useCreateGrzBond resolves with the created bond, not the envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        return jsonResponse({ success: true, data: bondFixture }, 201);
      }),
    );

    const { result } = renderHook(() => useCreateGrzBond(), {
      wrapper: createWrapper(),
    });

    const created = await result.current.mutateAsync({
      bondName: "GRZ 5Y 2031",
    });

    // If the mutation forgot to unwrap `.data`, `created` would be the
    // envelope `{ success, data }`, and `created.id` would be undefined.
    expect(created.id).toBe("bond-1");
    expect(created.bondName).toBe("GRZ 5Y 2031");
  });

  it("useMarkGrzPaymentPaid resolves with the updated payment, not the envelope", async () => {
    const paymentFixture = {
      id: "pay-1",
      paymentDate: "2026-07-01",
      paymentType: "coupon" as const,
      grossAmount: { amount: "625.00", currency: "ZMW" },
      withholdingTax: { amount: "93.75", currency: "ZMW" },
      netAmount: { amount: "531.25", currency: "ZMW" },
      status: "paid" as const,
      actualPaymentDate: "2026-07-01",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/csrf-token")) {
          return jsonResponse({ csrfToken: "test-csrf" });
        }
        return jsonResponse({ success: true, data: paymentFixture });
      }),
    );

    const { result } = renderHook(() => useMarkGrzPaymentPaid(), {
      wrapper: createWrapper(),
    });

    const updated = await result.current.mutateAsync({
      id: "pay-1",
      accountId: "acc-1",
    });

    expect(updated.id).toBe("pay-1");
    expect(updated.status).toBe("paid");
  });
});
