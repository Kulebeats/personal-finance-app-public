/**
 * HouseholdSection - structural "no household yet" detection (FIX P7b-3)
 *
 * Same bug as the Dashboard onboarding gate lived here too: isNotFound used
 * to substring-match the server's error message ("No household found").
 * This proves the section now keys off the structural HOUSEHOLD_NOT_FOUND
 * code / 404 status instead, so a reworded server message still shows the
 * create-household form rather than a raw error string.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HouseholdSection from "../index";

vi.mock("../components/CreateHouseholdForm", () => ({
  CreateHouseholdForm: () => <div>create-household-form</div>,
}));

vi.mock("../components/EditHouseholdForm", () => ({
  EditHouseholdForm: () => <div>edit-household-form</div>,
}));

const mockFetch = vi.fn();

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HouseholdSection />
    </QueryClientProvider>,
  );
}

const jsonResponse = (body: unknown, ok: boolean) =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

describe("HouseholdSection - no-household detection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("shows the create-household form when the server returns the structural HOUSEHOLD_NOT_FOUND code", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "HOUSEHOLD_NOT_FOUND", message: "No household found" } },
        false,
      ),
    );

    renderWithClient();

    expect(await screen.findByText("create-household-form")).toBeInTheDocument();
  });

  // The whole point of the fix: a reworded message must not break detection.
  it("still shows the create-household form when the message is reworded, keyed off the structural code", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "HOUSEHOLD_NOT_FOUND", message: "This account has not created a household yet." },
        },
        false,
      ),
    );

    renderWithClient();

    expect(await screen.findByText("create-household-form")).toBeInTheDocument();
  });

  it("does not show the create-household form for an unrelated server error", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
        false,
      ),
    );

    renderWithClient();

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("create-household-form")).not.toBeInTheDocument();
  });
});
