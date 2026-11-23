/**
 * @vitest-environment jsdom
 *
 * Budget Settings and Edit Budget are real dialogs (lane 7 (b)1): role
 * "dialog", aria-modal, named by their title and described; Escape closes
 * them, focus stays inside and returns to the opener; the budget system is a
 * radio group chosen from the keyboard.
 */
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BudgetSettingsModal } from "../components/BudgetSettingsModal";
import { BudgetEditModal } from "../components/BudgetEditModal";
import { useDialogOpener } from "../hooks/useDialogOpener";
import type { BudgetEditData } from "../types";

vi.mock("../components/BudgetRecalculationPreview", () => ({ BudgetRecalculationPreview: () => null }));

interface HarnessProps {
  onSave?: () => void;
  isSaving?: boolean;
  /** Safari: a pointer press on a button does not focus it. */
  isOpenerUnfocusable?: boolean;
}

function SettingsHarness({ onSave = vi.fn(), isSaving = false, isOpenerUnfocusable = false }: HarnessProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onMouseDown={(event) => { if (isOpenerUnfocusable) event.preventDefault(); }}
        onClick={() => setIsOpen(true)}>Settings</button>
      <BudgetSettingsModal
        preview={{} as never}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        budgetSystem="flex"
        defaultApplyScope="this_month"
        onSaveSettings={onSave}
        categories={[]}
        categoryGroups={[]}
        onClear={vi.fn()}
        isSaving={isSaving}
        isClearing={false}
      />
    </>
  );
}

/**
 * Two plain buttons and a Budget Settings dialog opened by a window event, so
 * opening it records no press: only what happened before decides the opener.
 */
function EventOpenedHarness() {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener("open-settings", open);
    return () => window.removeEventListener("open-settings", open);
  }, []);
  return (
    <>
      <button type="button">Other</button>
      <button type="button" onClick={() => setIsOpen(true)}>Settings</button>
      <BudgetSettingsModal preview={{} as never} isOpen={isOpen} onClose={() => setIsOpen(false)} budgetSystem="flex"
        defaultApplyScope="this_month" onSaveSettings={vi.fn()} categories={[]} categoryGroups={[]}
        onClear={vi.fn()} isSaving={false} isClearing={false} />
    </>
  );
}

async function closeAndExpectFocus(user: ReturnType<typeof userEvent.setup>, expected: HTMLElement) {
  await screen.findByRole("dialog", { name: "Budget Settings" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(expected).toHaveFocus());
}

const EDIT_DATA: BudgetEditData = { categoryId: "c1", categoryName: "Groceries", year: 2026, month: 11, amount: "300.00" };

/** Like the budget page: the dialog mounts open with its data, the parent records the opener. */
function EditHarness() {
  const [data, setData] = useState<BudgetEditData | null>(null);
  const opener = useDialogOpener(data !== null);
  return (
    <>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setData(EDIT_DATA)}>
        Edit Groceries
      </button>
      <BudgetEditModal isOpen={data !== null} onClose={() => setData(null)} data={data}
        defaultApplyScope="this_month" onSave={vi.fn()} isSaving={false} opener={opener} />
    </>
  );
}

async function openSettings(props: HarnessProps = {}) {
  const user = userEvent.setup();
  render(<SettingsHarness {...props} />);
  const opener = screen.getByRole("button", { name: "Settings" });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Budget Settings" });
  return { user, opener, dialog };
}

describe("Budget Settings dialog", () => {
  it("is a modal dialog named by its title, with a description", async () => {
    const { dialog } = await openSettings();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/budget system/i);
  });

  it("offers the budget system as a radio group chosen from the keyboard", async () => {
    const onSave = vi.fn();
    const { user, dialog } = await openSettings({ onSave });
    const group = within(dialog).getByRole("radiogroup", { name: "System" });
    const flex = within(group).getByRole("radio", { name: "Flex Budget" });
    const category = within(group).getByRole("radio", { name: "Category Budget" });
    expect(flex).toBeChecked();
    expect(category).toHaveAccessibleDescription(/budget every category individually/i);

    await user.click(flex);
    // Radix moves roving focus on a timer and checks the radio it lands on
    // while the arrow is still down, as on a real keyboard; release after.
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(category).toHaveFocus());
    await waitFor(() => expect(category).toBeChecked());
    await user.keyboard("{/ArrowDown}");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ budgetSystem: "category", defaultApplyScope: "this_month" });
  });

  it("names the apply-scope radio group", async () => {
    const { dialog } = await openSettings();
    const scope = within(dialog).getByRole("radiogroup", { name: "By default, apply budget changes to" });
    expect(within(scope).getByRole("radio", { name: /this month only/i })).toBeChecked();
  });

  it("keeps Tab inside the dialog", async () => {
    const { user, dialog, opener } = await openSettings();
    for (let step = 0; step < 12; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(opener).not.toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const { user, opener } = await openSettings();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to an opener the pointer press did not focus (Safari)", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness isOpenerUnfocusable />);
    const opener = screen.getByRole("button", { name: "Settings" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Budget Settings" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to a control activated by a synthesized click (assistive technology)", async () => {
    const user = userEvent.setup();
    render(<EventOpenedHarness />);
    await user.click(screen.getByRole("button", { name: "Other" }));
    const settings = screen.getByRole("button", { name: "Settings" });
    // A click with no pointer or key event before it, while focus is on Other.
    fireEvent.click(settings);
    await closeAndExpectFocus(user, settings);
  });

  it("ignores a stale press and returns focus to the control that has focus", async () => {
    const user = userEvent.setup();
    render(<EventOpenedHarness />);
    await user.click(screen.getByRole("button", { name: "Other" }));
    const later = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 5_000);
    try {
      const settings = screen.getByRole("button", { name: "Settings" });
      act(() => settings.focus());
      act(() => { window.dispatchEvent(new Event("open-settings")); });
      await closeAndExpectFocus(user, settings);
    } finally {
      later.mockRestore();
    }
  });

  it("stays open on Escape while its save is in flight", async () => {
    const { user, dialog } = await openSettings({ isSaving: true });
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
  });
});

describe("Edit Budget dialog", () => {
  it("is a modal dialog that opens with focus in the amount and closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BudgetEditModal
        isOpen
        onClose={onClose}
        data={{ categoryId: "c1", categoryName: "Groceries", year: 2026, month: 11, amount: "300.00" }}
        defaultApplyScope="this_month"
        onSave={vi.fn()}
        isSaving={false}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Budget" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/groceries budget/i);
    await waitFor(() => expect(within(dialog).getByLabelText("Budget Amount")).toHaveFocus());
    expect(within(dialog).getByRole("radiogroup", { name: "Apply changes to" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener the parent recorded when it mounts already open", async () => {
    const user = userEvent.setup();
    render(<EditHarness />);
    const opener = screen.getByRole("button", { name: "Edit Groceries" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Edit Budget" });
    await waitFor(() => expect(within(dialog).getByLabelText("Budget Amount")).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
