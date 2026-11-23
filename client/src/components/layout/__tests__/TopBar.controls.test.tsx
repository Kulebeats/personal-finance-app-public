/**
 * NEW-37 (R18.2): the TopBar offered a "Mine / Joint View / Partner" radiogroup
 * with no handler and a hard-coded checked state, while no page reads a
 * household view scope. An offered control must work or be removed, so the
 * bar offers no account-view selector; every control it does render has an
 * accessible name.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";

vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => <button type="button" aria-label="Notifications" />,
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/layout/ProfileMenu", () => ({ ProfileMenu: () => null }));

import { TopBar } from "@/components/layout/TopBar";

function renderBar() {
  render(
    <Sheet>
      <TopBar navigationTriggerRef={{ current: null }} breadcrumbs={[{ href: "/transactions", label: "Transactions" }]}
        onToggleCommandPalette={vi.fn()} profile={null} />
    </Sheet>,
  );
}

describe("TopBar controls", () => {
  it("offers no inert account-view selector", () => {
    renderBar();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("Joint View")).not.toBeInTheDocument();
  });

  it("gives every button an accessible name", () => {
    renderBar();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toHaveAccessibleName();
  });
});
