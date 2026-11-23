/**
 * @vitest-environment jsdom
 *
 * The verification-required gate must render its four actions as real,
 * keyboard-reachable controls with clear names.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ refresh: vi.fn(), actionError: null }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { PendingVerification } from "../SessionBoundary";

describe("verification-required gate", () => {
  it("renders its actions as accessible, named controls", () => {
    render(<PendingVerification />);

    expect(screen.getByRole("heading", { name: /verify your email/i })).toBeInTheDocument();
    for (const name of [/^refresh verification status$/i, /^resend verification email$/i, /^sign out$/i]) {
      const button = screen.getByRole("button", { name });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
    // Account recovery navigates, so it is a link styled as a button.
    expect(screen.getByRole("link", { name: /^account recovery$/i })).toHaveAttribute("href", "/forgot-password");
  });
});
