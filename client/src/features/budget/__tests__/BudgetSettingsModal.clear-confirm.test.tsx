/**
 * @vitest-environment jsdom
 *
 * NEW-37: "Clear all" asks through the app's AlertDialog, never the browser's
 * native confirm box. Confirm clears once; Cancel and Escape clear nothing.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetSettingsModal } from "../components/BudgetSettingsModal";

vi.mock("../components/BudgetRecalculationPreview", () => ({ BudgetRecalculationPreview: () => null }));

afterEach(() => vi.restoreAllMocks());

function arrange() {
  const onClear = vi.fn();
  const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <BudgetSettingsModal
      preview={{} as never}
      isOpen
      onClose={vi.fn()}
      budgetSystem="category"
      defaultApplyScope="this_month"
      onSaveSettings={vi.fn()}
      categories={[]}
      categoryGroups={[]}
      onClear={onClear}
      isSaving={false}
      isClearing={false}
    />,
  );
  return { onClear, nativeConfirm, user: userEvent.setup() };
}

describe("BudgetSettingsModal clear all", () => {
  it("asks in the dialog and clears once on confirm", async () => {
    const { onClear, nativeConfirm, user } = arrange();

    await user.click(screen.getByRole("button", { name: /^clear all$/i }));
    const dialog = await screen.findByRole("alertdialog", { name: /clear all budget values\?/i });
    expect(onClear).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /^clear all values$/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Cancel clears nothing", async () => {
    const { onClear, nativeConfirm, user } = arrange();

    await user.click(screen.getByRole("button", { name: /^clear all$/i }));
    const dialog = await screen.findByRole("alertdialog", { name: /clear all budget values\?/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onClear).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Escape cancels and returns focus to the Clear all button", async () => {
    const { onClear, user } = arrange();
    const trigger = screen.getByRole("button", { name: /^clear all$/i });

    await user.click(trigger);
    await screen.findByRole("alertdialog", { name: /clear all budget values\?/i });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onClear).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
