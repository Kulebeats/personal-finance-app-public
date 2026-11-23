/**
 * @vitest-environment jsdom
 *
 * AH-11 follow-up: after the grace, MFA is mandatory, so the card offers no
 * "Turn off" (the server refuses it with 409). Inside the grace it still does.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MfaCard } from "../MfaCard";

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

function renderWithStatus(status: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<MfaCard />, { wrapper });
}

const on = { mfaEnabled: true, mfaMethod: "email", backupCodesRemaining: 8, lowCodesWarning: false, policy: { required: true, state: "compliant" } };

describe("AH-11 MfaCard and the mandatory-MFA policy", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("hides Turn off after the grace and says why", async () => {
    renderWithStatus({ ...on, canDisable: false });

    expect(await screen.findByText(/required for every member/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create new backup codes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^turn off$/i })).not.toBeInTheDocument();
  });

  it("still offers Turn off inside the grace", async () => {
    renderWithStatus({ ...on, canDisable: true });

    expect(await screen.findByRole("button", { name: /^turn off$/i })).toBeInTheDocument();
    expect(screen.queryByText(/required for every member/i)).not.toBeInTheDocument();
  });
});
