/**
 * ReviewStep — target-account picker envelope regression test.
 *
 * GET /api/accounts returns the V7 envelope { success: true, data: Account[] }
 * (server/modules/accounts/accounts.controller.ts `list` -> success(res, accounts),
 * server/core/http/responses.ts). `data` IS the bare accounts array — there is
 * no nested `accounts` key. This test mocks the endpoint with the real envelope
 * shape and asserts the picker renders the accounts, guarding against the
 * `response.data.accounts` misread that left the picker permanently empty and
 * blocked the CSV import flow at the Review step.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ReviewStep } from "../steps/ReviewStep";
import { ImportWizardProvider } from "../ImportWizardContext";
import { getQueryFn } from "@/lib/queryClient";
import type { Account } from "@/lib/api";

function makeAccount(overrides: Partial<Account> & Pick<Account, "id" | "name" | "type">): Account {
  return {
    householdId: "hh-1",
    balance: "1000.00",
    initialBalance: "1000.00",
    currency: "ZMW",
    isAsset: true,
    isPrivate: false,
    isHidden: false,
    isArchived: false,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// The REAL envelope shape: data is the bare Account[] (no nested `accounts` key).
const accountsEnvelope: { success: boolean; data: Account[] } = {
  success: true,
  data: [
    makeAccount({ id: "acc-1", name: "Everyday Checking", type: "checking" }),
    makeAccount({ id: "acc-2", name: "Rainy Day Savings", type: "savings" }),
  ],
};

const originalFetch = global.fetch;

function renderReviewStep() {
  // Same default queryFn the app uses (client/src/lib/queryClient.ts), so the
  // component receives exactly what production receives: the raw envelope JSON.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ImportWizardProvider>
        <ReviewStep />
      </ImportWizardProvider>
    </QueryClientProvider>,
  );
}

describe("ReviewStep target-account picker", () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/accounts")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(accountsEnvelope),
          text: () => Promise.resolve(JSON.stringify(accountsEnvelope)),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch in test: ${url}`));
    }) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the accounts from the V7 envelope (data IS the array)", async () => {
    const user = userEvent.setup();
    renderReviewStep();

    // The Radix Select trigger is the only combobox on this step.
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    expect(
      await screen.findByRole("option", { name: /Everyday Checking \(checking\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Rainy Day Savings \(savings\)/i }),
    ).toBeInTheDocument();
  });
});
