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

    const active = screen.getByText("Transactions").closest("[aria-current]");
    expect(active).toHaveAttribute("aria-current", "page");

    // Inactive items must not advertise themselves as the current page.
    const inactive = screen.getByText("Dashboard").closest("div");
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

    // Labels are visually hidden when collapsed, so each item must carry an
    // aria-label to remain reachable by assistive tech.
    for (const item of allItems) {
      expect(
        screen.getByLabelText(item.label, { selector: "[aria-current], div" }),
      ).toBeInTheDocument();
    }
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
