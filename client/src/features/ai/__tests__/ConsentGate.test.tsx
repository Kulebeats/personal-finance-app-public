/**
 * @vitest-environment jsdom
 *
 * ConsentGate — role-aware consent-first flow (spec UI-AI-002).
 * Admin/owner see the "Enable Thandi" action; members see a non-actionable
 * notice (POST /api/ai/consent is admin+ only and would 403).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentGate } from "../components/ConsentGate";
import {
  AI_ROUTES,
  bodyOf,
  consentAbsentFixture,
  createFetchRouter,
  createWrapper,
  jsonResponse,
} from "./chatTestUtils";
import type { UseQueryResult } from "@tanstack/react-query";
import type { HouseholdMember, UserProfile } from "@/hooks/use-settings";

// Role detection composes useProfile + useHouseholdMembers. Override just
// those two hooks; everything else in use-settings stays real (spread of the
// original module keeps the mock complete — repo single-worker gotcha).
const mockUseProfile = vi.fn();
const mockUseHouseholdMembers = vi.fn();

vi.mock("@/hooks/use-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-settings")>();
  return {
    ...original,
    useProfile: (...args: []) => mockUseProfile(...args),
    useHouseholdMembers: (...args: []) => mockUseHouseholdMembers(...args),
  };
});

function asQueryResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null } as UseQueryResult<T, Error>;
}

function stubRole(role: string | null): void {
  mockUseProfile.mockReturnValue(
    asQueryResult({ id: "u1" } as unknown as UserProfile),
  );
  const members: HouseholdMember[] = role
    ? [
        {
          id: "m1",
          householdId: "hh-1",
          userId: "u1",
          role,
          joinedAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: null,
          user: null,
        } as unknown as HouseholdMember,
      ]
    : [];
  mockUseHouseholdMembers.mockReturnValue(asQueryResult(members));
}

function renderGate(
  consent = consentAbsentFixture,
): ReturnType<typeof createFetchRouter> {
  const router = createFetchRouter();
  router.install();
  const { wrapper: Wrapper } = createWrapper();
  render(
    <Wrapper>
      <ConsentGate consent={consent} />
    </Wrapper>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ConsentGate", () => {
  it("shows the disclosure copy including the not-financial-advice notice", () => {
    stubRole("admin");
    renderGate();

    expect(screen.getByText(/not financial advice/i)).toBeInTheDocument();
    expect(
      screen.getByText(/revoke consent any time in Settings/i),
    ).toBeInTheDocument();
  });

  it("lets an admin enable Thandi via POST /api/ai/consent", async () => {
    stubRole("admin");
    const router = renderGate();
    const consentRoute = router.on("POST", AI_ROUTES.consent, () =>
      jsonResponse({
        consentGiven: true,
        consentDate: "2026-07-17T10:00:00.000Z",
        consentVersion: "v1.0",
      }),
    );

    const enable = screen.getByRole("button", { name: /enable thandi/i });
    await userEvent.click(enable);

    await waitFor(() => expect(consentRoute.calls).toHaveLength(1));
    expect(bodyOf(consentRoute.calls[0])).toEqual({ consentGiven: true });
  });

  it("shows the enable action for an owner too", () => {
    stubRole("owner");
    renderGate();

    expect(
      screen.getByRole("button", { name: /enable thandi/i }),
    ).toBeInTheDocument();
  });

  it("shows a non-actionable notice to non-admin members instead of a button", () => {
    stubRole("member");
    renderGate();

    expect(
      screen.queryByRole("button", { name: /enable thandi/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/ask a household admin to enable thandi/i),
    ).toBeInTheDocument();
  });

  it("shows the re-consent variant when the disclosure version changed", () => {
    stubRole("admin");
    renderGate({
      ...consentAbsentFixture,
      consentGiven: true,
      consentVersion: "v0.9",
      needsReconsent: true,
    });

    expect(
      screen.getByText(/disclosure has been updated/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enable thandi/i }),
    ).toBeInTheDocument();
  });
});
