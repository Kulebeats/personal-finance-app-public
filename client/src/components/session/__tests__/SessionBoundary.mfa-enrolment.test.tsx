/**
 * @vitest-environment jsdom
 *
 * AH-11: after the 14-day grace a member without MFA sees an enrol-now step in
 * place of the app; inside the grace the app shows the deadline in a banner.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => session.current }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/SettingsContext", () => ({ SettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/security/StepUpProvider", () => ({ StepUpProvider: () => null }));
vi.mock("../HouseholdCalendarZone", () => ({
  HouseholdCalendarZone: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

import { SessionBoundary } from "../SessionBoundary";

const subject = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.invalid", displayName: null };
const lifetime = { operation: { id: "op-1" }, client: new QueryClient() };
const base = { loading: false, error: null, actionError: null, refresh: vi.fn(), lifetime };

describe("AH-11 mandatory MFA in the session boundary", () => {
  it("renders the enrol-now step instead of the app after the grace", () => {
    session.current = { ...base, status: { state: "mfa_enrolment_required", subject, graceEndedAt: "2026-12-07T10:00:00.000Z" } };
    render(<SessionBoundary><p>finances</p></SessionBoundary>);

    expect(screen.getByRole("heading", { name: /set up two-step verification/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^set up two-step verification$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^sign out$/i })).toBeEnabled();
    expect(screen.queryByText("finances")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("shows the deadline in a banner above the app during the grace", () => {
    session.current = { ...base, status: {
      state: "ready", subject, household: { id: "22222222-2222-4222-8222-222222222222", role: "owner" },
      mfa: { state: "grace", graceEndsAt: "2026-12-07T10:00:00.000Z", daysRemaining: 9 },
    } };
    render(<SessionBoundary><p>finances</p></SessionBoundary>);

    expect(screen.getByText("finances")).toBeInTheDocument();
    const banner = screen.getByRole("region", { name: /two-step verification/i });
    expect(within(banner).getByText(/required from/i)).toHaveTextContent(/2026/);
    expect(within(banner).getByText(/9 days left/i)).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: /set it up now/i })).toHaveAttribute("href", "/settings/security");
  });

  it("shows no banner for a member who already uses MFA", () => {
    session.current = { ...base, status: {
      state: "ready", subject, household: { id: "22222222-2222-4222-8222-222222222222", role: "owner" },
    } };
    render(<SessionBoundary><p>finances</p></SessionBoundary>);

    expect(screen.getByText("finances")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /two-step verification/i })).not.toBeInTheDocument();
  });
});
