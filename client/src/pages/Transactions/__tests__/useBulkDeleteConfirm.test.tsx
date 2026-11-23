/**
 * @vitest-environment jsdom
 *
 * NEW-37: bulk delete on the Transactions page (toolbar button and keyboard
 * shortcut) asks through the app's AlertDialog, never the browser's native
 * confirm box. Confirm deletes the selected ids once; Cancel deletes nothing.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBulkDeleteConfirm } from "../useBulkDeleteConfirm";

afterEach(() => vi.restoreAllMocks());

function Harness({ ids, onDelete }: { ids: Set<string>; onDelete: (ids: string[]) => void }) {
  const bulkDelete = useBulkDeleteConfirm(ids, onDelete);
  return (
    <>
      <button type="button" onClick={bulkDelete.request}>Delete selected</button>
      {bulkDelete.dialog}
    </>
  );
}

function arrange(ids: string[]) {
  const onDelete = vi.fn();
  const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Harness ids={new Set(ids)} onDelete={onDelete} />);
  return { onDelete, nativeConfirm, user: userEvent.setup() };
}

describe("useBulkDeleteConfirm", () => {
  it("asks in the dialog and deletes the selected ids once on confirm", async () => {
    const { onDelete, nativeConfirm, user } = arrange(["t1", "t2"]);

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const dialog = await screen.findByRole("alertdialog", { name: /delete 2 transactions\?/i });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /^delete 2 transactions$/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(["t1", "t2"]);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Cancel deletes nothing", async () => {
    const { onDelete, nativeConfirm, user } = arrange(["t1"]);

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const dialog = await screen.findByRole("alertdialog", { name: /delete 1 transaction\?/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Escape cancels and returns focus to the trigger", async () => {
    const { onDelete, user } = arrange(["t1", "t2"]);
    const trigger = screen.getByRole("button", { name: "Delete selected" });

    await user.click(trigger);
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens nothing when no transaction is selected", async () => {
    const { user } = arrange([]);

    await user.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
