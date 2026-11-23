/**
 * @vitest-environment jsdom
 *
 * First-run pages have no TopBar, so the shell itself must offer the
 * light/dark switch.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// The form needs a QueryClient; the theme control is what is under test.
vi.mock("@/pages/settings/sections/HouseholdSection/components/CreateHouseholdForm", () => ({
  CreateHouseholdForm: () => <p>Create household form</p>,
}));

import { PersonalSessionShell } from "../PersonalSessionShell";

describe("create-household page", () => {
  it("offers the theme toggle", () => {
    render(<PersonalSessionShell />);

    expect(screen.getByText("Create household form")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });
});
