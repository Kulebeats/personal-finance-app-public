/**
 * Sidebar Accessibility Tests (SCP-340)
 *
 * Verifies that the primary navigation:
 *  - marks the active route with aria-current="page"
 *  - exposes an accessible name for every nav item even when collapsed
 *    (the visible label text is hidden in collapsed mode)
 *  - exposes labelled, keyboard-operable collapse/expand controls
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Sidebar } from "@/components/layout/Sidebar";
import { NAV_GROUPS } from "@/components/layout/constants";

const allItems = NAV_GROUPS.flatMap((g) => g.items);

describe("Sidebar accessibility", () => {
  it("marks the active route with aria-current=page and no other", () => {
    render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        location="/transactions"
        profileName="Ada Lovelace"
      />,
    );

    const active = screen.getByRole("link", { name: "Transactions" });
    expect(active).toHaveAttribute("aria-current", "page");

    // Inactive items must not advertise themselves as the current page.
    const inactive = screen.getByRole("link", { name: "Dashboard" });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("gives every nav item an accessible name when collapsed", () => {
    render(
      <Sidebar
        collapsed={true}
        onToggle={vi.fn()}
        location="/"
        profileName="Ada Lovelace"
      />,
    );

    // Assistive technology encounters the native anchor itself, so a named
    // descendant div alone cannot satisfy the navigation contract.
    for (const item of allItems) {
      expect(
        screen.getByRole("link", { name: item.label }),
      ).toHaveAttribute("href", item.href);
    }
  });

  it("uses one native, named Profile link with no nested button or tab stop", async () => {
    const user = userEvent.setup();
    render(<Sidebar collapsed={true} onToggle={vi.fn()} location="/" profileName="Ada Lovelace" />);
    const profile = screen.getByRole("link", { name: "Profile: Ada Lovelace" });
    expect(profile).toHaveAttribute("href", "/profile");
    expect(profile.querySelector('[role="button"], button, [tabindex]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Profile: Ada Lovelace" })).not.toBeInTheDocument();
    profile.focus();
    expect(profile).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("link", { name: "Settings" })).toHaveFocus();
    await user.tab();
    expect(profile).toHaveFocus();
  });

  it("exposes a labelled, keyboard-operable collapse control when expanded", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <Sidebar
        collapsed={false}
        onToggle={onToggle}
        location="/"
        profileName="Ada Lovelace"
      />,
    );

    const collapseBtn = screen.getByRole("button", { name: /collapse sidebar/i });
    collapseBtn.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalled();
  });

  it("exposes a labelled expand control when collapsed", () => {
    render(
      <Sidebar
        collapsed={true}
        onToggle={vi.fn()}
        location="/"
        profileName="Ada Lovelace"
      />,
    );

    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("does not render a dead Help & Support control (R17: no unwired affordances)", () => {
    render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        location="/"
        profileName="Ada Lovelace"
      />,
    );

    expect(screen.queryByText("Help & Support")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /help & support/i }),
    ).not.toBeInTheDocument();
  });
});
