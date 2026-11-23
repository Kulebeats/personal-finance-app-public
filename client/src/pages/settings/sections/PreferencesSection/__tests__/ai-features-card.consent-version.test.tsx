/**
 * Astra #255 r3: the settings AI card shows the current disclosure, and
 * turning AI on grants exactly the disclosure version it showed. Turning it
 * off is a revoke and names no version.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIFeaturesCard } from "../components/AIFeaturesCard";
import type { AIConsentStatus } from "@/hooks/use-settings";

afterEach(() => cleanup());

function status(consentGiven: boolean): AIConsentStatus {
  return {
    consentGiven,
    consentDate: null,
    consentVersion: consentGiven ? "v2.0" : null,
    currentVersion: "v2.0",
    needsReconsent: false,
  };
}

describe("AIFeaturesCard consent version", () => {
  it("shows the disclosure and grants the version it shows", async () => {
    const onUpdate = vi.fn();
    render(<AIFeaturesCard preferences={status(false)} onUpdate={onUpdate} />);

    expect(screen.getByText(/Anthropic Claude/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /enable ai features/i }));

    expect(onUpdate).toHaveBeenCalledWith({ consentGiven: true, consentVersion: "v2.0" });
  });

  it("revokes without a version", async () => {
    const onUpdate = vi.fn();
    render(<AIFeaturesCard preferences={status(true)} onUpdate={onUpdate} />);

    await userEvent.click(screen.getByRole("switch", { name: /enable ai features/i }));

    expect(onUpdate).toHaveBeenCalledWith({ consentGiven: false });
  });
});
